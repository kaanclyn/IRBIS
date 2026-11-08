const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { app } = require("electron");
const { log } = require("./log.cjs");

function defaultSdkRoot() {
  const fromEnv = process.env.IRBIS_NAUTILUS_SDK?.trim();
  if (fromEnv) return fromEnv;
  const info = path.resolve(__dirname, "..", "..", "..", "maps", "chart.info.txt");
  try {
    if (fs.existsSync(info)) {
      const line = fs.readFileSync(info, "utf8").trim().split(/\r?\n/)[0];
      if (line) return line.trim();
    }
  } catch {
    /* ignore */
  }
  return "K:\\SevenCs\\Nautilus\\1.10.2.4";
}

function walk000(dir, out, depth = 0) {
  if (depth > 8 || !fs.existsSync(dir)) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk000(full, out, depth + 1);
    else if (e.isFile() && e.name.toUpperCase().endsWith(".000")) out.push(full);
  }
}

/** @typedef {{ north: number, south: number, west: number, east: number }} GeoBBox */

function clampBBox(b) {
  const north = Math.max(b.north, b.south);
  const south = Math.min(b.north, b.south);
  let { west, east } = b;
  if (east === west) east = west + 1e-4;
  return { north, south, west, east };
}

function parseBoundaries(stdout) {
  const m = /Boundaries:\s*North\s+([-\d.]+)\s*,\s*South\s+([-\d.]+)\s*,\s*West\s+([-\d.]+)\s*,\s*East\s+([-\d.]+)/i.exec(
    stdout || ""
  );
  if (!m) return null;
  return clampBBox({
    north: Number(m[1]),
    south: Number(m[2]),
    west: Number(m[3]),
    east: Number(m[4]),
  });
}

function fmtCoord(n) {
  return Number(n).toFixed(6);
}

/** Cache anahtarı — merkez+span, span’ın ~5% ızgarası (geri dönüşte HIT) */
function snapDim(n) {
  return Math.max(320, Math.round(Number(n) / 32) * 32);
}

function bboxCenterSpan(b) {
  const lonSpan = Math.max(1e-8, b.east - b.west);
  const latSpan = Math.max(1e-8, b.north - b.south);
  return {
    clon: (b.west + b.east) / 2,
    clat: (b.south + b.north) / 2,
    lonSpan,
    latSpan,
  };
}

function quantizeBBox(b) {
  if (!b) return null;
  const { clon, clat, lonSpan, latSpan } = bboxCenterSpan(b);
  // ~%5 span ızgara → pan geri gelince aynı hücreye düşer
  const gLon = Math.max(lonSpan * 0.05, 0.0008);
  const gLat = Math.max(latSpan * 0.05, 0.0008);
  const qClon = Math.round(clon / gLon) * gLon;
  const qClat = Math.round(clat / gLat) * gLat;
  const qLonSpan = Math.max(gLon, Math.round(lonSpan / gLon) * gLon);
  const qLatSpan = Math.max(gLat, Math.round(latSpan / gLat) * gLat);
  return clampBBox({
    west: qClon - qLonSpan / 2,
    east: qClon + qLonSpan / 2,
    north: qClat + qLatSpan / 2,
    south: qClat - qLatSpan / 2,
  });
}

function fmtCacheCoord(n) {
  return Number(n).toFixed(5);
}

/** Görünen bbox’ı merkezden factor kadar büyüt (overscan / metatile). */
function expandBBox(b, factor) {
  const f = Math.max(1, Number(factor) || 1);
  if (!b || f === 1) return b ? clampBBox(b) : null;
  const { clon, clat, lonSpan, latSpan } = bboxCenterSpan(b);
  return clampBBox({
    west: clon - (lonSpan * f) / 2,
    east: clon + (lonSpan * f) / 2,
    north: clat + (latSpan * f) / 2,
    south: clat - (latSpan * f) / 2,
  });
}

const DEFAULT_OVERSCAN = Math.min(2.5, Math.max(1, Number(process.env.IRBIS_NAUTILUS_OVERSCAN || 2)));
/** Navionics ile aynı varsayılan karo boyutu */
const TILE_SIZE = Math.max(256, Math.min(1024, Number(process.env.IRBIS_NAUTILUS_TILE_SIZE || 256)));

