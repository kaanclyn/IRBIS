const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { log } = require("./log.cjs");

const BOUNDARY = "irbisframe";

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

function injectHttpCredentials(url, username, password) {
  if (!url || !username) return url;
  try {
    const u = new URL(url);
    if (!u.username) {
      u.username = username;
      u.password = password || "";
    }
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Windows'ta bazı RTSP kaynakları pipe:1'e 0 byte yazar.
 * image2 -update dosyaya yazmak + poll daha güvenilir.
 */
function buildFfmpegArgs(rtspUrl, outFile) {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-rtsp_transport",
    "tcp",
    "-fflags",
    "nobuffer+genpts+discardcorrupt",
    "-flags",
    "low_delay",
    "-i",
    rtspUrl,
    "-an",
    "-vf",
    "fps=6",
    "-c:v",
    "mjpeg",
    "-q:v",
    "7",
    "-f",
    "image2",
    "-update",
    "1",
    "-y",
    outFile,
  ];
}

function writeMultipartFrame(res, jpeg) {
  res.write(
    `--${BOUNDARY}\r\n` +
      `Content-Type: image/jpeg\r\n` +
      `Content-Length: ${jpeg.length}\r\n` +
      `\r\n`,
  );
  res.write(jpeg);
  res.write(`\r\n`);
}

function fetchJpeg(url, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      reject(err);
      return;
    }
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.get(
      url,
      {
        timeout: timeoutMs,
        headers: { Connection: "close", Accept: "image/jpeg,*/*" },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300 && buf.length > 64) {
            // SOI check
            if (buf[0] === 0xff && buf[1] === 0xd8) resolve(buf);
            else reject(new Error(`not jpeg (${res.statusCode}, ${buf.length}b)`));
          } else {
            reject(new Error(`http ${res.statusCode || "?"} ${buf.length}b`));
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

/**
 * Local HTTP proxy:
 *  - /cam/:id/:kind.mjpg  multipart MJPEG (boundary=irbisframe)
 *  - /cam/:id/:kind.jpg   son kare (polling)
 */
function createCameraStreamProxy({ port = 18766, onStreamEvent } = {}) {
  /** @type {Map<string, any>} */
  const sessions = new Map();
  const ffmpegPath = resolveFfmpeg();
  const tmpRoot = path.join(os.tmpdir(), "irbis-cam");
  try {
    fs.mkdirSync(tmpRoot, { recursive: true });
  } catch {
    /* ignore */
  }
  let server = null;
  let listenPort = port;
  let baseUrl = `http://127.0.0.1:${port}`;

  function keyOf(cameraId, kind) {
    return `${cameraId}::${kind}`;
  }

  function playUrlFor(session) {
    return `${baseUrl}/cam/${encodeURIComponent(session.cameraId)}/${session.kind}.mjpg?g=${session.generation}`;
  }

  function snapUrlFor(session) {
    return `${baseUrl}/cam/${encodeURIComponent(session.cameraId)}/${session.kind}.jpg?g=${session.generation}`;
  }

  function emit(session, alive) {
    try {
      onStreamEvent?.({
        cameraId: session.cameraId,
        kind: session.kind,
        playUrl: playUrlFor(session),
        snapUrl: snapUrlFor(session),
        alive: !!alive,
        generation: session.generation,
      });
    } catch (err) {
      log.warn("onStreamEvent", err?.message || err);
    }
  }

  function clearRestart(session) {
    if (session.restartTimer) {
      clearTimeout(session.restartTimer);
      session.restartTimer = null;
    }
  }

  function clearWatchers(session) {
    if (session.fileTimer) {
      clearInterval(session.fileTimer);
      session.fileTimer = null;
    }
    if (session.snapTimer) {
      clearTimeout(session.snapTimer);
      session.snapTimer = null;
    }
  }

  function killProc(session) {
    if (!session.proc) return;
    const proc = session.proc;
    session.proc = null;
    try {
      proc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      try {
        if (!proc.killed) proc.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, 1200);
  }

  function endClients(session) {
    for (const res of session.clients) {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
    session.clients.clear();
  }

  function stopKey(key, { permanent = true } = {}) {
    const session = sessions.get(key);
    if (!session) return;
    session.intentionalStop = true;
    if (permanent) session.wanted = false;
    clearRestart(session);
    clearWatchers(session);
    endClients(session);
    killProc(session);
    if (permanent) {
      sessions.delete(key);
      emit({ ...session }, false);
      try {
        if (session.jpegPath) fs.unlinkSync(session.jpegPath);
      } catch {
        /* ignore */
      }
    }
  }

  function scheduleRestart(key) {
    const session = sessions.get(key);
    if (!session || !session.wanted || session.intentionalStop) return;
    clearRestart(session);
    session.failCount = (session.failCount || 0) + 1;
    const delay = Math.min(20000, 900 * Math.min(session.failCount, 12));
    log.warn(`ffmpeg reconnect ${key} in ${delay}ms (try ${session.failCount})`);
    session.restartTimer = setTimeout(() => {
      session.restartTimer = null;
      if (!sessions.has(key)) return;
      spawnFfmpeg(key);
    }, delay);
  }

  function pushFrame(session, jpeg) {
    if (!jpeg?.length) return;
    session.latestJpeg = jpeg;
    session.failCount = 0;
    session.lastFrameAt = Date.now();
    if (!session.alive) {
      session.alive = true;
      emit(session, true);
      log.info(`stream alive ${session.cameraId}::${session.kind} (${jpeg.length}b)`);
    }
    for (const res of session.clients) {
      try {
        writeMultipartFrame(res, jpeg);
      } catch {
        session.clients.delete(res);
      }
    }
  }

  function startFilePoll(session) {
    if (session.fileTimer) return;
    session.fileMtime = 0;
    session.fileTimer = setInterval(() => {
      if (!session.wanted || !session.jpegPath) return;
      try {
        const st = fs.statSync(session.jpegPath);
        if (!st.size || st.mtimeMs === session.fileMtime) return;
        session.fileMtime = st.mtimeMs;
        const jpeg = fs.readFileSync(session.jpegPath);
        if (jpeg.length > 64 && jpeg[0] === 0xff && jpeg[1] === 0xd8) {
          pushFrame(session, jpeg);
        }
      } catch {
        /* file not ready */
      }
    }, 120);
  }

  function scheduleSnap(session) {
    if (!session.snapshotUrl || !session.wanted) return;
    const tick = async () => {
      session.snapTimer = null;
      if (!session.wanted || session.intentionalStop) return;
      try {
        const jpeg = await fetchJpeg(session.snapshotUrl, 5000);
        if (session.wanted) pushFrame(session, jpeg);
      } catch {
        /* snapshot miss — RTSP may still feed */
      }
      if (session.wanted && !session.intentionalStop) {
        // RTSP canlıysa snapshot'ı yavaşlat; yoksa sık çek
        const fresh = session.lastFrameAt && Date.now() - session.lastFrameAt < 1500;
        const delay = fresh ? 900 : 250;
        session.snapTimer = setTimeout(tick, delay);
      }
    };
    session.snapTimer = setTimeout(tick, 80);
  }

  function spawnFfmpeg(key) {
    const session = sessions.get(key);
    if (!session || !session.wanted) return;
    clearRestart(session);
    clearWatchers(session);
    session.intentionalStop = false;
    session.alive = false;
    killProc(session);
    endClients(session);

    session.generation += 1;
    session.jpegPath = path.join(
      tmpRoot,
      `${session.cameraId.replace(/[^\w.-]+/g, "_")}_${session.kind}.jpg`,
    );
    try {
      fs.unlinkSync(session.jpegPath);
    } catch {
      /* ignore */
    }

    const url = injectCredentials(session.rtspUrl, session.username, session.password);
    log.info(
      `ffmpeg start ${key} g=${session.generation}`,
      String(url).replace(/:[^:@/]+@/, ":***@").slice(0, 140),
    );

    if (session.rtspUrl) {
      const args = buildFfmpegArgs(url, session.jpegPath);
      const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
      session.proc = proc;
      proc.stderr?.on("data", (buf) => {
        const msg = buf.toString().trim();
        if (msg) log.warn(`ffmpeg ${key}`, msg.slice(0, 280));
      });
      proc.on("exit", (code, signal) => {
        if (session.proc !== proc) return;
        session.proc = null;
        const wasAlive = session.alive;
        session.alive = false;
        log.warn(`ffmpeg exit ${key}`, { code, signal, intentional: session.intentionalStop });
        endClients(session);
        if (wasAlive) emit(session, false);
        // snapshot poller açık kalsın; RTSP'yi yeniden dene
        if (session.wanted && !session.intentionalStop) scheduleRestart(key);
      });
      startFilePoll(session);
    }

    if (session.snapshotUrl) {
      scheduleSnap(session);
    }

    emit(session, false);
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
          // Vite (5173) → proxy (18766) fetch için CORS
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type");
          if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
          }

          const pathOnly = String(req.url || "").split("?")[0];
          const m = /^\/cam\/([^/]+)\/(visible|thermal)\.(mjpg|jpg)\/?$/.exec(pathOnly);
          if (!m) {
            res.writeHead(404);
            res.end("not found");
            return;
          }
          const cameraId = decodeURIComponent(m[1]);
          const kind = m[2];
          const fmt = m[3];
          const key = keyOf(cameraId, kind);
          let session = sessions.get(key);

          if (session?.wanted && !session.proc && !session.snapTimer && !session.fileTimer) {
            spawnFfmpeg(key);
            session = sessions.get(key);
          }

          if (!session) {
            res.writeHead(503, { "Content-Type": "text/plain", "Retry-After": "2" });
            res.end("stream offline");
            return;
          }

          if (fmt === "jpg") {
            const jpeg = session.latestJpeg;
            if (!jpeg) {
              res.writeHead(503, { "Content-Type": "text/plain", "Retry-After": "1" });
              res.end("no frame yet");
              return;
            }
            res.writeHead(200, {
              "Content-Type": "image/jpeg",
              "Content-Length": jpeg.length,
              "Cache-Control": "no-store, no-cache, must-revalidate",
              Pragma: "no-cache",
            });
            res.end(jpeg);
            return;
          }

          res.writeHead(200, {
            "Content-Type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Connection: "close",
            Pragma: "no-cache",
          });
          session.clients.add(res);
          if (session.latestJpeg) {
            try {
              writeMultipartFrame(res, session.latestJpeg);
            } catch {
              /* ignore */
            }
          }
          req.on("close", () => session.clients.delete(res));
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

  async function start({ cameraId, kind, rtspUrl, snapshotUrl, username, password }) {
    await startServer();
    const key = keyOf(cameraId, kind);
    let session = sessions.get(key);
    const snap = injectHttpCredentials(snapshotUrl || null, username, password);
    if (session) {
      session.rtspUrl = rtspUrl;
      session.snapshotUrl = snap;
      session.username = username;
      session.password = password;
      session.wanted = true;
      session.intentionalStop = true;
      clearRestart(session);
      clearWatchers(session);
      killProc(session);
      endClients(session);
    } else {
      session = {
        cameraId,
        kind,
        rtspUrl,
        snapshotUrl: snap,
        username,
        password,
        wanted: true,
        intentionalStop: false,
        alive: false,
        proc: null,
        clients: new Set(),
        generation: 0,
        failCount: 0,
        restartTimer: null,
        fileTimer: null,
        snapTimer: null,
        latestJpeg: null,
        lastFrameAt: 0,
        jpegPath: null,
        fileMtime: 0,
      };
      sessions.set(key, session);
    }
    session.wanted = true;
    session.intentionalStop = false;
    session.rtspUrl = rtspUrl;
    session.snapshotUrl = snap;
    spawnFfmpeg(key);
    return playUrlFor(session);
  }

  function stopCamera(cameraId) {
    for (const key of [...sessions.keys()]) {
      if (key.startsWith(`${cameraId}::`)) stopKey(key, { permanent: true });
    }
  }

  function stop() {
    for (const key of [...sessions.keys()]) stopKey(key, { permanent: true });
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
