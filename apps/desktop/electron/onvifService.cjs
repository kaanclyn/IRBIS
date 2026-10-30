const crypto = require("node:crypto");
const { Cam, Discovery } = require("onvif");
const { log } = require("./log.cjs");

const THERMAL_RE = /thermal|therm|flir|lwır|lwir|\bir\b|infrared|kızıl|kızılötesi/i;

function promisifyCam(cam, method, ...args) {
  return new Promise((resolve, reject) => {
    try {
      cam[method](...args, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    } catch (err) {
      reject(err);
    }
  });
}

function classifyProfileName(name) {
  const n = String(name || "");
  if (THERMAL_RE.test(n)) return "thermal";
  return "visible";
}

function pickDualStreams(profiles) {
  const list = Array.isArray(profiles) ? profiles : [];
  let visible = null;
  let thermal = null;
  for (const p of list) {
    const kind = classifyProfileName(p.name || p.$.token || "");
    const entry = {
      profileToken: p.$.token || p.token,
      profileName: p.name || p.$.token || "profile",
    };
    if (!entry.profileToken) continue;
    if (kind === "thermal" && !thermal) thermal = entry;
    else if (kind === "visible" && !visible) visible = entry;
  }
  if (!visible && list[0]) {
    visible = {
      profileToken: list[0].$.token || list[0].token,
      profileName: list[0].name || "profile0",
    };
  }
  if (!thermal) {
    const second = list.find((p) => (p.$.token || p.token) !== visible?.profileToken);
    if (second && classifyProfileName(second.name) === "thermal") {
      thermal = {
        profileToken: second.$.token || second.token,
        profileName: second.name || "thermal",
      };
    }
  }
  return { visible, thermal };
}

function camIdFromHost(host, port) {
  return `cam_${String(host).replace(/[^\w.-]/g, "_")}_${port || 80}`;
}

function createOnvifService({ registry, streamProxy, broadcast } = {}) {
  /** @type {Map<string, import('onvif').Cam>} */
  const sessions = new Map();

  async function discover(timeoutMs = 5000) {
    return new Promise((resolve) => {
      const found = [];
      const onDevice = (cam, rinfo) => {
        found.push({
          hostname: cam.hostname || rinfo?.address,
          port: cam.port || 80,
          xaddrs: cam.xaddrs || [],
          name: cam.hostname || rinfo?.address,
        });
      };
      const onError = (err) => log.warn("onvif discovery", err?.message || err);
      Discovery.on("device", onDevice);
      Discovery.on("error", onError);
      Discovery.probe({ timeout: timeoutMs }, (err) => {
        Discovery.removeListener("device", onDevice);
        Discovery.removeListener("error", onError);
        if (err) log.warn("onvif probe", err);
        // dedupe by host
        const map = new Map();
        for (const d of found) {
          if (!d.hostname) continue;
          map.set(`${d.hostname}:${d.port}`, d);
        }
        resolve([...map.values()]);
      });
    });
  }

  function connectCam({ hostname, port = 80, username, password }) {
    return new Promise((resolve, reject) => {
      const cam = new Cam(
        {
          hostname,
          username,
          password,
          port: Number(port) || 80,
          timeout: 10000,
        },
        (err) => {
          if (err) reject(err);
          else resolve(cam);
        },
      );
    });
  }

  async function resolveStreams(cam) {
    const profiles = await promisifyCam(cam, "getProfiles");
    const dual = pickDualStreams(profiles);
    const out = { visible: null, thermal: null };

    for (const kind of ["visible", "thermal"]) {
      const slot = dual[kind];
      if (!slot?.profileToken) continue;
      try {
        const uri = await promisifyCam(cam, "getStreamUri", {
          protocol: "RTSP",
          profileToken: slot.profileToken,
        });
        let snapshotUrl = null;
        try {
          const snap = await promisifyCam(cam, "getSnapshotUri", {
            profileToken: slot.profileToken,
          });
          snapshotUrl = snap?.uri || null;
        } catch {
          /* optional */
        }
        out[kind] = {
          ...slot,
          rtspUrl: uri?.uri || null,
          snapshotUrl,
          playUrl: null,
        };
      } catch (err) {
        log.warn(`onvif getStreamUri ${kind}`, err?.message || err);
        out[kind] = { ...slot, rtspUrl: null, snapshotUrl: null, playUrl: null };
      }
    }
    return out;
  }

  async function addCamera({ host, port = 80, username, password, name }) {
    const hostname = String(host || "").trim();
    if (!hostname) throw new Error("host gerekli");
    const user = String(username ?? "");
    const pass = String(password ?? "");
    const camPort = Number(port) || 80;

    const cam = await connectCam({ hostname, port: camPort, username: user, password: pass });
    let manufacturer = null;
    let model = null;
    try {
      const info = await promisifyCam(cam, "getDeviceInformation");
      manufacturer = info?.manufacturer || null;
      model = info?.model || null;
    } catch {
      /* ignore */
    }

    const streams = await resolveStreams(cam);
    const id = camIdFromHost(hostname, camPort);
    const prev = sessions.get(id);
    if (prev) {
      try {
        /* Cam has no official close in 0.8 — drop ref */
      } catch {
        /* ignore */
      }
    }
    sessions.set(id, cam);

    let ptz = false;
    try {
      await promisifyCam(cam, "getStatus");
      ptz = true;
    } catch {
      ptz = !!(cam.capabilities?.PTZ || cam.uri?.ptz);
    }

    const record = {
      id,
      name: name || model || manufacturer || hostname,
      host: hostname,
      port: camPort,
      username: user,
      password: pass,
      manufacturer,
      model,
      streams,
      capabilities: { ptz },
      status: "online",
      lastSeenAt: new Date().toISOString(),
      error: null,
    };

    registry?.upsert(record);

    // start proxies for streams that have RTSP
    if (streamProxy) {
      for (const kind of ["visible", "thermal"]) {
        const s = streams[kind];
        if (!s?.rtspUrl) continue;
        try {
          const playUrl = await streamProxy.start({
            cameraId: id,
            kind,
            rtspUrl: s.rtspUrl,
            username: user,
            password: pass,
          });
          s.playUrl = playUrl;
          registry?.patchPlayUrl(id, kind, playUrl);
        } catch (err) {
          log.warn(`stream proxy ${id}/${kind}`, err?.message || err);
        }
      }
      registry?.upsert({ ...record, streams });
    }

    broadcast?.("irbis:cameras", registry?.snapshot());
    return registry?.snapshot() ?? { cameras: [record] };
  }

  async function removeCamera(id) {
    sessions.delete(id);
    streamProxy?.stopCamera?.(id);
    return registry?.remove(id);
  }

  async function ensureSession(id) {
    let cam = sessions.get(id);
    if (cam) return cam;
    const raw = registry?.getRaw(id);
    if (!raw) throw new Error("Kamera yok");
    cam = await connectCam({
      hostname: raw.host,
      port: raw.port,
      username: raw.username,
      password: raw.password,
    });
    sessions.set(id, cam);
    return cam;
  }

  async function refreshStreams(id) {
    const cam = await ensureSession(id);
    const raw = registry.getRaw(id);
    const streams = await resolveStreams(cam);
    if (streamProxy) {
      streamProxy.stopCamera?.(id);
      for (const kind of ["visible", "thermal"]) {
        const s = streams[kind];
        if (!s?.rtspUrl) continue;
        try {
          s.playUrl = await streamProxy.start({
            cameraId: id,
            kind,
            rtspUrl: s.rtspUrl,
            username: raw.username,
            password: raw.password,
          });
        } catch (err) {
          log.warn(`refresh proxy ${id}/${kind}`, err?.message || err);
        }
      }
    }
    registry.upsert({
      ...raw,
      streams,
      status: "online",
      lastSeenAt: new Date().toISOString(),
      error: null,
    });
    return registry.snapshot();
  }

  async function ptz({ id, action, speed = 0.4 }) {
    const cam = await ensureSession(id);
    const sp = Math.min(1, Math.max(0.05, Number(speed) || 0.4));
    if (action === "stop") {
      await promisifyCam(cam, "stop", { panTilt: true, zoom: true });
      return { ok: true };
    }
    if (action === "home") {
      try {
        await promisifyCam(cam, "gotoHomePosition", {});
      } catch {
        await promisifyCam(cam, "stop", { panTilt: true, zoom: true });
      }
      return { ok: true };
    }
    const velocity = { x: 0, y: 0, zoom: 0 };
    switch (action) {
      case "left":
        velocity.x = -sp;
        velocity.onlySendPanTilt = true;
        break;
      case "right":
        velocity.x = sp;
        velocity.onlySendPanTilt = true;
        break;
      case "up":
        velocity.y = sp;
        velocity.onlySendPanTilt = true;
        break;
      case "down":
        velocity.y = -sp;
        velocity.onlySendPanTilt = true;
        break;
      case "zoomin":
        velocity.zoom = sp;
        velocity.onlySendZoom = true;
        break;
      case "zoomout":
        velocity.zoom = -sp;
        velocity.onlySendZoom = true;
        break;
      default:
        throw new Error(`Bilinmeyen PTZ: ${action}`);
    }
    await promisifyCam(cam, "continuousMove", velocity);
    // auto-stop after short burst so UI buttons feel like clicks
    setTimeout(() => {
      promisifyCam(cam, "stop", { panTilt: true, zoom: true }).catch(() => {});
    }, 350);
    return { ok: true };
  }

  async function hydrateProxies() {
    if (!streamProxy || !registry) return;
    for (const raw of registry.listRaw()) {
      try {
        await ensureSession(raw.id);
        for (const kind of ["visible", "thermal"]) {
          const s = raw.streams?.[kind];
          if (!s?.rtspUrl) continue;
          const playUrl = await streamProxy.start({
            cameraId: raw.id,
            kind,
            rtspUrl: s.rtspUrl,
            username: raw.username,
            password: raw.password,
          });
          registry.patchPlayUrl(raw.id, kind, playUrl);
        }
      } catch (err) {
        log.warn(`hydrate ${raw.id}`, err?.message || err);
        const cam = registry.getRaw(raw.id);
        if (cam) {
          cam.status = "offline";
          cam.error = String(err?.message || err);
          registry.upsert(cam);
        }
      }
    }
    registry.emit();
  }

  function stop() {
    for (const id of [...sessions.keys()]) {
      sessions.delete(id);
      streamProxy?.stopCamera?.(id);
    }
  }

  return {
    discover,
    addCamera,
    removeCamera,
    refreshStreams,
    ptz,
    hydrateProxies,
    stop,
    _newId: () => crypto.randomUUID(),
  };
}

module.exports = { createOnvifService, classifyProfileName, pickDualStreams };
