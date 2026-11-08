const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { startChartServer, defaultChartRoot } = require("./chartServer.cjs");
const { createChartLibrary } = require("./chartLibrary.cjs");
const { createNmeaService } = require("./nmeaService.cjs");
const { startNavionicsServer } = require("./navionicsServer.cjs");
const { createCameraRegistry } = require("./cameraRegistry.cjs");
const { createCameraStreamProxy } = require("./cameraStreamProxy.cjs");
const { createOnvifService } = require("./onvifService.cjs");
const { createNautilusBridge } = require("./nautilusBridge.cjs");
const { createMapEngineStore } = require("./mapEngineStore.cjs");
const { createWebBridgeServer } = require("./webBridgeServer.cjs");
const { log } = require("./log.cjs");

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {{ server: import('http').Server, port: number, baseUrl: string, chartRoot: string } | null} */
let chartServer = null;
/** @type {Awaited<ReturnType<typeof startNavionicsServer>> | null} */
let navionics = null;
/** @type {ReturnType<typeof createNmeaService> | null} */
let nmea = null;
/** @type {ReturnType<typeof createChartLibrary> | null} */
let chartLib = null;
/** @type {ReturnType<typeof createCameraRegistry> | null} */
let cameras = null;
/** @type {ReturnType<typeof createCameraStreamProxy> | null} */
let camProxy = null;
/** @type {ReturnType<typeof createOnvifService> | null} */
let onvif = null;
/** @type {ReturnType<typeof createNautilusBridge> | null} */
let nautilus = null;
/** @type {ReturnType<typeof createMapEngineStore> | null} */
let mapEngine = null;
/** @type {ReturnType<typeof createWebBridgeServer> | null} */
let webBridge = null;

function ensureChartLibrary() {
  if (!chartLib) chartLib = createChartLibrary();
  return chartLib;
}

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
  try {
    webBridge?.publish?.(channel, payload);
  } catch {
    /* ignore */
  }
}

async function ensureChartServer() {
  if (chartServer) return chartServer;
  const chartRoot = process.env.IRBIS_CHART_ROOT || defaultChartRoot();
  chartServer = await startChartServer(chartRoot);
  log.info(`chart server ${chartServer.baseUrl} -> ${chartRoot}`);
  return chartServer;
}

function ensureNmea() {
  if (nmea) return nmea;
  nmea = createNmeaService({ broadcast });
  nmea.start();
  return nmea;
}

function resolveDevUrl() {
  const fromEnv = process.env.VITE_DEV_SERVER_URL?.trim();
  if (fromEnv) return fromEnv;
  const distIndex = path.join(__dirname, "..", "dist", "index.html");
  if (!fs.existsSync(distIndex)) {
    log.warn("VITE_DEV_SERVER_URL missing and dist/ absent — fallback http://127.0.0.1:5173");
    return "http://127.0.0.1:5173";
  }
  return null;
}

