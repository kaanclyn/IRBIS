const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
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

function createNautilusBridge({ port = 18768 } = {}) {
  const sdkRoot = defaultSdkRoot();
  const frameRoot = path.join(app.getPath("userData"), "nautilus-frames");
  fs.mkdirSync(frameRoot, { recursive: true });
  // Eski tile cache dizinini temizle (bir kez)
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
      proc.on("exit", (code) => {
        log.warn(`nautilus-renderer exit ${code}`);
        for (const [, p] of persistent.pending) p.reject(new Error("renderer exited"));
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

  /**
   * Live viewport draw — no disk tile cache. Overwrites per-cell frame file.
   */
  async function ensureRender(cellId, opts = {}) {
    const width = Math.max(320, Math.min(2560, Math.round(Number(opts.width) || 1280)));
    const height = Math.max(240, Math.min(1600, Math.round(Number(opts.height) || 720)));
    const dpi = Number(opts.dpi) || 96;
    const cell = cells.get(String(cellId || "").toUpperCase());
    if (!cell) throw new Error(`ENC hücre yok: ${cellId}`);

    let bbox = null;
    if (opts.bbox) bbox = clampBBox(opts.bbox);
    else if (
      [opts.north, opts.south, opts.west, opts.east].every((v) => Number.isFinite(Number(v)))
    ) {
      bbox = clampBBox({
        north: Number(opts.north),
        south: Number(opts.south),
        west: Number(opts.west),
        east: Number(opts.east),
      });
    }

    const flightKey = `${cell.id}|${width}x${height}|${bbox ? fmtCoord(bbox.north) + fmtCoord(bbox.south) + fmtCoord(bbox.west) + fmtCoord(bbox.east) : "fit"}`;
    const existing = inFlight.get(flightKey);
    if (existing) return existing;

    const work = (async () => {
      const png = path.join(frameRoot, `${cell.id}.png`);
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
          if (result.viewport) finalBBox = clampBBox(result.viewport);
          if (!fs.existsSync(directPng) || fs.statSync(directPng).size < 1000) {
            throw new Error("persistent PNG üretmedi");
          }
          fs.copyFileSync(directPng, png);
        } catch (err) {
          log.warn(`persistent render failed → PrintChart: ${err.message || err}`);
          modeUsed = "printchart-fallback";
          const result = await runPrintChart(cell.path, tmpDir, width, height, dpi, bbox);
          stdout = result.stdout;
          const produced = fs.readdirSync(tmpDir).find((f) => f.toLowerCase().endsWith(".png"));
          if (!produced) throw new Error("PrintChart PNG üretmedi");
          fs.copyFileSync(path.join(tmpDir, produced), png);
          finalBBox = bbox || parseBoundaries(stdout);
        }
      } else {
        const result = await runPrintChart(cell.path, tmpDir, width, height, dpi, bbox);
        stdout = result.stdout;
        const produced = fs.readdirSync(tmpDir).find((f) => f.toLowerCase().endsWith(".png"));
        if (!produced) throw new Error("PrintChart PNG üretmedi");
        fs.copyFileSync(path.join(tmpDir, produced), png);
        finalBBox = bbox || parseBoundaries(stdout);
        modeUsed = "printchart";
      }

      if (!finalBBox) finalBBox = parseBoundaries(stdout);
      if (finalBBox && !bbox) cellFitBBox.set(cell.id, finalBBox);

      frameRev += 1;
      const ms = Date.now() - t0;
      log.info(`nautilus DRAW ${cell.id} ${width}x${height} ${ms}ms mode=${modeUsed} drawMs=${renderMs ?? "-"}`);

      return {
        ok: true,
        cellId: cell.id,
        url: `${baseUrl}/frame/${cell.id}.png?r=${frameRev}`,
        rev: frameRev,
        bytes: fs.statSync(png).size,
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
    const width = Number(payload.width) || 1280;
    const height = Number(payload.height) || 720;
    const dpi = Number(payload.dpi) || 96;
    const action = String(payload.action || "set");

    if (action === "fit") {
      return ensureRender(cellId, { width, height, dpi });
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

    return ensureRender(cellId, { width, height, dpi, bbox: bbox || undefined });
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
      d2: {
        viewportIpc: true,
        panZoom: true,
        geoPick: true,
        encPick: true,
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
    setViewport,
    pickFeature,
    screenToGeo,
    geoToScreen,
    startServer,
    status,
    stop,
    get baseUrl() {
      return baseUrl;
    },
  };
}

module.exports = { createNautilusBridge, defaultSdkRoot };
