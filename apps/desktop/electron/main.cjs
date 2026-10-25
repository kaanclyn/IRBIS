const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { startChartServer, defaultChartRoot } = require("./chartServer.cjs");
const { createChartLibrary } = require("./chartLibrary.cjs");
const { createNmeaService } = require("./nmeaService.cjs");
const { startNavionicsServer } = require("./navionicsServer.cjs");
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

function ensureChartLibrary() {
  if (!chartLib) chartLib = createChartLibrary();
  return chartLib;
}

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
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

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  nmea?.stop();
  nmea = null;
  try {
    navionics?.stop?.();
  } catch {
    /* ignore */
  }
  navionics = null;
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
  return {
    ...cfg,
    // Interim naval map: offline Navionics from Documents/NDataReader/bizim-harita
    mapMode: navOk ? "navionics" : cfg.mapMode || "s57-lab",
    navionics: navOk
      ? {
          tileUrl: navionics.tileUrlTemplate,
          sonarUrl: navionics.sonarUrlTemplate,
          cacheDir: navionics.cacheDir,
          offlineOnly: navionics.offlineOnly,
          cache: navionics.cache,
        }
      : null,
    // Prefer Turkey overview when Navionics is the primary chart
    ...(navOk
      ? {
          // Default view: Tuzla / İzmit Körfezi (AISveGPS.pcapng sim scenario)
          center: [29.2768, 40.82281],
          zoom: 12.2,
          worldCenter: [29.2768, 40.82281],
          worldZoom: 11.5,
          cellName: "NAVIONICS",
          bakeReady: true,
          // Keep NOAA quilt off by default under Navionics (S-57 lab still in library)
          readyCells: [],
          warning: `Navionics · sim Tuzla (pcap) · ${navionics.cache?.count ?? "?"} karo`,
          hideWorldBasemap: true,
        }
      : {}),
  };
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
