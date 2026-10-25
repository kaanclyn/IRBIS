const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { log } = require("./log.cjs");

/**
 * Temporary naval chart layer: serve NDataReader offline Navionics cache.
 * Default: %USERPROFILE%\Documents\NDataReader\bizim-harita (offline-only).
 * S-63 OEM comes later — this is the interim map.
 */

function defaultBizimHarita() {
  const fromEnv = process.env.IRBIS_NAVIONICS_CACHE?.trim();
  if (fromEnv) return fromEnv;
  return path.join(os.homedir(), "Documents", "NDataReader", "bizim-harita");
}

function resolveNavionicsModule() {
  // Prefer repo copy under LIB/NDATAREADER (same code as NDataReader app).
  const candidates = [
    path.resolve(__dirname, "..", "..", "..", "LIB", "NDATAREADER", "src", "charts", "NavionicsTileServer.js"),
    path.resolve(__dirname, "..", "..", "..", "NDATAREADER", "src", "charts", "NavionicsTileServer.js"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * @param {{ port?: number, offlineOnly?: boolean }} [opts]
 */
async function startNavionicsServer(opts = {}) {
  const cacheDir = defaultBizimHarita();
  const port = opts.port ?? Number(process.env.IRBIS_NAVIONICS_PORT || 18765);
  const offlineOnly = opts.offlineOnly !== false; // default offline

  if (!fs.existsSync(cacheDir)) {
    log.warn(`Navionics cache missing: ${cacheDir}`);
    return {
      running: false,
      port,
      cacheDir,
      offlineOnly,
      error: "bizim-harita yok",
      tileUrlTemplate: null,
      sonarUrlTemplate: null,
    };
  }

  const modPath = resolveNavionicsModule();
  if (!modPath) {
    log.warn("NavionicsTileServer.js not found under LIB/NDATAREADER");
    return {
      running: false,
      port,
      cacheDir,
      offlineOnly,
      error: "NavionicsTileServer eksik",
      tileUrlTemplate: null,
      sonarUrlTemplate: null,
    };
  }

  // eslint-disable-next-line import/no-dynamic-require
  const NavionicsTileServer = require(modPath);
  const server = new NavionicsTileServer(port, cacheDir);
  server.setOfflineOnly(offlineOnly);
  const status = await server.start();
  log.info(
    `Navionics tile server :${port} -> ${cacheDir} (offline=${offlineOnly}, cache≈${status.cache?.count ?? 0} tiles)`,
  );
  return {
    running: true,
    port,
    cacheDir,
    offlineOnly,
    server,
    tileUrlTemplate: status.tileUrlTemplate || `http://127.0.0.1:${port}/navionics/{z}/{x}/{y}.png`,
    sonarUrlTemplate: status.sonarUrlTemplate || `http://127.0.0.1:${port}/sonar/{z}/{x}/{y}.png`,
    cache: status.cache,
    getStatus: () => server.getStatus(),
    stop: () => server.stop(),
  };
}

module.exports = { startNavionicsServer, defaultBizimHarita };
