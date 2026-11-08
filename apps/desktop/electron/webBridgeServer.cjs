/**
 * HTTP + SSE bridge so Chrome (Vite :5173) mirrors Electron live state + map/Nautilus control.
 */
const http = require("node:http");
const { log } = require("./log.cjs");

const DEFAULT_PORT = Number(process.env.IRBIS_WEB_BRIDGE_PORT || 18769);

/**
 * @param {{
 *   port?: number,
 *   getOwnShip: () => unknown,
 *   getAis: () => unknown,
 *   getMapCatalog: () => unknown,
 *   setMapEngine: (engine: string) => unknown,
 *   setNautilusCell: (cellId: string) => unknown,
 *   nautilusRescan: () => unknown,
 *   nautilusSetViewport: (payload: object) => Promise<unknown>,
 *   nautilusPick: (payload: object) => Promise<unknown>,
 * }} opts
 */
function createWebBridgeServer(opts) {
  const port = opts.port ?? DEFAULT_PORT;
  /** @type {Set<import('http').ServerResponse>} */
  const sseClients = new Set();
  /** @type {import('http').Server | null} */
  let server = null;

  function cors(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }

  function json(res, code, body) {
    cors(res);
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        try {
          const raw = Buffer.concat(chunks).toString("utf8");
          resolve(raw ? JSON.parse(raw) : {});
        } catch (err) {
          reject(err);
        }
      });
      req.on("error", reject);
    });
  }

  function writeSse(res, event, data) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  function publish(channel, payload) {
    if (!sseClients.size) return;
    const event =
      channel === "irbis:ownship"
        ? "ownship"
        : channel === "irbis:ais"
          ? "ais"
          : channel === "irbis:map-engine-changed" || channel === "irbis:chart-changed"
            ? "map"
            : null;
    if (!event) return;
    const data = event === "map" ? opts.getMapCatalog() : payload;
    for (const res of [...sseClients]) {
      try {
        writeSse(res, event, data);
      } catch {
        try {
          res.end();
        } catch {
          /* ignore */
        }
        sseClients.delete(res);
      }
    }
  }

  function start() {
    if (server) return { port, baseUrl: `http://127.0.0.1:${port}` };

    server = http.createServer((req, res) => {
      const url = (req.url || "/").split("?")[0];
      if (req.method === "OPTIONS") {
        cors(res);
        res.writeHead(204);
        res.end();
        return;
      }

      void (async () => {
        try {
          if (req.method === "GET" && url === "/api/health") {
            json(res, 200, { ok: true, sse: sseClients.size });
            return;
          }

          if (req.method === "GET" && url === "/api/ownship") {
            json(res, 200, opts.getOwnShip() ?? null);
            return;
          }

          if (req.method === "GET" && url === "/api/ais") {
            json(res, 200, opts.getAis() ?? { targets: [], count: 0 });
            return;
          }

          if (req.method === "GET" && url === "/api/map-catalog") {
            json(res, 200, opts.getMapCatalog() ?? null);
            return;
          }

          if (req.method === "POST" && url === "/api/map-engine") {
            const body = await readJson(req);
            const out = opts.setMapEngine(String(body.engine || "navionics"));
            json(res, 200, { ok: true, ...out });
            return;
          }

          if (req.method === "POST" && url === "/api/nautilus-cell") {
            const body = await readJson(req);
            const out = opts.setNautilusCell(String(body.cellId || ""));
            json(res, 200, { ok: true, ...out });
            return;
          }

          if (req.method === "POST" && url === "/api/nautilus-rescan") {
            const cells = opts.nautilusRescan() ?? [];
            json(res, 200, { ok: true, cells });
            return;
          }

          if (req.method === "POST" && url === "/api/nautilus-set-viewport") {
            const body = await readJson(req);
            const out = await opts.nautilusSetViewport(body || {});
            json(res, 200, out);
            return;
          }

          if (req.method === "POST" && url === "/api/nautilus-pick") {
            const body = await readJson(req);
            const out = await opts.nautilusPick(body || {});
            json(res, 200, out);
            return;
          }

          if (req.method === "GET" && url === "/api/events") {
            cors(res);
            res.writeHead(200, {
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
              Connection: "keep-alive",
            });
            res.write(": connected\n\n");
            sseClients.add(res);
            try {
              writeSse(res, "ownship", opts.getOwnShip() ?? null);
              writeSse(res, "ais", opts.getAis() ?? { targets: [], count: 0 });
              writeSse(res, "map", opts.getMapCatalog() ?? null);
            } catch {
              /* ignore */
            }
            req.on("close", () => {
              sseClients.delete(res);
            });
            return;
          }

          json(res, 404, { error: "not_found" });
        } catch (err) {
          json(res, 500, { ok: false, error: String(err?.message || err) });
        }
      })();
    });

    server.listen(port, "127.0.0.1");
    log.info(
      `web bridge http://127.0.0.1:${port} · ownship/ais/map/nautilus`,
    );
    return { port, baseUrl: `http://127.0.0.1:${port}` };
  }

  function stop() {
    for (const res of sseClients) {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
    sseClients.clear();
    if (server) {
      try {
        server.close();
      } catch {
        /* ignore */
      }
      server = null;
    }
  }

  return { start, stop, publish, port };
}

module.exports = { createWebBridgeServer, DEFAULT_PORT };