function createNautilusBridge({ port = 18768 } = {}) {
  const sdkRoot = defaultSdkRoot();
  const frameRoot = path.join(app.getPath("userData"), "nautilus-frames");
  const cacheRoot = path.join(app.getPath("userData"), "nautilus-frame-cache");
  fs.mkdirSync(frameRoot, { recursive: true });
  fs.mkdirSync(cacheRoot, { recursive: true });
  // Eski z/x/y tile cache dizinini temizle (bir kez)
  try {
    const legacy = path.join(app.getPath("userData"), "nautilus-cache");
    if (fs.existsSync(legacy)) {
      fs.rmSync(legacy, { recursive: true, force: true });
      log.info("nautilus: removed legacy tile cache");
    }
  } catch (e) {
    log.warn("nautilus legacy cache cleanup", e);
  }

  /** @type {Map<string, { id: string, name: string, path: string, source: string }>} */
  let cells = new Map();
  /** @type {Map<string, GeoBBox>} */
  const cellFitBBox = new Map();
  /** @type {Map<string, Promise<any>>} */
  const inFlight = new Map();
  let printChain = Promise.resolve();
  let server = null;
  let baseUrl = `http://127.0.0.1:${port}`;
  let listenPort = port;
  let frameRev = 0;
  let cacheHits = 0;
  let cacheMisses = 0;
  let cacheNearHits = 0;
  /** Prefetch fırtınasını sınırla — kullanıcı settle’ını bloklamasın */
  let prefetchBusy = 0;
  const PREFETCH_MAX = 2;
  /** @type {Map<string, { key: string, cellId: string, width: number, height: number, dpi: number, bbox: GeoBBox, clon: number, clat: number, lonSpan: number, latSpan: number }>} */
  const cacheIndex = new Map();

  function rememberCacheEntry(key, cellId, width, height, dpi, bbox) {
    if (!bbox || !key) return;
    const cs = bboxCenterSpan(bbox);
    cacheIndex.set(key, {
      key,
      cellId: String(cellId).toUpperCase(),
      width,
      height,
      dpi,
      bbox,
      ...cs,
    });
  }

  function loadCacheIndexFromDisk() {
    try {
      for (const name of fs.readdirSync(cacheRoot)) {
        if (!name.endsWith(".json")) continue;
        const key = name.slice(0, -5);
        const png = path.join(cacheRoot, `${key}.png`);
        if (!fs.existsSync(png) || fs.statSync(png).size < 1000) continue;
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(cacheRoot, name), "utf8"));
          if (meta?.bbox && meta?.cellId) {
            rememberCacheEntry(
              key,
              meta.cellId,
              snapDim(meta.width || 1280),
              snapDim(meta.height || 720),
              meta.dpi || 96,
              clampBBox(meta.bbox)
            );
          }
        } catch {
          /* ignore */
        }
      }
      log.info(
        `nautilus cache ready · index=${cacheIndex.size} frames · dir=${cacheRoot}`
      );
    } catch {
      /* ignore */
    }
  }
  loadCacheIndexFromDisk();

  /**
   * Tam key yoksa: merkez ≤%12 span, zoom ≤%10 fark → yakın HIT (geri pan).
   */
  function findNearCache(cellId, width, height, dpi, bbox) {
    if (!bbox) return null;
    const id = String(cellId).toUpperCase();
    const { clon, clat, lonSpan, latSpan } = bboxCenterSpan(bbox);
    let best = null;
    let bestScore = Infinity;
    let bestDelta = null;
    for (const entry of cacheIndex.values()) {
      if (entry.cellId !== id) continue;
      if (entry.width !== width || entry.height !== height) continue;
      if (entry.dpi !== dpi) continue;
      const dLon = Math.abs(entry.clon - clon) / lonSpan;
      const dLat = Math.abs(entry.clat - clat) / latSpan;
      const rLon = Math.abs(entry.lonSpan - lonSpan) / lonSpan;
      const rLat = Math.abs(entry.latSpan - latSpan) / latSpan;
      // Sıkı eşik — gevşek NEAR %6+ atlama hissi yaratıyordu
      if (dLon > 0.05 || dLat > 0.05 || rLon > 0.06 || rLat > 0.06) continue;
      const score = dLon + dLat + rLon * 2 + rLat * 2;
      if (score < bestScore) {
        bestScore = score;
        best = entry;
        bestDelta = { dLon, dLat, rLon, rLat, score };
      }
    }
    if (!best) return null;
    return { ...best, delta: bestDelta };
  }

  const printChartExe = path.join(sdkRoot, "build", "PrintChart", "Release", "PrintChart.exe");
  const pickChartExe = path.join(sdkRoot, "build", "PickChart", "Release", "PickChart.exe");
  const pickChartAlt = path.join(
    path.resolve(__dirname, "..", "..", "..", "maps", "poc", "PickChart", "build", "Release", "PickChart.exe")
  );
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const persistentExeCandidates = [
    process.env.IRBIS_NAUTILUS_RENDERER_EXE?.trim(),
    path.join(repoRoot, "native", "nautilus-renderer", "build", "Release", "nautilus-renderer.exe"),
    path.join(repoRoot, "native", "nautilus-renderer", "build", "Debug", "nautilus-renderer.exe"),
  ].filter(Boolean);
  const persistentExe = persistentExeCandidates.find((p) => fs.existsSync(p)) || null;
  const modeEnv = String(process.env.IRBIS_NAUTILUS_MODE || "").toLowerCase();
  const renderMode =
    modeEnv === "printchart" || modeEnv === "persistent"
      ? modeEnv
      : persistentExe
        ? "persistent"
        : "printchart";
  const binDir = path.join(sdkRoot, "bin");
  const qtBin = process.env.IRBIS_QT_BIN || "C:\\Qt\\5.15.2\\msvc2019_64\\bin";
  const qtPlugins = process.env.IRBIS_QT_PLUGINS || "C:\\Qt\\5.15.2\\msvc2019_64\\plugins";

  const persistent = {
    proc: null,
    buf: "",
    nextId: 1,
    /** @type {Map<number, {resolve: Function, reject: Function}>} */
    pending: new Map(),
    loadedCell: null,
    /** @type {GeoBBox | null} */
    lastViewport: null,
    starting: null,
    /** Uygulama kapanırken / stop() — exit warn basma */
    stopping: false,
  };

  function jsonPath(p) {
    return String(p || "").replace(/\\/g, "/");
  }

  function ensurePersistent() {
    if (persistent.proc && !persistent.proc.killed) return Promise.resolve();
    if (persistent.starting) return persistent.starting;
    if (!persistentExe) return Promise.reject(new Error("nautilus-renderer.exe yok"));

    persistent.starting = new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        PATH: `${binDir};${qtBin};${process.env.PATH || ""}`,
        QT_PLUGIN_PATH: qtPlugins,
      };
      const proc = spawn(persistentExe, [], {
        env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      persistent.proc = proc;
      persistent.buf = "";
      persistent.loadedCell = null;
      persistent.lastViewport = null;

      let ready = false;
      const failTimer = setTimeout(() => {
        if (!ready) {
          try {
            proc.kill();
          } catch {
            /* ignore */
          }
          reject(new Error("nautilus-renderer ready timeout"));
        }
      }, 60000);

      const onLine = (line) => {
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          return;
        }
        if (!ready && (msg.event === "ready" || msg.ok === true)) {
          ready = true;
          clearTimeout(failTimer);
          log.info(`nautilus persistent renderer ready · ${persistentExe}`);
          resolve();
        }
        const id = Number(msg.requestId);
        if (Number.isFinite(id) && persistent.pending.has(id)) {
          const { resolve: res, reject: rej } = persistent.pending.get(id);
          persistent.pending.delete(id);
          if (msg.ok) res(msg);
          else rej(new Error(msg.error || "persistent render error"));
        }
      };

      proc.stdout.on("data", (chunk) => {
        persistent.buf += chunk.toString();
        let idx;
        while ((idx = persistent.buf.indexOf("\n")) >= 0) {
          const line = persistent.buf.slice(0, idx).trim();
          persistent.buf = persistent.buf.slice(idx + 1);
          if (line) onLine(line);
        }
      });
      proc.stderr?.on("data", (d) => {
        const t = d.toString().trim();
        if (t) log.info(`nautilus-renderer: ${t}`);
      });
      proc.on("exit", (code, signal) => {
        const intentional = persistent.stopping;
        persistent.stopping = false;
        if (intentional) {
          log.info(
            `nautilus-renderer stopped (shutdown) code=${code ?? "null"} signal=${signal ?? "null"}`
          );
        } else {
          log.warn(
            `nautilus-renderer exit unexpected code=${code ?? "null"} signal=${signal ?? "null"}`
          );
        }
        for (const [, p] of persistent.pending) {
          p.reject(new Error(intentional ? "renderer stopped" : "renderer exited"));
        }
        persistent.pending.clear();
        persistent.proc = null;
        persistent.loadedCell = null;
        persistent.lastViewport = null;
        persistent.starting = null;
      });
      proc.on("error", (err) => {
        clearTimeout(failTimer);
        persistent.proc = null;
        persistent.starting = null;
        reject(err);
      });
    });
    return persistent.starting;
  }

  function persistentRequest(cmd, fields = {}) {
    return ensurePersistent().then(
      () =>
        new Promise((resolve, reject) => {
          const requestId = persistent.nextId++;
          const payload = { cmd, requestId, ...fields };
          persistent.pending.set(requestId, { resolve, reject });
          try {
            persistent.proc.stdin.write(`${JSON.stringify(payload)}\n`);
          } catch (err) {
            persistent.pending.delete(requestId);
            reject(err);
          }
        })
    );
  }

  async function runPersistentRender(cellPath, outPng, width, height, dpi, bbox) {
    await ensurePersistent();
    if (persistent.loadedCell !== cellPath) {
      const loaded = await persistentRequest("loadCell", {
        path: jsonPath(cellPath),
        width,
        height,
        dpi,
      });
      persistent.loadedCell = cellPath;
      if (loaded.viewport) persistent.lastViewport = clampBBox(loaded.viewport);
    }

    const box = bbox || persistent.lastViewport;
    if (box) {
      await persistentRequest("setViewport", {
        north: box.north,
        south: box.south,
        west: box.west,
        east: box.east,
        width,
        height,
        dpi,
      });
      persistent.lastViewport = clampBBox(box);
    }

    const rendered = await persistentRequest("render", { out: jsonPath(outPng) });
    const vp = rendered.viewport ? clampBBox(rendered.viewport) : persistent.lastViewport;
    if (vp) persistent.lastViewport = vp;
    return {
      stdout: vp
        ? `Boundaries:   North ${vp.north}, South ${vp.south}, West ${vp.west}, East ${vp.east}`
        : "",
      ms: rendered.ms,
      viewport: vp,
      mode: "persistent",
    };
  }

  function stopPersistent() {
    if (persistent.proc) {
      persistent.stopping = true;
      try {
        persistent.proc.stdin.write(`${JSON.stringify({ cmd: "quit", requestId: persistent.nextId++ })}\n`);
      } catch {
        /* ignore */
      }
      try {
        persistent.proc.kill();
      } catch {
        /* ignore */
      }
      // exit handler temizler; burada null’a çekmeyelim ki exit intentional kalsın
      persistent.loadedCell = null;
      persistent.lastViewport = null;
    }
  }

  function rescan() {
    cells = new Map();
    const roots = [
      path.join(sdkRoot, "testdata", "ImportData"),
      path.join(sdkRoot, "testdata", "Datasets"),
    ];
    const files = [];
    for (const r of roots) walk000(r, files);
    for (const filePath of files) {
      const name = path.basename(filePath, path.extname(filePath));
      const id = name.toUpperCase();
      if (cells.has(id)) continue;
      cells.set(id, { id, name, path: filePath, source: "sdk-testdata" });
    }
    log.info(`nautilus cells scanned: ${cells.size} · sdk=${sdkRoot} · mode=${renderMode}`);
    return list();
  }

  function list() {
    return [...cells.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  function runPrintChart(cellPath, outDir, width, height, dpi, bbox) {
    const job = () =>
      new Promise((resolve, reject) => {
        if (!fs.existsSync(printChartExe)) {
          reject(new Error(`PrintChart.exe yok: ${printChartExe}`));
          return;
        }
        fs.mkdirSync(outDir, { recursive: true });
        const env = {
          ...process.env,
          PATH: `${binDir};${qtBin};${process.env.PATH || ""}`,
          QT_PLUGIN_PATH: qtPlugins,
        };
        const args = [
          "-c",
          cellPath,
          "-o",
          outDir,
          "--cairo",
          "-s",
          `${width}x${height}`,
          "-d",
          String(dpi),
        ];
        if (bbox) {
          args.push(
            "-N",
            fmtCoord(bbox.north),
            "-S",
            fmtCoord(bbox.south),
            "-W",
            fmtCoord(bbox.west),
            "-E",
            fmtCoord(bbox.east)
          );
        }
        const proc = spawn(printChartExe, args, { env, windowsHide: true });
        let err = "";
        let out = "";
        proc.stderr?.on("data", (d) => {
          err += d.toString();
        });
        proc.stdout?.on("data", (d) => {
          out += d.toString();
        });
        proc.on("error", reject);
        proc.on("exit", (code) => {
          if (code === 0) resolve({ stdout: out, stderr: err });
          else reject(new Error((err || out).trim() || `PrintChart exit ${code}`));
        });
      });

    const run = printChain.then(job, job);
    printChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  function frameCacheKey(cellId, width, height, dpi, bbox) {
    const w = snapDim(width);
    const h = snapDim(height);
    let b = "fit";
    if (bbox) {
      const q = quantizeBBox(bbox) || bbox;
      const cs = bboxCenterSpan(q);
      b = `c${fmtCacheCoord(cs.clon)}_${fmtCacheCoord(cs.clat)}_s${fmtCacheCoord(cs.lonSpan)}_${fmtCacheCoord(cs.latSpan)}`;
    }
    const raw = `${String(cellId).toUpperCase()}|${w}x${h}|${dpi}|${b}`;
    return crypto.createHash("sha1").update(raw).digest("hex").slice(0, 16);
  }

  function serveCacheHit(cell, key, width, height, dpi, bbox, kind, extra = {}) {
    const { png: cachePng, meta: cacheMeta } = cachePaths(key);
    let metaObj = null;
    try {
      metaObj = JSON.parse(fs.readFileSync(cacheMeta, "utf8"));
    } catch {
      /* ignore */
    }
    // HIT: diske yeniden yazma / copy yok — sadece mevcut PNG’yi sun
    const vp = metaObj?.bbox ? clampBBox(metaObj.bbox) : bbox || cellFitBBox.get(cell.id) || null;
    if (vp && !bbox) cellFitBBox.set(cell.id, vp);
    if (vp) rememberCacheEntry(key, cell.id, width, height, dpi, vp);
    if (kind === "near") cacheNearHits += 1;
    else cacheHits += 1;
    const bytes = fs.statSync(cachePng).size;
    const tag = kind === "near" ? "NEAR" : "EXACT";
    const delta =
      kind === "near" && extra.delta
        ? ` dLon=${(extra.delta.dLon * 100).toFixed(1)}% dLat=${(extra.delta.dLat * 100).toFixed(1)}% score=${extra.delta.score.toFixed(3)}`
        : "";
    const via = extra.live ? "LIVE" : "HIT";
    log.info(
      `nautilus CACHE ${via} [${tag}] ${cell.id} key=${key} bytes=${bytes} draw=NO rewrite=NO file=${cachePng}${delta} · totals hit=${cacheHits} near=${cacheNearHits} miss=${cacheMisses}`
    );
    return {
      ok: true,
      cacheHit: true,
      cacheNear: kind === "near",
      cellId: cell.id,
      // Stabil URL ( ?r= yok ) → tarayıcı bellek cache, geri pan’de anında
      url: `${baseUrl}/cache/${key}.png`,
      key,
      rev: frameRev,
      bytes,
      viewport: vp,
      fit: cellFitBBox.get(cell.id) || vp,
      width,
      height,
      dpi,
      ms: 0,
      drawMs: 0,
      renderMode: kind === "near" ? "cache-near" : "cache",
      cacheFile: cachePng,
    };
  }

  function cachePaths(key) {
    return {
      png: path.join(cacheRoot, `${key}.png`),
      meta: path.join(cacheRoot, `${key}.json`),
    };
  }

  function cacheStats() {
    let files = 0;
    let bytes = 0;
    try {
      for (const name of fs.readdirSync(cacheRoot)) {
        if (!name.endsWith(".png")) continue;
        files += 1;
        bytes += fs.statSync(path.join(cacheRoot, name)).size;
      }
    } catch {
      /* ignore */
    }
    return {
      files,
      bytes,
      dir: cacheRoot,
      hits: cacheHits,
      nearHits: cacheNearHits,
      misses: cacheMisses,
      index: cacheIndex.size,
    };
  }

  function neighborBBoxes(bbox) {
    if (!bbox) return [];
    const lonSpan = bbox.east - bbox.west;
    const latSpan = bbox.north - bbox.south;
    // Tipik pan (~%30) — agresif %45 prefetch kullanıcı settle’ını boğuyordu
    const ox = lonSpan * 0.3;
    const oy = latSpan * 0.3;
    return [
      clampBBox({ north: bbox.north + oy, south: bbox.south + oy, west: bbox.west, east: bbox.east }),
      clampBBox({ north: bbox.north - oy, south: bbox.south - oy, west: bbox.west, east: bbox.east }),
      clampBBox({ north: bbox.north, south: bbox.south, west: bbox.west - ox, east: bbox.east - ox }),
      clampBBox({ north: bbox.north, south: bbox.south, west: bbox.west + ox, east: bbox.east + ox }),
    ];
  }

  function schedulePrefetch(cellId, width, height, dpi, bbox) {
    if (!bbox || prefetchBusy >= PREFETCH_MAX) return;
    // Kullanıcı render’ı uçuştayken prefetch başlatma
    if (inFlight.size > 0) return;
    for (const nb of neighborBBoxes(bbox)) {
      if (prefetchBusy >= PREFETCH_MAX) break;
      const near = findNearCache(cellId, width, height, dpi, nb);
      if (near) continue;
      const key = frameCacheKey(cellId, width, height, dpi, quantizeBBox(nb));
      const { png } = cachePaths(key);
      if (fs.existsSync(png) && fs.statSync(png).size > 1000) continue;
      prefetchBusy += 1;
      void ensureRender(cellId, {
        width,
        height,
        dpi,
        bbox: nb,
        prefetch: true,
      })
        .catch((e) => log.warn("nautilus prefetch", e.message || e))
        .finally(() => {
          prefetchBusy = Math.max(0, prefetchBusy - 1);
        });
    }
  }

  /**
   * Persistent Draw + viewport frame cache (HIT = Draw yok).
   * Prefetch: komşu extent’ler arka planda.
   */
  async function ensureRender(cellId, opts = {}) {
    // Karo: tam 256 (snapDim min 320 Navionics uyumunu bozuyordu)
    const width = opts.exactSize
      ? Math.max(64, Math.min(2560, Math.round(Number(opts.width) || 256)))
      : snapDim(Math.max(320, Math.min(2560, Math.round(Number(opts.width) || 1280))));
    const height = opts.exactSize
      ? Math.max(64, Math.min(1600, Math.round(Number(opts.height) || 256)))
      : snapDim(Math.max(240, Math.min(1600, Math.round(Number(opts.height) || 720))));
    const dpi = Number(opts.dpi) || 96;
    const isPrefetch = !!opts.prefetch;
    const noNear = !!opts.noNear;
    const noPrintFallback = !!opts.noPrintFallback;
    const cell = cells.get(String(cellId || "").toUpperCase());
    if (!cell) throw new Error(`ENC hücre yok: ${cellId}`);

    let bbox = null;
    if (opts.bbox) {
      // Karo kenarları quantized olursa mozaik kayar — yalnız clamp
      bbox = opts.exactBBox ? clampBBox(opts.bbox) : quantizeBBox(opts.bbox);
    } else if (
      [opts.north, opts.south, opts.west, opts.east].every((v) => Number.isFinite(Number(v)))
    ) {
      const raw = {
        north: Number(opts.north),
        south: Number(opts.south),
        west: Number(opts.west),
        east: Number(opts.east),
      };
      bbox = opts.exactBBox ? clampBBox(raw) : quantizeBBox(raw);
    }

    const key = frameCacheKey(cell.id, width, height, dpi, bbox);
    const flightKey = isPrefetch ? `pf:${key}` : key;
    const existing = inFlight.get(flightKey);
    if (existing) return existing;
    // Aynı key kullanıcı işindeyse prefetch atla
    if (isPrefetch && inFlight.has(key)) {
      return inFlight.get(key);
    }

    const work = (async () => {
      const { png: cachePng, meta: cacheMeta } = cachePaths(key);
      const latestPng = path.join(frameRoot, `${cell.id}.png`);

      if (fs.existsSync(cachePng) && fs.statSync(cachePng).size > 1000) {
        return serveCacheHit(cell, key, width, height, dpi, bbox, "exact");
      }

      // Geri pan near-HIT — karoda YASAK (yanlış komşu coğrafya yapıştırır)
      if (!isPrefetch && !noNear && bbox) {
        const near = findNearCache(cell.id, width, height, dpi, bbox);
        // score > 0.04 → atlama riski; Draw tercih (veya live paint sonra exact)
        if (near && near.delta && near.delta.score <= 0.04) {
          const nearPng = cachePaths(near.key).png;
          if (fs.existsSync(nearPng) && fs.statSync(nearPng).size > 1000) {
            return serveCacheHit(cell, near.key, width, height, dpi, near.bbox, "near", {
              delta: near.delta,
              requestedKey: key,
            });
          }
        }
      }

      log.info(
        `nautilus CACHE LOOKUP miss ${cell.id} want=${key} ${width}x${height} → will DRAW · dir=${cacheRoot}`
      );

      const tmpDir = path.join(frameRoot, "_tmp");
      fs.mkdirSync(tmpDir, { recursive: true });
      const t0 = Date.now();
      let stdout = "";
      let renderMs = null;
      let modeUsed = renderMode;
      let finalBBox = bbox;

      if (renderMode === "persistent" && persistentExe) {
        try {
          const directPng = path.join(tmpDir, `${cell.id}-frame.png`);
          const result = await runPersistentRender(cell.path, directPng, width, height, dpi, bbox);
          stdout = result.stdout || "";
          renderMs = result.ms;
          // Karo: istenen bbox anahtar — Kernel’in hafif sapması mozaik kırar
          if (opts.exactBBox && bbox) finalBBox = bbox;
          else if (result.viewport) finalBBox = quantizeBBox(result.viewport) || clampBBox(result.viewport);
          if (!fs.existsSync(directPng) || fs.statSync(directPng).size < 1000) {
            throw new Error("persistent PNG üretmedi");
          }
          fs.copyFileSync(directPng, cachePng);
          fs.copyFileSync(directPng, latestPng);
        } catch (err) {
          // Karo yağmurunda PrintChart = CodeMeter 212 (user maximum)
          if (noPrintFallback) throw err;
          log.warn(`persistent render failed → PrintChart: ${err.message || err}`);
          modeUsed = "printchart-fallback";
          const result = await runPrintChart(cell.path, tmpDir, width, height, dpi, bbox);
          stdout = result.stdout;
          const produced = fs.readdirSync(tmpDir).find((f) => f.toLowerCase().endsWith(".png"));
          if (!produced) throw new Error("PrintChart PNG üretmedi");
          fs.copyFileSync(path.join(tmpDir, produced), cachePng);
          fs.copyFileSync(path.join(tmpDir, produced), latestPng);
          finalBBox = bbox || parseBoundaries(stdout);
        }
      } else {
        const result = await runPrintChart(cell.path, tmpDir, width, height, dpi, bbox);
        stdout = result.stdout;
        const produced = fs.readdirSync(tmpDir).find((f) => f.toLowerCase().endsWith(".png"));
        if (!produced) throw new Error("PrintChart PNG üretmedi");
        fs.copyFileSync(path.join(tmpDir, produced), cachePng);
        fs.copyFileSync(path.join(tmpDir, produced), latestPng);
        finalBBox = bbox || parseBoundaries(stdout);
        modeUsed = "printchart";
      }

      if (!finalBBox) finalBBox = parseBoundaries(stdout);
      if (finalBBox && !opts.exactBBox) finalBBox = quantizeBBox(finalBBox) || finalBBox;
      if (finalBBox && !bbox) cellFitBBox.set(cell.id, finalBBox);

      // Draw sonrası gerçek extent farklıysa anahtarı gerçek bbox’a da yaz
      const actualKey = frameCacheKey(cell.id, width, height, dpi, finalBBox);
      if (actualKey !== key && finalBBox) {
        const alt = cachePaths(actualKey);
        try {
          if (!fs.existsSync(alt.png)) fs.copyFileSync(cachePng, alt.png);
        } catch {
          /* ignore */
        }
      }

      const metaObj = {
        cellId: cell.id,
        width,
        height,
        dpi,
        bbox: finalBBox,
        renderMode: modeUsed,
        drawMs: renderMs,
        ms: Date.now() - t0,
        renderedAt: new Date().toISOString(),
      };
      fs.writeFileSync(cacheMeta, JSON.stringify(metaObj, null, 2), "utf8");
      if (finalBBox) rememberCacheEntry(key, cell.id, width, height, dpi, finalBBox);
      if (actualKey !== key && finalBBox) {
        try {
          fs.writeFileSync(cachePaths(actualKey).meta, JSON.stringify(metaObj, null, 2), "utf8");
          rememberCacheEntry(actualKey, cell.id, width, height, dpi, finalBBox);
        } catch {
          /* ignore */
        }
      }

      cacheMisses += 1;
      frameRev += 1;
      const ms = metaObj.ms;
      const bytes = fs.statSync(cachePng).size;
      // Draw VAR — yeni PNG yazıldı
      log.info(
        `nautilus CACHE MISS [DRAW] ${cell.id} key=${key} wall=${ms}ms drawMs=${renderMs ?? "-"} mode=${modeUsed} bytes=${bytes} saved=${cachePng} · totals hit=${cacheHits} near=${cacheNearHits} miss=${cacheMisses}`
      );

      if (!isPrefetch && finalBBox) {
        schedulePrefetch(cell.id, width, height, dpi, finalBBox);
      }

      return {
        ok: true,
        cacheHit: false,
        cellId: cell.id,
        url: `${baseUrl}/cache/${key}.png`,
        key,
        rev: frameRev,
        bytes,
        viewport: finalBBox,
        fit: cellFitBBox.get(cell.id) || finalBBox,
        width,
        height,
        dpi,
        ms,
        drawMs: renderMs,
        renderMode: modeUsed,
      };
    })();

    inFlight.set(flightKey, work);
    try {
      return await work;
    } finally {
      inFlight.delete(flightKey);
    }
  }

  function screenToGeo(viewport, width, height, x, y) {
    if (!viewport) throw new Error("viewport yok");
    const lon = viewport.west + (x / Math.max(1, width)) * (viewport.east - viewport.west);
    const lat = viewport.north - (y / Math.max(1, height)) * (viewport.north - viewport.south);
    return { lon, lat };
  }

  function geoToScreen(viewport, width, height, lon, lat) {
    if (!viewport) return null;
    const x = ((lon - viewport.west) / (viewport.east - viewport.west)) * width;
    const y = ((viewport.north - lat) / (viewport.north - viewport.south)) * height;
    return { x, y };
  }

  function panViewport(viewport, width, height, dxPx, dyPx) {
    const dLon = (dxPx / Math.max(1, width)) * (viewport.east - viewport.west);
    const dLat = (dyPx / Math.max(1, height)) * (viewport.north - viewport.south);
    return clampBBox({
      north: viewport.north + dLat,
      south: viewport.south + dLat,
      west: viewport.west - dLon,
      east: viewport.east - dLon,
    });
  }

  function zoomViewport(viewport, width, height, factor, anchorX, anchorY) {
    const f = Math.min(8, Math.max(0.125, Number(factor) || 1));
    const anchor = screenToGeo(viewport, width, height, anchorX, anchorY);
    const lonSpan = (viewport.east - viewport.west) / f;
    const latSpan = (viewport.north - viewport.south) / f;
    const rx = anchorX / Math.max(1, width);
    const ry = anchorY / Math.max(1, height);
    return clampBBox({
      west: anchor.lon - rx * lonSpan,
      east: anchor.lon + (1 - rx) * lonSpan,
      north: anchor.lat + ry * latSpan,
      south: anchor.lat - (1 - ry) * latSpan,
    });
  }

  async function setViewport(payload = {}) {
    const cellId = payload.cellId;
    let width = Number(payload.width) || 1280;
    let height = Number(payload.height) || 720;
    const dpi = Number(payload.dpi) || 96;
    const action = String(payload.action || "set");
    const wantOs =
      payload.overscan === false || payload.overscan === 0
        ? 1
        : Math.min(2.5, Math.max(1, Number(payload.overscan) || DEFAULT_OVERSCAN));

    // Geo tampon = piksel (CSS ×os ile 1:1 — px×1.35 gerilmiş görünüyordu)
    const pixelScale = wantOs <= 1.01 ? 1 : wantOs;

    if (action === "fit") {
      const fitted = await ensureRender(cellId, { width, height, dpi });
      if (wantOs <= 1.01 || !fitted?.viewport) return { ...fitted, overscan: 1 };
      const big = expandBBox(fitted.viewport, wantOs);
      const rw = snapDim(Math.min(2048, Math.round(width * pixelScale)));
      const rh = snapDim(Math.min(1280, Math.round(height * pixelScale)));
      const r2 = await ensureRender(cellId, { width: rw, height: rh, dpi, bbox: big });
      log.info(`nautilus OVERSCAN fit×${wantOs} px×${pixelScale} ${rw}x${rh}`);
      return { ...r2, overscan: wantOs };
    }

    let bbox = payload.bbox
      ? clampBBox(payload.bbox)
      : payload.north != null
        ? clampBBox({
            north: Number(payload.north),
            south: Number(payload.south),
            west: Number(payload.west),
            east: Number(payload.east),
          })
        : null;

    if (action === "pan" && payload.viewport) {
      bbox = panViewport(
        clampBBox(payload.viewport),
        width,
        height,
        Number(payload.dxPx) || 0,
        Number(payload.dyPx) || 0
      );
    } else if (action === "zoom" && payload.viewport) {
      bbox = zoomViewport(
        clampBBox(payload.viewport),
        width,
        height,
        Number(payload.factor) || 1,
        Number(payload.anchorX) ?? width / 2,
        Number(payload.anchorY) ?? height / 2
      );
    }

    // settle / set: UI'dan gelen coğrafi bbox → SetViewPort + Draw
    if (!bbox && (action === "settle" || action === "set") && payload.centerLon != null) {
      const fit = cellFitBBox.get(String(cellId || "").toUpperCase());
      const scale = Math.max(0.25, Number(payload.scale) || 1);
      const base = payload.viewport ? clampBBox(payload.viewport) : fit;
      if (base) {
        const lonSpan = (base.east - base.west) / scale;
        const latSpan = (base.north - base.south) / scale;
        bbox = clampBBox({
          west: Number(payload.centerLon) - lonSpan / 2,
          east: Number(payload.centerLon) + lonSpan / 2,
          north: Number(payload.centerLat) + latSpan / 2,
          south: Number(payload.centerLat) - latSpan / 2,
        });
      }
    }

    if (bbox && wantOs > 1.01) {
      bbox = expandBBox(bbox, wantOs);
      width = snapDim(Math.min(2048, Math.round(width * pixelScale)));
      height = snapDim(Math.min(1280, Math.round(height * pixelScale)));
    }

    const rendered = await ensureRender(cellId, { width, height, dpi, bbox: bbox || undefined });
    if (bbox && wantOs > 1.01) {
      log.info(
        `nautilus OVERSCAN set×${wantOs} px×${pixelScale} ${width}x${height} hit=${rendered.cacheHit ? "Y" : "N"}`
      );
    }
    return { ...rendered, overscan: bbox ? wantOs : 1 };
  }

  /**
   * 256×256 tile API — ASKIDA (2026-11-08).
   * UI tekrar full-frame C++ PNG (setViewport) yoluna alındı; tile çağrılmamalı.
   * Kod silinmedi; metatile/zoom P0 sonrası yeniden açılabilir.
   */
  async function ensureTile(payload = {}) {
    log.warn("nautilus ensureTile called while TILE ENGINE SUSPENDED — prefer setViewport full-frame PNG");
    const cellId = payload.cellId;
    const size = Math.max(64, Math.round(Number(payload.size) || TILE_SIZE));
    const dpi = Number(payload.dpi) || 96;
    if (!payload.bbox) throw new Error("ensureTile: bbox gerekli");
    const bbox = clampBBox(payload.bbox);
    const r = await ensureRender(cellId, {
      width: size,
      height: size,
      dpi,
      bbox,
      prefetch: !!payload.prefetch,
      exactSize: true,
      exactBBox: true,
      noNear: true,
      noPrintFallback: true,
    });
    const zxy =
      payload.z != null ? ` z${payload.z}/${payload.x}/${payload.y}` : "";
    if (!r.cacheHit) {
      log.info(
        `nautilus TILE DRAW ${size}² ${cellId || "?"}${zxy} hit=N bytes=${r.bytes || 0} drawMs=${r.drawMs ?? "?"}`
      );
    } else {
      log.info(`nautilus TILE HIT ${size}² ${cellId || "?"}${zxy} key=${r.key || "?"}`);
    }
    return {
      ...r,
      tile: true,
      tileSize: size,
      overscan: 1,
      z: payload.z,
      x: payload.x,
      y: payload.y,
    };
  }

  async function pickFeature(payload = {}) {
    const width = Number(payload.width) || 1280;
    const height = Number(payload.height) || 720;
    const x = Number(payload.x);
    const y = Number(payload.y);
    const viewport = payload.viewport ? clampBBox(payload.viewport) : null;
    if (!viewport || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error("pickFeature: viewport + x/y gerekli");
    }
    const geo = screenToGeo(viewport, width, height, x, y);
    const cellId = String(payload.cellId || "").toUpperCase();
    const cell = cells.get(cellId);

    const result = {
      ok: true,
      geo,
      screen: { x, y },
      features: [],
      source: "geo-projection",
    };

    if (renderMode === "persistent" && persistentExe && cell) {
      try {
        await ensurePersistent();
        if (persistent.loadedCell !== cell.path) {
          await persistentRequest("loadCell", {
            path: jsonPath(cell.path),
            width,
            height,
            dpi: 96,
          });
          persistent.loadedCell = cell.path;
        }
        await persistentRequest("setViewport", {
          north: viewport.north,
          south: viewport.south,
          west: viewport.west,
          east: viewport.east,
          width,
          height,
          dpi: 96,
        });
        const picked = await persistentRequest("pick", {
          x: Math.round(x),
          y: Math.round(y),
          radius: Number(payload.radius) || 12,
        });
        if (picked.geo) result.geo = picked.geo;
        if (picked.features) result.features = picked.features;
        result.source = "nautilus-renderer";
        return result;
      } catch (e) {
        result.note = `persistent pick: ${e.message || e}`;
      }
    }

    const exe = fs.existsSync(pickChartExe)
      ? pickChartExe
      : fs.existsSync(pickChartAlt)
        ? pickChartAlt
        : null;
    if (exe && cell) {
      try {
        const json = await runPickChart(exe, cell.path, width, height, 96, viewport, x, y);
        if (json?.features) {
          result.features = json.features;
          result.source = "PickChart";
          result.note = undefined;
          if (json.geo) result.geo = json.geo;
        }
      } catch (e) {
        result.note = `PickChart hata: ${e.message || e}`;
      }
    }
    return result;
  }

  function runPickChart(exe, cellPath, width, height, dpi, bbox, x, y) {
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        PATH: `${binDir};${qtBin};${process.env.PATH || ""}`,
        QT_PLUGIN_PATH: qtPlugins,
      };
      const args = [
        "-c",
        cellPath,
        "--cairo",
        "-s",
        `${width}x${height}`,
        "-d",
        String(dpi),
        "-N",
        fmtCoord(bbox.north),
        "-S",
        fmtCoord(bbox.south),
        "-W",
        fmtCoord(bbox.west),
        "-E",
        fmtCoord(bbox.east),
        "-x",
        String(Math.round(x)),
        "-y",
        String(Math.round(y)),
        "--json",
      ];
      const proc = spawn(exe, args, { env, windowsHide: true });
      let err = "";
      let out = "";
      proc.stderr?.on("data", (d) => {
        err += d.toString();
      });
      proc.stdout?.on("data", (d) => {
        out += d.toString();
      });
      proc.on("error", reject);
      proc.on("exit", (code) => {
        if (code !== 0) {
          reject(new Error((err || out).trim() || `PickChart exit ${code}`));
          return;
        }
        try {
          const start = out.indexOf("{");
          const end = out.lastIndexOf("}");
          if (start < 0 || end < start) throw new Error("JSON yok");
          resolve(JSON.parse(out.slice(start, end + 1)));
        } catch (e) {
          reject(new Error(`PickChart parse: ${e.message}`));
        }
      });
    });
  }

  function startServer() {
    if (server) return Promise.resolve(baseUrl);
    return new Promise((resolve, reject) => {
      const s = http.createServer((req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }
        const u = String(req.url || "").split("?")[0];
        const cacheMatch = /^\/cache\/([a-f0-9]+)\.png$/i.exec(u);
        if (cacheMatch) {
          const file = path.join(cacheRoot, `${cacheMatch[1].toLowerCase()}.png`);
          if (!fs.existsSync(file)) {
            res.writeHead(404);
            res.end("missing");
            return;
          }
          const buf = fs.readFileSync(file);
          res.writeHead(200, {
            "Content-Type": "image/png",
            "Content-Length": buf.length,
            "Cache-Control": "private, max-age=3600",
          });
          res.end(buf);
          return;
        }
        const m = /^\/frame\/([A-Za-z0-9_-]+)\.png$/i.exec(u);
        if (m) {
          const file = path.join(frameRoot, `${m[1].toUpperCase()}.png`);
          if (!fs.existsSync(file)) {
            res.writeHead(404);
            res.end("missing");
            return;
          }
          const buf = fs.readFileSync(file);
          res.writeHead(200, {
            "Content-Type": "image/png",
            "Content-Length": buf.length,
            "Cache-Control": "no-store",
          });
          res.end(buf);
          return;
        }
        if (u === "/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: true,
              cells: cells.size,
              renderMode,
              persistentAlive: !!(persistent.proc && !persistent.proc.killed),
              cache: cacheStats(),
            })
          );
          return;
        }
        res.writeHead(404);
        res.end("not found");
      });
      s.once("error", (err) => {
        if (err.code === "EADDRINUSE") {
          listenPort = port + 1;
          baseUrl = `http://127.0.0.1:${listenPort}`;
          s.listen(listenPort, "127.0.0.1");
          return;
        }
        reject(err);
      });
      s.listen(listenPort, "127.0.0.1", () => {
        server = s;
        const addr = s.address();
        if (addr && typeof addr === "object") {
          listenPort = addr.port;
          baseUrl = `http://127.0.0.1:${listenPort}`;
        }
        log.info(`nautilus frame server ${baseUrl} · mode=${renderMode}`);
        resolve(baseUrl);
      });
    });
  }

  function status() {
    return {
      sdkRoot,
      printChartOk: fs.existsSync(printChartExe),
      pickChartOk: fs.existsSync(pickChartExe) || fs.existsSync(pickChartAlt),
      persistentOk: !!persistentExe,
      persistentExe,
      renderMode,
      persistentAlive: !!(persistent.proc && !persistent.proc.killed),
      baseUrl,
      cells: cells.size,
      frameRoot,
      cacheRoot,
      cache: cacheStats(),
      d2: {
        viewportIpc: true,
        panZoom: true,
        geoPick: true,
        encPick: true,
        frameCache: true,
        prefetch: true,
        overscan: DEFAULT_OVERSCAN,
        tileSize: TILE_SIZE,
      },
    };
  }

  function stop() {
    stopPersistent();
    if (server) {
      try {
        server.close();
      } catch {
        /* ignore */
      }
      server = null;
    }
  }

  /**
   * Sadece disk lookup — Draw yok. Pan sırasında canlı cache paint için.
   * maxNearScore: üstü reddedilir (atlama hissini önlemek için sıkı tut).
   */
  function lookupCache(opts = {}) {
    const width = snapDim(Math.max(320, Math.min(2560, Math.round(Number(opts.width) || 1280))));
    const height = snapDim(Math.max(240, Math.min(1600, Math.round(Number(opts.height) || 720))));
    const dpi = Number(opts.dpi) || 96;
    const cell = cells.get(String(opts.cellId || "").toUpperCase());
    if (!cell) return { ok: false, cacheHit: false };
    let bbox = null;
    if (opts.bbox) bbox = quantizeBBox(opts.bbox);
    else if (
      [opts.north, opts.south, opts.west, opts.east].every((v) => Number.isFinite(Number(v)))
    ) {
      bbox = quantizeBBox({
        north: Number(opts.north),
        south: Number(opts.south),
        west: Number(opts.west),
        east: Number(opts.east),
      });
    }
    if (!bbox) return { ok: false, cacheHit: false };

    const key = frameCacheKey(cell.id, width, height, dpi, bbox);
    const { png } = cachePaths(key);
    if (fs.existsSync(png) && fs.statSync(png).size > 1000) {
      return serveCacheHit(cell, key, width, height, dpi, bbox, "exact", { live: true });
    }

    const maxNear = Number.isFinite(Number(opts.maxNearScore)) ? Number(opts.maxNearScore) : 0.035;
    const near = findNearCache(cell.id, width, height, dpi, bbox);
    if (near && near.delta && near.delta.score <= maxNear) {
      const nearPng = cachePaths(near.key).png;
      if (fs.existsSync(nearPng) && fs.statSync(nearPng).size > 1000) {
        const hit = serveCacheHit(cell, near.key, width, height, dpi, near.bbox, "near", {
          delta: near.delta,
          live: true,
        });
        return { ...hit, nearScore: near.delta.score };
      }
    }
    return { ok: true, cacheHit: false, cellId: cell.id, key, want: key };
  }

  return {
    rescan,
    list,
    ensureRender,
    setViewport,
    ensureTile,
    lookupCache,
    pickFeature,
    screenToGeo,
    geoToScreen,
    startServer,
    status,
    cacheStats,
    stop,
    get baseUrl() {
      return baseUrl;
    },
    get overscanDefault() {
      return DEFAULT_OVERSCAN;
    },
    get tileSize() {
      return TILE_SIZE;
    },
  };
}

module.exports = { createNautilusBridge, defaultSdkRoot };
