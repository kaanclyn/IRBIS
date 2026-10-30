const http = require("node:http");
const { spawn } = require("node:child_process");
const { log } = require("./log.cjs");

function resolveFfmpeg() {
  try {
    const ffmpegStatic = require("ffmpeg-static");
    if (ffmpegStatic) return ffmpegStatic;
  } catch {
    /* fallback */
  }
  return process.env.FFMPEG_PATH || "ffmpeg";
}

function injectCredentials(rtspUrl, username, password) {
  if (!rtspUrl || !username) return rtspUrl;
  try {
    const u = new URL(rtspUrl);
    if (!u.username) {
      u.username = username;
      u.password = password || "";
    }
    return u.toString();
  } catch {
    return rtspUrl;
  }
}

/**
 * Local HTTP MJPEG proxy: ffmpeg pulls RTSP and serves multipart JPEG.
 * Default 18766 — Navionics tiles already use 18765.
 * playUrl example: http://127.0.0.1:18766/cam/<id>/<kind>.mjpg
 */
function createCameraStreamProxy({ port = 18766 } = {}) {
  /** @type {Map<string, { proc: import('child_process').ChildProcess, clients: Set<import('http').ServerResponse> }>} */
  const pipes = new Map();
  const ffmpegPath = resolveFfmpeg();
  let server = null;
  let listenPort = port;
  let baseUrl = `http://127.0.0.1:${port}`;

  function keyOf(cameraId, kind) {
    return `${cameraId}::${kind}`;
  }

  function stopKey(key) {
    const pipe = pipes.get(key);
    if (!pipe) return;
    for (const res of pipe.clients) {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
    pipe.clients.clear();
    try {
      pipe.proc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    pipes.delete(key);
  }

  function tryListen(preferred) {
    return new Promise((resolve, reject) => {
      const candidates = [preferred, preferred + 1, preferred + 2, preferred + 3, 0];
      let idx = 0;

      const attempt = () => {
        if (idx >= candidates.length) {
          reject(new Error("camera stream proxy: no free port"));
          return;
        }
        const want = candidates[idx++];
        const s = http.createServer((req, res) => {
          const m = /^\/cam\/([^/]+)\/(visible|thermal)\.mjpg\/?$/.exec(req.url || "");
          if (!m) {
            res.writeHead(404);
            res.end("not found");
            return;
          }
          const cameraId = decodeURIComponent(m[1]);
          const kind = m[2];
          const key = keyOf(cameraId, kind);
          const pipe = pipes.get(key);
          if (!pipe) {
            res.writeHead(503, { "Content-Type": "text/plain" });
            res.end("stream offline");
            return;
          }
          res.writeHead(200, {
            "Content-Type": "multipart/x-mixed-replace; boundary=ffmpeg",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Connection: "close",
            Pragma: "no-cache",
          });
          pipe.clients.add(res);
          req.on("close", () => pipe.clients.delete(res));
        });

        const onErr = (err) => {
          s.off("listening", onListen);
          try {
            s.close();
          } catch {
            /* ignore */
          }
          if (err && err.code === "EADDRINUSE") {
            log.warn(`camera proxy port ${want} busy, trying next`);
            attempt();
            return;
          }
          reject(err);
        };

        const onListen = () => {
          s.off("error", onErr);
          const addr = s.address();
          listenPort = typeof addr === "object" && addr ? addr.port : want;
          baseUrl = `http://127.0.0.1:${listenPort}`;
          server = s;
          log.info(`camera stream proxy ${baseUrl}`);
          resolve(baseUrl);
        };

        s.once("error", onErr);
        s.once("listening", onListen);
        s.listen(want, "127.0.0.1");
      };

      attempt();
    });
  }

  async function startServer() {
    if (server) return baseUrl;
    return tryListen(listenPort || port);
  }

  async function start({ cameraId, kind, rtspUrl, username, password }) {
    await startServer();
    const url = injectCredentials(rtspUrl, username, password);
    const key = keyOf(cameraId, kind);
    stopKey(key);

    log.info(`ffmpeg start ${key}`, String(url).replace(/:[^:@/]+@/, ":***@").slice(0, 120));

    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-rtsp_transport",
      "tcp",
      "-i",
      url,
      "-an",
      "-f",
      "mpjpeg",
      "-q:v",
      "7",
      "-r",
      "8",
      "pipe:1",
    ];
    const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const clients = new Set();
    const pipe = { proc, clients, cameraId, kind };
    pipes.set(key, pipe);

    proc.stderr?.on("data", (buf) => {
      const msg = buf.toString().trim();
      if (msg) log.warn(`ffmpeg ${key}`, msg.slice(0, 240));
    });
    proc.on("exit", (code, signal) => {
      log.warn(`ffmpeg exit ${key}`, { code, signal });
      for (const res of clients) {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
      clients.clear();
      if (pipes.get(key) === pipe) pipes.delete(key);
    });
    proc.stdout?.on("data", (chunk) => {
      for (const res of clients) {
        try {
          res.write(chunk);
        } catch {
          clients.delete(res);
        }
      }
    });

    return `${baseUrl}/cam/${encodeURIComponent(cameraId)}/${kind}.mjpg`;
  }

  function stopCamera(cameraId) {
    for (const key of [...pipes.keys()]) {
      if (key.startsWith(`${cameraId}::`)) stopKey(key);
    }
  }

  function stop() {
    for (const key of [...pipes.keys()]) stopKey(key);
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
    start,
    stopCamera,
    stop,
    get baseUrl() {
      return baseUrl;
    },
    get port() {
      return listenPort;
    },
    ffmpegPath: () => ffmpegPath,
  };
}

module.exports = { createCameraStreamProxy, injectCredentials, resolveFfmpeg };
