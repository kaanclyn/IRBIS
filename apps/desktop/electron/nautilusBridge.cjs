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
  // Boundaries:   North -32.45, South -32.5333, West 60.9667, East 61
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
  // 4 decimal ≈ 11 m — aynı bakış pan/zoom cache isabeti için yeter
  return Number(n).toFixed(4);
}

/** Sabit boy kovaları → resize’ta yeni PrintChart yağmuru olmasın */
function bucketSize(width, height) {
  const w = Number(width) || 1280;
  const h = Number(height) || 720;
  const aspect = w / Math.max(1, h);
  if (w <= 1400) return { width: 1280, height: Math.round(1280 / aspect) };
  if (w <= 1700) return { width: 1600, height: Math.round(1600 / aspect) };
  return { width: 1920, height: Math.round(1920 / aspect) };
}

function quantizeBBox(b) {
  if (!b) return null;
  return clampBBox({
    north: Number(fmtCoord(b.north)),
    south: Number(fmtCoord(b.south)),
    west: Number(fmtCoord(b.west)),
    east: Number(fmtCoord(b.east)),
  });
}

function createNautilusBridge({ port = 18768 } = {}) {
  const sdkRoot = defaultSdkRoot();
  const cacheRoot = path.join(app.getPath("userData"), "nautilus-cache");
  fs.mkdirSync(cacheRoot, { recursive: true });
  log.info(`nautilus PNG cache dir: ${cacheRoot}`);

  /** @type {Map<string, { id: string, name: string, path: string, source: string }>} */
  let cells = new Map();
  /** @type {Map<string, GeoBBox>} cell default fit bbox */
  const cellFitBBox = new Map();
  /** @type {Map<string, Promise<any>>} aynı anahtar için tek uçuş */
  const inFlight = new Map();
  /** PrintChart sırası — CodeMeter Error 212 (max users) önlemi */
  let printChain = Promise.resolve();
  let server = null;
  let baseUrl = `http://127.0.0.1:${port}`;
  let listenPort = port;

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
  /** printchart | persistent — env IRBIS_NAUTILUS_MODE; default persistent if exe exists */
  const modeEnv = String(process.env.IRBIS_NAUTILUS_MODE || "").toLowerCase();
  let renderMode =
    modeEnv === "printchart" || modeEnv === "persistent"
      ? modeEnv
      : persistentExe
        ? "persistent"
        : "printchart";
  const binDir = path.join(sdkRoot, "bin");
  const qtBin = process.env.IRBIS_QT_BIN || "C:\\Qt\\5.15.2\\msvc2019_64\\bin";
  const qtPlugins = process.env.IRBIS_QT_PLUGINS || "C:\\Qt\\5.15.2\\msvc2019_64\\plugins";

  /** Long-lived C++ nautilus-renderer (stdin JSON / stdout JSON). */
  const persistent = {
    proc: null,
    buf: "",
    nextId: 1,
    /** @type {Map<number, {resolve: Function, reject: Function}>} */
    pending: new Map(),
    loadedCell: null,
    starting: null,
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
      proc.on("exit", (code) => {
        log.warn(`nautilus-renderer exit ${code}`);
        for (const [, p] of persistent.pending) p.reject(new Error("renderer exited"));
        persistent.pending.clear();
        persistent.proc = null;
        persistent.loadedCell = null;
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
      if (!bbox && loaded.viewport) {
        /* fit viewport from load */
      }
    }
    if (bbox) {
      await persistentRequest("setViewport", {
        north: bbox.north,
        south: bbox.south,
        west: bbox.west,
        east: bbox.east,
        width,
        height,
        dpi,
      });
    }
    const rendered = await persistentRequest("render", { out: jsonPath(outPng) });
    return {
      stdout: bbox
        ? `Boundaries:   North ${bbox.north}, South ${bbox.south}, West ${bbox.west}, East ${bbox.east}`
        : rendered.viewport
          ? `Boundaries:   North ${rendered.viewport.north}, South ${rendered.viewport.south}, West ${rendered.viewport.west}, East ${rendered.viewport.east}`
          : "",
      stderr: "",
      ms: rendered.ms,
      viewport: rendered.viewport || bbox || null,
      mode: "persistent",
    };
  }

  function stopPersistent() {
    if (persistent.proc) {
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
      persistent.proc = null;
      persistent.loadedCell = null;
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
      cells.set(id, {
        id,
        name,
        path: filePath,
        source: "sdk-testdata",
      });
    }
    log.info(`nautilus cells scanned: ${cells.size} · sdk=${sdkRoot}`);
    return list();
  }

  function list() {
    return [...cells.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  function cacheKey(cellId, width, height, dpi, bbox, tile) {
    if (tile) {
      // Navionics-benzeri karo anahtarı — aynı z/x/y her zaman aynı dosya
      return `${String(cellId).toUpperCase()}_z${tile.z}_x${tile.tx}_y${tile.ty}_${width}x${height}`;
    }
    const b = bbox
      ? `${fmtCoord(bbox.north)},${fmtCoord(bbox.south)},${fmtCoord(bbox.west)},${fmtCoord(bbox.east)}`
      : "fit";
    const raw = `${cellId}|${width}x${height}|${dpi}|cairo|${b}`;
    return crypto.createHash("sha1").update(raw).digest("hex").slice(0, 16);
  }

  function cachePaths(key) {
    const dir = path.join(cacheRoot, "tiles");
    fs.mkdirSync(dir, { recursive: true });
    return {
      png: path.join(dir, `${key}.png`),
      meta: path.join(dir, `${key}.json`),
    };
  }

  function loadFitBBox(cellId) {
    const id = String(cellId || "").toUpperCase();
    if (cellFitBBox.has(id)) return cellFitBBox.get(id);
    const fitMeta = path.join(cacheRoot, "tiles", `${id}_FIT.json`);
    try {
      if (fs.existsSync(fitMeta)) {
        const j = JSON.parse(fs.readFileSync(fitMeta, "utf8"));
        if (j?.bbox) {
          cellFitBBox.set(id, clampBBox(j.bbox));
          return cellFitBBox.get(id);
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function saveFitBBox(cellId, bbox) {
    const id = String(cellId || "").toUpperCase();
    if (!bbox) return;
    cellFitBBox.set(id, clampBBox(bbox));
    const fitMeta = path.join(cacheRoot, "tiles", `${id}_FIT.json`);
    fs.mkdirSync(path.dirname(fitMeta), { recursive: true });
    fs.writeFileSync(fitMeta, JSON.stringify({ cellId: id, bbox: cellFitBBox.get(id) }, null, 2), "utf8");
  }

  /** Hücre fit bbox üzerinde z seviyesinde karo (Navionics XYZ benzeri) */
  function resolveTile(fit, z, centerLon, centerLat) {
    const Z = Math.max(0, Math.min(5, Math.round(Number(z) || 0)));
    const n = 1 << Z;
    const spanLon = (fit.east - fit.west) / n;
    const spanLat = (fit.north - fit.south) / n;
    let tx = Math.floor((centerLon - fit.west) / spanLon);
    let ty = Math.floor((fit.north - centerLat) / spanLat);
    if (!Number.isFinite(tx)) tx = 0;
    if (!Number.isFinite(ty)) ty = 0;
    tx = Math.max(0, Math.min(n - 1, tx));
    ty = Math.max(0, Math.min(n - 1, ty));
    const bbox = clampBBox({
      west: fit.west + tx * spanLon,
      east: fit.west + (tx + 1) * spanLon,
      north: fit.north - ty * spanLat,
      south: fit.north - (ty + 1) * spanLat,
    });
    return { z: Z, tx, ty, n, bbox };
  }

  function cacheStats() {
    let files = 0;
    let bytes = 0;
    const dir = path.join(cacheRoot, "tiles");
    try {
      if (!fs.existsSync(dir)) return { files: 0, bytes: 0, dir };
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith(".png")) continue;
        files += 1;
        bytes += fs.statSync(path.join(dir, name)).size;
      }
    } catch {
      /* ignore */
    }
    return { files, bytes, dir };
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

  /**
   * @param {string} cellId
   * @param {{ width?: number, height?: number, dpi?: number, north?: number, south?: number, west?: number, east?: number, bbox?: GeoBBox }} opts
   */
  async function ensureRender(cellId, opts = {}) {
    const bucket = bucketSize(opts.width, opts.height);
    const width = bucket.width;
    const height = bucket.height;
    const dpi = Number(opts.dpi) || 96;
    const cell = cells.get(String(cellId || "").toUpperCase());
    if (!cell) throw new Error(`ENC hücre yok: ${cellId}`);

    let bbox = null;
    let tile = opts.tile || null;
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
    if (tile?.bbox) bbox = quantizeBBox(tile.bbox);

    const key = cacheKey(cell.id, width, height, dpi, bbox, tile);
    const existing = inFlight.get(key);
    if (existing) return existing;

    const work = (async () => {
      const { png, meta } = cachePaths(key);

      if (fs.existsSync(png) && fs.statSync(png).size > 1000) {
        let metaObj = null;
        try {
          metaObj = JSON.parse(fs.readFileSync(meta, "utf8"));
        } catch {
          /* ignore */
        }
        if (metaObj?.bbox && !tile) saveFitBBox(cell.id, metaObj.bbox);
        log.info(`nautilus CACHE HIT ${key}`);
        return {
          ok: true,
          cacheHit: true,
          cellId: cell.id,
          url: `${baseUrl}/img/${key}.png`,
          key,
          bytes: fs.statSync(png).size,
          viewport: metaObj?.bbox || bbox || loadFitBBox(cell.id) || null,
          width,
          height,
          dpi,
          tile: tile || metaObj?.tile || null,
          fit: loadFitBBox(cell.id),
          cacheDir: path.join(cacheRoot, "tiles"),
          meta: metaObj,
        };
      }

      const tmpDir = path.join(cacheRoot, "_tmp", key);
      fs.mkdirSync(tmpDir, { recursive: true });
      const t0 = Date.now();
      let stdout = "";
      let sourceName = "PrintChart";
      let painterMode = renderMode;
      let renderMs = null;

      if (renderMode === "persistent" && persistentExe) {
        try {
          const directPng = path.join(tmpDir, "frame.png");
          const result = await runPersistentRender(cell.path, directPng, width, height, dpi, bbox);
          stdout = result.stdout || "";
          renderMs = result.ms;
          sourceName = "nautilus-renderer";
          if (!fs.existsSync(directPng) || fs.statSync(directPng).size < 1000) {
            throw new Error("persistent PNG üretmedi");
          }
          fs.copyFileSync(directPng, png);
        } catch (err) {
          log.warn(`persistent render failed → PrintChart fallback: ${err.message || err}`);
          painterMode = "printchart-fallback";
          const result = await runPrintChart(cell.path, tmpDir, width, height, dpi, bbox);
          stdout = result.stdout;
          const produced = fs.readdirSync(tmpDir).find((f) => f.toLowerCase().endsWith(".png"));
          if (!produced) throw new Error("PrintChart PNG üretmedi");
          fs.copyFileSync(path.join(tmpDir, produced), png);
          sourceName = produced;
        }
      } else {
        const result = await runPrintChart(cell.path, tmpDir, width, height, dpi, bbox);
        stdout = result.stdout;
        const produced = fs.readdirSync(tmpDir).find((f) => f.toLowerCase().endsWith(".png"));
        if (!produced) throw new Error("PrintChart PNG üretmedi");
        fs.copyFileSync(path.join(tmpDir, produced), png);
        sourceName = produced;
      }

      const parsed = parseBoundaries(stdout);
      const finalBBox = bbox || parsed;
      if (!tile && finalBBox) saveFitBBox(cell.id, finalBBox);

      const metaObj = {
        cellId: cell.id,
        cellPath: cell.path,
        width,
        height,
        dpi,
        painter: "Cairo",
        renderMode: painterMode,
        renderedAt: new Date().toISOString(),
        ms: Date.now() - t0,
        drawMs: renderMs,
        sourceName,
        bbox: finalBBox,
        tile: tile
          ? { z: tile.z, tx: tile.tx, ty: tile.ty }
          : { z: 0, tx: 0, ty: 0 },
        customViewport: !!bbox,
      };
      fs.writeFileSync(meta, JSON.stringify(metaObj, null, 2), "utf8");
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      log.info(`nautilus CACHE MISS ${key} ${metaObj.ms}ms → ${png}`);
      return {
        ok: true,
        cacheHit: false,
        cellId: cell.id,
        url: `${baseUrl}/img/${key}.png`,
        key,
        bytes: fs.statSync(png).size,
        viewport: finalBBox,
        width,
        height,
        dpi,
        tile: metaObj.tile,
        fit: loadFitBBox(cell.id),
        cacheDir: path.join(cacheRoot, "tiles"),
        meta: metaObj,
      };
    })();

    inFlight.set(key, work);
    try {
      return await work;
    } finally {
      inFlight.delete(key);
    }
  }

  /** Fit bbox’u garantile — ilk açılışta TEK PrintChart; z0 karoya kopyala (çift çizim yok) */
  async function ensureFit(cellId, width, height, dpi) {
    const id = String(cellId || "").toUpperCase();
    const bucket = bucketSize(width, height);
    const fit = loadFitBBox(id);
    if (fit) {
      return ensureRender(id, {
        width: bucket.width,
        height: bucket.height,
        dpi,
        tile: { z: 0, tx: 0, ty: 0, bbox: fit },
        bbox: fit,
      });
    }

    const r = await ensureRender(id, { width: bucket.width, height: bucket.height, dpi });
    if (!r.viewport) return r;
    saveFitBBox(id, r.viewport);

    const tile = { z: 0, tx: 0, ty: 0, bbox: r.viewport };
    const z0key = cacheKey(id, bucket.width, bucket.height, dpi, r.viewport, tile);
    if (r.key !== z0key) {
      const from = cachePaths(r.key);
      const to = cachePaths(z0key);
      try {
        if (fs.existsSync(from.png) && !fs.existsSync(to.png)) {
          fs.copyFileSync(from.png, to.png);
        }
        if (fs.existsSync(from.meta)) {
          const metaObj = {
            ...JSON.parse(fs.readFileSync(from.meta, "utf8")),
            tile: { z: 0, tx: 0, ty: 0 },
          };
          fs.writeFileSync(to.meta, JSON.stringify(metaObj, null, 2), "utf8");
        }
      } catch (e) {
        log.warn("nautilus z0 copy", e);
      }
      return {
        ...r,
        key: z0key,
        url: `${baseUrl}/img/${z0key}.png`,
        tile: { z: 0, tx: 0, ty: 0 },
        fit: r.viewport,
      };
    }
    return { ...r, tile: { z: 0, tx: 0, ty: 0 }, fit: r.viewport };
  }

  async function ensureTile(cellId, opts = {}) {
    const id = String(cellId || "").toUpperCase();
    const bucket = bucketSize(opts.width, opts.height);
    const dpi = Number(opts.dpi) || 96;
    let fit = loadFitBBox(id);
    if (!fit) {
      const base = await ensureFit(id, bucket.width, bucket.height, dpi);
      fit = base.viewport || loadFitBBox(id);
    }
    if (!fit) throw new Error("fit bbox yok");

    const z = Math.max(0, Math.min(5, Math.round(Number(opts.z) || 0)));
    const centerLon =
      opts.centerLon != null ? Number(opts.centerLon) : (fit.west + fit.east) / 2;
    const centerLat =
      opts.centerLat != null ? Number(opts.centerLat) : (fit.north + fit.south) / 2;
    const tile =
      opts.tx != null && opts.ty != null
        ? resolveTile(fit, z, fit.west + ((Number(opts.tx) + 0.5) * (fit.east - fit.west)) / (1 << z), fit.north - ((Number(opts.ty) + 0.5) * (fit.north - fit.south)) / (1 << z))
        : resolveTile(fit, z, centerLon, centerLat);

    const r = await ensureRender(id, {
      width: bucket.width,
      height: bucket.height,
      dpi,
      tile,
      bbox: tile.bbox,
    });
    return { ...r, tile: { z: tile.z, tx: tile.tx, ty: tile.ty }, fit };
  }

  /**
   * Screen → geo using the same equirectangular mapping PrintChart uses for N/S/W/E extents.
   * Not a substitute for EnChartDisplay::DeviceToGeo, but matches our PNG viewport contract.
   */
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
    const width = Number(payload.width) || 1280;
    const height = Number(payload.height) || 720;
    const dpi = Number(payload.dpi) || 96;

    if (payload.action === "fit") {
      return ensureFit(cellId, width, height, dpi);
    }

    if (payload.action === "tile" || payload.action === "settle") {
      return ensureTile(cellId, {
        width,
        height,
        dpi,
        z: payload.z,
        tx: payload.tx,
        ty: payload.ty,
        centerLon: payload.centerLon,
        centerLat: payload.centerLat,
      });
    }

    let bbox = payload.bbox
      ? quantizeBBox(payload.bbox)
      : payload.north != null
        ? quantizeBBox({
            north: Number(payload.north),
            south: Number(payload.south),
            west: Number(payload.west),
            east: Number(payload.east),
          })
        : null;

    if (payload.action === "pan" && payload.viewport) {
      bbox = quantizeBBox(
        panViewport(
          clampBBox(payload.viewport),
          width,
          height,
          Number(payload.dxPx) || 0,
          Number(payload.dyPx) || 0
        )
      );
    } else if (payload.action === "zoom" && payload.viewport) {
      bbox = quantizeBBox(
        zoomViewport(
          clampBBox(payload.viewport),
          width,
          height,
          Number(payload.factor) || 1,
          Number(payload.anchorX) ?? width / 2,
          Number(payload.anchorY) ?? height / 2
        )
      );
    }

    return ensureRender(cellId, { width, height, dpi, bbox: bbox || undefined });
  }

  /**
   * Geo pick always. ENC feature pick uses PickChart.exe when built; otherwise returns geo only.
   */
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
      note: "ENC feature pick için PickChart / Qt PickReport; şimdilik coğrafi konum.",
    };

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
        const m = /^\/img\/([A-Za-z0-9_-]+)\.png$/i.exec(u);
        if (m) {
          const file = path.join(cacheRoot, "tiles", `${m[1]}.png`);
          if (!fs.existsSync(file)) {
            res.writeHead(404);
            res.end("missing");
            return;
          }
          const buf = fs.readFileSync(file);
          res.writeHead(200, {
            "Content-Type": "image/png",
            "Content-Length": buf.length,
            "Cache-Control": "public, max-age=86400",
          });
          res.end(buf);
          return;
        }
        if (u === "/health") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, cells: cells.size, cache: cacheStats() }));
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
        log.info(`nautilus image server ${baseUrl}`);
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
      cache: cacheStats(),
      d2: {
        viewportIpc: true,
        panZoom: true,
        geoPick: true,
        encPick: fs.existsSync(pickChartExe) || fs.existsSync(pickChartAlt),
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

  return {
    rescan,
    list,
    ensureRender,
    ensureTile,
    ensureFit,
    setViewport,
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
  };
}

module.exports = { createNautilusBridge, defaultSdkRoot };
