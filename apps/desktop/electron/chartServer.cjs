const express = require("express");
const path = require("node:path");
const http = require("node:http");

/**
 * Local offline chart asset server (loopback only).
 * Serves tile57 bake output: PMTiles + style assets + style.json
 */
function startChartServer(chartRoot, preferredPort = 17357) {
  const app = express();
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, chartRoot });
  });

  app.use(
    express.static(chartRoot, {
      fallthrough: true,
      setHeaders(res, filePath) {
        if (filePath.endsWith(".pmtiles")) {
          res.setHeader("Content-Type", "application/octet-stream");
          res.setHeader("Accept-Ranges", "bytes");
        }
        if (filePath.endsWith(".json")) {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
        }
      },
    }),
  );

  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.once("error", reject);
    server.listen(preferredPort, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : preferredPort;
      resolve({
        server,
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        chartRoot,
      });
    });
  });
}

function defaultChartRoot() {
  // apps/desktop/electron -> repo root
  return path.resolve(__dirname, "..", "..", "..", "samples", "chart-bake");
}

module.exports = { startChartServer, defaultChartRoot };
