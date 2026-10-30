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
 * playUrl example: http://127.0.0.1:18765/cam/<id>/<kind>.mjpg
 */
function createCameraStreamProxy({ port = 18765 } = {}) {
  /** @type {Map<string, { proc: import('child_process').ChildProcess, clients: Set<import('http').ServerResponse> }>} */
  const pipes = new Map();
  const ffmpegPath = resolveFfmpeg();
  let server = null;
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

  async function startServer() {
    if (server) return baseUrl;
    server = http.createServer((req, res) => {
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
      // ffmpeg mjpeg to pipe often needs -f mpjpeg for proper boundaries;
      // clients using <img> work better with multipart. Re-spawn with mpjpeg if needed.
      pipe.clients.add(res);
      req.on("close", () => pipe.clients.delete(res));
    });

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        baseUrl = `http://127.0.0.1:${port}`;
        log.info(`camera stream proxy ${baseUrl}`);
        resolve();
      });
    });
    return baseUrl;
  }

  async function start({ cameraId, kind, rtspUrl, username, password }) {
    await startServer();
    const url = injectCredentials(rtspUrl, username, password);
    // Prefer mpjpeg for browser <img>
    const key = keyOf(cameraId, kind);
    stopKey(key);

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
    proc.on("exit", (code) => {
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
    ffmpegPath: () => ffmpegPath,
  };
}

module.exports = { createCameraStreamProxy, injectCredentials, resolveFfmpeg };