function createWindow() {
  const iconPath = path.join(__dirname, "icon.png");
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 880,
    minHeight: 560,
    backgroundColor: "#07090c",
    title: "IRBIS",
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    show: false,
    frame: false,
    titleBarStyle: "hidden",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Remove default application menu (File/Edit/View…)
  const { Menu } = require("electron");
  Menu.setApplicationMenu(null);

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    log.info("window ready-to-show");
  });

  mainWindow.on("maximize", () => broadcast("irbis:window-state", { maximized: true }));
  mainWindow.on("unmaximize", () => broadcast("irbis:window-state", { maximized: false }));

  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    log.error("did-fail-load", { code, desc, url });
    const html = `<!doctype html><html><body style="background:#111;color:#eee;font-family:sans-serif;padding:24px">
      <h1>IRBIS yüklenemedi</h1>
      <p>code=${code}</p><p>${desc}</p><p>${url}</p>
      <p>Log: ${log.path}</p>
      <p>Vite çalışıyor mu? <code>http://127.0.0.1:5173</code></p>
    </body></html>`;
    mainWindow?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });

  mainWindow.webContents.on("did-finish-load", () => {
    log.info("did-finish-load", mainWindow?.webContents.getURL());
  });

  mainWindow.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    const tag = ["verbose", "info", "warning", "error"][level] || String(level);
    writeRendererLog(tag, `${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    log.error("render-process-gone", details);
  });

  const devUrl = resolveDevUrl();
  log.info("boot", {
    VITE_DEV_SERVER_URL: process.env.VITE_DEV_SERVER_URL || null,
    resolvedDevUrl: devUrl,
    logFile: log.path,
  });

  if (devUrl) {
    mainWindow.loadURL(devUrl);
    // DevTools: only when IRBIS_DEVTOOLS=1 (not by default)
    if (process.env.IRBIS_DEVTOOLS === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    const file = path.join(__dirname, "..", "dist", "index.html");
    log.info("loadFile", file);
    mainWindow.loadFile(file);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function writeRendererLog(level, msg) {
  log.info(`[renderer:${level}] ${msg}`);
}

app.whenReady().then(async () => {
  log.info("app ready", { versions: process.versions });
  try {
    await ensureChartServer();
  } catch (err) {
    log.error("chart server failed", err);
  }

  try {
    navionics = await startNavionicsServer({ offlineOnly: true });
  } catch (err) {
    log.error("navionics tile server failed", err);
    navionics = null;
  }

  try {
    ensureNmea();
  } catch (err) {
    log.error("nmea service failed", err);
  }

  try {
    cameras = createCameraRegistry({ broadcast });
    // Navionics tiles already bind 18765 — camera MJPEG proxy uses 18766+
    camProxy = createCameraStreamProxy({
      port: Number(process.env.IRBIS_CAMERA_PROXY_PORT || 18766),
      onStreamEvent: ({ cameraId, kind, playUrl, alive }) => {
        try {
          if (playUrl) cameras?.patchPlayUrl?.(cameraId, kind, playUrl);
          cameras?.patchStatus?.(
            cameraId,
            alive ? "online" : "reconnecting",
            alive ? null : "stream reconnecting",
          );
        } catch (err) {
          log.warn("camera stream event", err?.message || err);
        }
      },
    });
    onvif = createOnvifService({ registry: cameras, streamProxy: camProxy, broadcast });
    void onvif.hydrateProxies().catch((err) => log.warn("camera hydrate", err));
  } catch (err) {
    log.error("onvif camera service failed", err);
  }

  try {
    mapEngine = createMapEngineStore();
    nautilus = createNautilusBridge({
      port: Number(process.env.IRBIS_NAUTILUS_PORT || 18768),
    });
    nautilus.rescan();
    void nautilus.startServer().catch((err) => log.warn("nautilus server", err));
  } catch (err) {
    log.error("nautilus bridge failed", err);
    nautilus = null;
  }

  try {
    webBridge = createWebBridgeServer({
      port: Number(process.env.IRBIS_WEB_BRIDGE_PORT || 18769),
      getOwnShip: () => nmea?.getState() ?? null,
      getAis: () => nmea?.getAis() ?? { targets: [], count: 0 },
      getMapCatalog: () => buildMapCatalog(),
      setMapEngine: (engine) => {
        const state = mapEngine?.setEngine(String(engine || "navionics"));
        broadcast("irbis:map-engine-changed", state);
        broadcast("irbis:chart-changed", { engine: state?.engine });
        return state;
      },
      setNautilusCell: (cellId) => {
        const state = mapEngine?.setNautilusCell(String(cellId || ""));
        broadcast("irbis:map-engine-changed", state);
        broadcast("irbis:chart-changed", { engine: "nautilus", cellId });
        return state;
      },
      nautilusRescan: () => nautilus?.rescan?.() ?? [],
      nautilusSetViewport: async (payload) => {
        if (!nautilus) throw new Error("Nautilus bridge yok");
        const cellId = payload?.cellId || mapEngine?.get()?.nautilusCellId;
        return nautilus.setViewport({ ...payload, cellId });
      },
      nautilusPick: async (payload) => {
        if (!nautilus) throw new Error("Nautilus bridge yok");
        const cellId = payload?.cellId || mapEngine?.get()?.nautilusCellId;
        return nautilus.pickFeature({ ...payload, cellId });
      },
    });
    webBridge.start();
  } catch (err) {
    log.error("web bridge failed", err);
    webBridge = null;
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  try {
    webBridge?.stop?.();
  } catch {
    /* ignore */
  }
  webBridge = null;
  nmea?.stop();
  nmea = null;
  try {
    onvif?.stop?.();
  } catch {
    /* ignore */
  }
  onvif = null;
  try {
    camProxy?.stop?.();
  } catch {
    /* ignore */
  }
  camProxy = null;
  cameras = null;
  try {
    navionics?.stop?.();
  } catch {
    /* ignore */
  }
  navionics = null;
  try {
    nautilus?.stop?.();
  } catch {
    /* ignore */
  }
  nautilus = null;
  mapEngine = null;
  if (chartServer) {
    chartServer.server.close();
    chartServer = null;
  }
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("irbis:get-app-info", () => ({
  name: "IRBIS",
  version: app.getVersion(),
  platform: process.platform,
  logPath: log.path,
}));

ipcMain.handle("irbis:window-minimize", () => {
  mainWindow?.minimize();
});

ipcMain.handle("irbis:window-maximize-toggle", () => {
  if (!mainWindow) return { maximized: false };
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return { maximized: mainWindow.isMaximized() };
});

ipcMain.handle("irbis:window-close", () => {
  mainWindow?.close();
});

ipcMain.handle("irbis:window-is-maximized", () => ({
  maximized: mainWindow?.isMaximized() ?? false,
}));

ipcMain.handle("irbis:get-chart-config", async () => {
  const svc = await ensureChartServer();
  const lib = ensureChartLibrary();
  const cfg = lib.getActiveConfig(svc.baseUrl);
  const navOk = !!(navionics?.running && navionics.tileUrlTemplate);
  const prefs = mapEngine?.get?.() ?? { engine: "navionics", nautilusCellId: null };
  const wantNautilus = prefs.engine === "nautilus" && !!nautilus;

  if (wantNautilus) {
    const cells = nautilus.list();
    const active =
      cells.find((c) => c.id === prefs.nautilusCellId) || cells[0] || null;
    return {
      ...cfg,
      mapMode: "nautilus",
      mapEngine: "nautilus",
      navionics: null,
      nautilus: {
        cellId: active?.id ?? null,
        cells,
        status: nautilus.status(),
      },
      cellName: active?.id || "NAUTILUS",
      bakeReady: true,
      readyCells: [],
      warning: active
        ? `Nautilus ENC · ${active.id} · ${nautilus.status()?.renderMode || "draw"}`
        : "Nautilus · ENC hücre yok",
      hideWorldBasemap: true,
      center: [61.0, -32.49],
      zoom: 12,
    };
  }

  return {
    ...cfg,
    mapMode: navOk ? "navionics" : cfg.mapMode || "s57-lab",
    mapEngine: "navionics",
    navionics: navOk
      ? {
          tileUrl: navionics.tileUrlTemplate,
          sonarUrl: navionics.sonarUrlTemplate,
          cacheDir: navionics.cacheDir,
          offlineOnly: navionics.offlineOnly,
          cache: navionics.cache,
        }
      : null,
    nautilus: nautilus ? { cells: nautilus.list(), status: nautilus.status() } : null,
    ...(navOk
      ? {
          center: [29.2768, 40.82281],
          zoom: 12.2,
          worldCenter: [29.2768, 40.82281],
          worldZoom: 11.5,
          cellName: "NAVIONICS",
          bakeReady: true,
          readyCells: [],
          warning: `Navionics · sim Tuzla (pcap) · ${navionics.cache?.count ?? "?"} karo`,
          hideWorldBasemap: true,
        }
      : {}),
  };
});

function buildMapCatalog() {
  const prefs = mapEngine?.get?.() ?? { engine: "navionics", nautilusCellId: null };
  const navOk = !!(navionics?.running && navionics.tileUrlTemplate);
  return {
    engine: prefs.engine,
    nautilusCellId: prefs.nautilusCellId,
    sources: [
      {
        id: "navionics",
        label: "Navionics (offline karo)",
        available: navOk,
        detail: navOk
          ? `${navionics.cacheDir} · ~${navionics.cache?.count ?? "?"} tile`
          : navionics?.error || "Navionics yok",
      },
      {
        id: "nautilus",
        label: "Nautilus ENC (SevenCs)",
        available: !!nautilus && nautilus.list().length > 0,
        detail: nautilus
          ? `${nautilus.list().length} hücre · ${nautilus.status()?.renderMode || "draw"}`
          : "Nautilus bridge yok",
      },
    ],
    nautilusCells: nautilus?.list() ?? [],
    nautilusStatus: nautilus?.status() ?? null,
    navionics: navOk
      ? { cacheDir: navionics.cacheDir, cache: navionics.cache, offlineOnly: navionics.offlineOnly }
      : null,
  };
}

ipcMain.handle("irbis:get-map-catalog", () => buildMapCatalog());

ipcMain.handle("irbis:set-map-engine", (_e, engine) => {
  const state = mapEngine?.setEngine(String(engine || "navionics"));
  broadcast("irbis:map-engine-changed", state);
  broadcast("irbis:chart-changed", { engine: state?.engine });
  return { ok: true, ...state };
});

ipcMain.handle("irbis:set-nautilus-cell", (_e, cellId) => {
  const state = mapEngine?.setNautilusCell(String(cellId || ""));
  broadcast("irbis:map-engine-changed", state);
  broadcast("irbis:chart-changed", { engine: "nautilus", cellId });
  return { ok: true, ...state };
});

ipcMain.handle("irbis:nautilus-render", async (_e, payload) => {
  if (!nautilus) throw new Error("Nautilus bridge yok");
  const cellId = payload?.cellId || mapEngine?.get()?.nautilusCellId;
  return nautilus.ensureRender(cellId, {
    width: payload?.width,
    height: payload?.height,
    dpi: payload?.dpi,
    north: payload?.north,
    south: payload?.south,
    west: payload?.west,
    east: payload?.east,
    bbox: payload?.bbox,
  });
});

ipcMain.handle("irbis:nautilus-set-viewport", async (_e, payload) => {
  if (!nautilus) throw new Error("Nautilus bridge yok");
  const cellId = payload?.cellId || mapEngine?.get()?.nautilusCellId;
  return nautilus.setViewport({ ...payload, cellId });
});

ipcMain.handle("irbis:nautilus-cache-lookup", async (_e, payload) => {
  if (!nautilus) throw new Error("Nautilus bridge yok");
  const cellId = payload?.cellId || mapEngine?.get()?.nautilusCellId;
  return nautilus.lookupCache({ ...payload, cellId });
});

ipcMain.handle("irbis:nautilus-ensure-tile", async (_e, payload) => {
  if (!nautilus) throw new Error("Nautilus bridge yok");
  const cellId = payload?.cellId || mapEngine?.get()?.nautilusCellId;
  return nautilus.ensureTile({ ...payload, cellId });
});

ipcMain.handle("irbis:nautilus-pick", async (_e, payload) => {
  if (!nautilus) throw new Error("Nautilus bridge yok");
  const cellId = payload?.cellId || mapEngine?.get()?.nautilusCellId;
  return nautilus.pickFeature({ ...payload, cellId });
});

ipcMain.handle("irbis:nautilus-rescan", () => {
  if (!nautilus) return [];
  return nautilus.rescan();
});

ipcMain.handle("irbis:nautilus-s63-status", () => {
  if (!nautilus?.getS63Status) return { ready: false, error: "Nautilus yok" };
  return nautilus.getS63Status();
});

ipcMain.handle("irbis:nautilus-s63-setup", async (_e, payload) => {
  if (!nautilus?.setupS63) throw new Error("Nautilus S-63 API yok — renderer güncelle");
  try {
    const status = await nautilus.setupS63(payload || {});
    broadcast("irbis:map-engine-changed", mapEngine?.get?.() ?? {});
    broadcast("irbis:chart-changed", { engine: "nautilus", s63: true });
    return { ok: true, ...status };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), ...(nautilus.getS63Status?.() || {}) };
  }
});

ipcMain.handle("irbis:get-chart-library", () => ensureChartLibrary().snapshot());

ipcMain.handle("irbis:pick-enc-folder", async () => {
  const lib = ensureChartLibrary();
  return lib.pickEncFolder(mainWindow);
});

ipcMain.handle("irbis:set-active-cell", (_e, name) => {
  const lib = ensureChartLibrary();
  const result = lib.setActiveCell(String(name || ""));
  if (result.ok) {
    broadcast("irbis:chart-changed", { cellName: lib.snapshot().activeCell });
  }
  return result;
});

ipcMain.handle("irbis:rescan-charts", () => ensureChartLibrary().rescan());

ipcMain.handle("irbis:get-ownship", () => nmea?.getState() ?? null);

ipcMain.handle("irbis:get-ais", () => nmea?.getAis() ?? { targets: [], count: 0 });

ipcMain.handle("irbis:sim-control", (_e, cmd) => {
  if (!nmea?.controlSim) return { ok: false, error: "sim yok" };
  return { ok: true, ...nmea.controlSim(cmd || {}) };
});

ipcMain.handle("irbis:sim-status", () => nmea?.cruiseStatus?.() ?? { running: false });

ipcMain.handle("irbis:camera-list", () => cameras?.snapshot() ?? { activeId: null, activeStream: "visible", cameras: [], count: 0 });

ipcMain.handle("irbis:camera-discover", async (_e, opts) => {
  if (!onvif) return [];
  return onvif.discover(opts?.timeoutMs ?? 5000);
});

ipcMain.handle("irbis:camera-add", async (_e, payload) => {
  if (!onvif) throw new Error("ONVIF servisi yok");
  return onvif.addCamera(payload || {});
});

ipcMain.handle("irbis:camera-remove", async (_e, id) => {
  if (!onvif) return cameras?.snapshot();
  return onvif.removeCamera(String(id || ""));
});

ipcMain.handle("irbis:camera-set-active", (_e, id) => cameras?.setActive(String(id || "")) ?? { ok: false });

ipcMain.handle("irbis:camera-set-stream", (_e, kind) => cameras?.setActiveStream(kind) ?? null);

ipcMain.handle("irbis:camera-refresh", async (_e, id) => {
  if (!onvif) return cameras?.snapshot();
  return onvif.refreshStreams(String(id || ""));
});

ipcMain.handle("irbis:camera-ptz", async (_e, payload) => {
  if (!onvif) return { ok: false, error: "ONVIF yok" };
  return onvif.ptz(payload || {});
});
