const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const { log } = require("./log.cjs");

function settingsPath() {
  return path.join(app.getPath("userData"), "cameras.json");
}

function emptyStore() {
  return { version: 1, activeId: null, activeStream: "visible", cameras: [] };
}

function loadStore() {
  try {
    const p = settingsPath();
    if (!fs.existsSync(p)) return emptyStore();
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!raw || !Array.isArray(raw.cameras)) return emptyStore();
    return {
      version: 1,
      activeId: raw.activeId ?? raw.cameras[0]?.id ?? null,
      activeStream: raw.activeStream === "thermal" ? "thermal" : "visible",
      cameras: raw.cameras,
    };
  } catch (err) {
    log.warn("cameras.json load failed", err);
    return emptyStore();
  }
}

function saveStore(store) {
  const p = settingsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(store, null, 2), "utf8");
}

function publicCamera(cam) {
  if (!cam) return null;
  return {
    id: cam.id,
    name: cam.name,
    host: cam.host,
    port: cam.port,
    username: cam.username,
    // password never to renderer
    manufacturer: cam.manufacturer ?? null,
    model: cam.model ?? null,
    streams: {
      visible: cam.streams?.visible
        ? {
            profileToken: cam.streams.visible.profileToken,
            profileName: cam.streams.visible.profileName,
            playUrl: cam.streams.visible.playUrl ?? null,
            hasRtsp: !!cam.streams.visible.rtspUrl,
          }
        : null,
      thermal: cam.streams?.thermal
        ? {
            profileToken: cam.streams.thermal.profileToken,
            profileName: cam.streams.thermal.profileName,
            playUrl: cam.streams.thermal.playUrl ?? null,
            hasRtsp: !!cam.streams.thermal.rtspUrl,
          }
        : null,
    },
    capabilities: cam.capabilities ?? { ptz: false },
    status: cam.status ?? "idle",
    lastSeenAt: cam.lastSeenAt ?? null,
    error: cam.error ?? null,
  };
}

function createCameraRegistry({ broadcast } = {}) {
  let store = loadStore();

  function emit() {
    const payload = snapshot();
    broadcast?.("irbis:cameras", payload);
    return payload;
  }

  function snapshot() {
    return {
      activeId: store.activeId,
      activeStream: store.activeStream,
      cameras: store.cameras.map(publicCamera),
      count: store.cameras.length,
    };
  }

  function getRaw(id) {
    return store.cameras.find((c) => c.id === id) ?? null;
  }

  function upsert(cam) {
    const i = store.cameras.findIndex((c) => c.id === cam.id);
    if (i >= 0) store.cameras[i] = cam;
    else store.cameras.push(cam);
    if (!store.activeId) store.activeId = cam.id;
    saveStore(store);
    return emit();
  }

  function remove(id) {
    store.cameras = store.cameras.filter((c) => c.id !== id);
    if (store.activeId === id) store.activeId = store.cameras[0]?.id ?? null;
    saveStore(store);
    return emit();
  }

  function setActive(id) {
    if (!getRaw(id)) return { ok: false, error: "Kamera bulunamadı", ...snapshot() };
    store.activeId = id;
    saveStore(store);
    return { ok: true, ...emit() };
  }

  function setActiveStream(kind) {
    store.activeStream = kind === "thermal" ? "thermal" : "visible";
    saveStore(store);
    return emit();
  }

  function patchPlayUrl(id, kind, playUrl) {
    const cam = getRaw(id);
    if (!cam?.streams?.[kind]) return snapshot();
    if (cam.streams[kind].playUrl === playUrl) return snapshot();
    cam.streams[kind].playUrl = playUrl;
    saveStore(store);
    return emit();
  }

  function patchStatus(id, status, error = undefined) {
    const cam = getRaw(id);
    if (!cam) return snapshot();
    const nextError = error !== undefined ? error : cam.error;
    if (cam.status === status && cam.error === nextError) return snapshot();
    cam.status = status;
    if (error !== undefined) cam.error = error;
    if (status === "online") {
      cam.error = null;
      cam.lastSeenAt = new Date().toISOString();
    }
    saveStore(store);
    return emit();
  }

  function listRaw() {
    return store.cameras.slice();
  }

  function reload() {
    store = loadStore();
    return emit();
  }

  return {
    snapshot,
    getRaw,
    upsert,
    remove,
    setActive,
    setActiveStream,
    patchPlayUrl,
    patchStatus,
    listRaw,
    reload,
    emit,
    settingsPath,
  };
}

module.exports = { createCameraRegistry, publicCamera };
