const crypto = require("node:crypto");
const dgram = require("node:dgram");
const os = require("node:os");
const { Cam } = require("onvif");
const { log } = require("./log.cjs");

const WS_DISCOVERY_ADDR = "239.255.255.250";
const WS_DISCOVERY_PORT = 3702;

function listIpv4Interfaces() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs || []) {
      const fam = a.family;
      // Node 18+: family is 4; older: 'IPv4'
      if ((fam === "IPv4" || fam === 4) && !a.internal && a.address) {
        out.push({ name, address: a.address });
      }
    }
  }
  return out;
}

function buildProbeXml() {
  const messageId = `urn:uuid:${crypto.randomUUID()}`;
  return Buffer.from(
    '<Envelope xmlns="http://www.w3.org/2003/05/soap-envelope" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">' +
      "<Header>" +
      '<wsa:MessageID xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">' +
      messageId +
      "</wsa:MessageID>" +
      '<wsa:To xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">urn:schemas-xmlsoap-org:ws:2005:04:discovery</wsa:To>' +
      '<wsa:Action xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</wsa:Action>' +
      "</Header>" +
      "<Body>" +
      '<Probe xmlns="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      "<Types>dn:NetworkVideoTransmitter</Types>" +
      "<Scopes />" +
      "</Probe>" +
      "</Body>" +
      "</Envelope>",
  );
}

function hitsFromProbeXml(xml, rinfo) {
  const hits = [];
  const text = String(xml || "");
  const xaddrBlocks = [...text.matchAll(/<(?:\w+:)?XAddrs[^>]*>([^<]+)<\/(?:\w+:)?XAddrs>/gi)].map((m) =>
    m[1].trim(),
  );
  const urls = xaddrBlocks
    .flatMap((b) => b.split(/\s+/))
    .map((s) => s.trim())
    .filter(Boolean);

  if (urls.length) {
    for (const raw of urls) {
      try {
        const u = new URL(raw);
        if (!u.hostname) continue;
        hits.push({
          hostname: u.hostname,
          port: Number(u.port) || (u.protocol === "https:" ? 443 : 80),
          name: u.hostname,
          xaddrs: urls,
          via: rinfo?.address || null,
        });
      } catch {
        /* skip bad url */
      }
    }
  }

  // SOAP bozuk / XAddrs yok ama UDP cevap geldi → IP'yi yine ekle
  if (!hits.length && rinfo?.address) {
    hits.push({
      hostname: rinfo.address,
      port: 80,
      name: rinfo.address,
      xaddrs: [],
      via: rinfo.address,
    });
  }
  return hits;
}

/**
 * Tek NIC üzerinden WS-Discovery Probe (WiFi / Ethernet / …).
 * setMulticastInterface + o NIC IP'sine bind şart — yoksa sadece default route gider.
 */
function probeOnInterface({ name, address, timeoutMs, request }) {
  return new Promise((resolve) => {
    const found = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      resolve(found);
    };

    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    socket.on("error", (err) => {
      log.warn(`onvif discover ${name}(${address})`, err?.message || err);
      finish();
    });
    socket.on("message", (msg, rinfo) => {
      try {
        for (const hit of hitsFromProbeXml(msg.toString(), rinfo)) {
          found.push({ ...hit, iface: name, ifaceAddress: address });
        }
      } catch (err) {
        log.warn(`onvif discover parse ${name}`, err?.message || err);
        if (rinfo?.address) {
          found.push({
            hostname: rinfo.address,
            port: 80,
            name: rinfo.address,
            xaddrs: [],
            via: rinfo.address,
            iface: name,
            ifaceAddress: address,
          });
        }
      }
    });

    socket.bind(0, address, () => {
      try {
        socket.setBroadcast(true);
      } catch {
        /* ignore */
      }
      try {
        // Çıkış paketlerini bu NIC'ten gönder
        socket.setMulticastInterface(address);
      } catch (err) {
        log.warn(`onvif multicast iface ${name}`, err?.message || err);
      }
      try {
        socket.addMembership(WS_DISCOVERY_ADDR, address);
      } catch {
        try {
          socket.addMembership(WS_DISCOVERY_ADDR);
        } catch (err2) {
          log.warn(`onvif membership ${name}`, err2?.message || err2);
        }
      }
      socket.send(request, 0, request.length, WS_DISCOVERY_PORT, WS_DISCOVERY_ADDR, (err) => {
        if (err) log.warn(`onvif probe send ${name}`, err?.message || err);
      });
      // İkinci probe — bazı kameralar ilk paketi kaçırır
      setTimeout(() => {
        try {
          socket.send(request, 0, request.length, WS_DISCOVERY_PORT, WS_DISCOVERY_ADDR);
        } catch {
          /* ignore */
        }
      }, 300);
    });

    setTimeout(finish, Math.max(1500, timeoutMs || 8000));
  });
}

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

  function parseXAddrs(raw, fallbackHost) {
    const parts = String(raw || "")
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const part of parts) {
      try {
        const u = new URL(part);
        if (u.hostname) {
          return {
            hostname: u.hostname,
            port: Number(u.port) || (u.protocol === "https:" ? 443 : 80),
            path: u.pathname || "/",
          };
        }
      } catch {
        /* try next */
      }
    }
    if (fallbackHost) {
      return { hostname: fallbackHost, port: 80, path: "/" };
    }
    return null;
  }

  async function discover(timeoutMs = 8000) {
    const ifaces = listIpv4Interfaces();
    const request = buildProbeXml();
    const t = Math.max(2000, Number(timeoutMs) || 8000);

    if (!ifaces.length) {
      log.warn("onvif discover: IPv4 arayüz yok");
      return [];
    }

    log.info(
      "onvif discover multi-NIC",
      ifaces.map((i) => `${i.name}=${i.address}`).join(" | "),
    );

    // WiFi + Ethernet + diğer tüm NIC'ler paralel probe
    const batches = await Promise.all(
      ifaces.map((iface) =>
        probeOnInterface({
          name: iface.name,
          address: iface.address,
          timeoutMs: t,
          request,
        }),
      ),
    );

    const map = new Map();
    for (const hit of batches.flat()) {
      if (!hit?.hostname) continue;
      // Link-local / bozuk atla
      if (hit.hostname.startsWith("169.254.")) continue;
      const key = `${hit.hostname}:${hit.port || 80}`;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, {
          hostname: hit.hostname,
          port: hit.port || 80,
          name: hit.name || hit.hostname,
          xaddrs: hit.xaddrs || [],
          ifaces: hit.iface ? [hit.iface] : [],
        });
      } else if (hit.iface && !prev.ifaces.includes(hit.iface)) {
        prev.ifaces.push(hit.iface);
      }
    }

    const list = [...map.values()];
    log.info(`onvif discover done · ${list.length} cihaz · ${ifaces.length} NIC`);
    return list;
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
            snapshotUrl: s.snapshotUrl || null,
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
            snapshotUrl: s.snapshotUrl || null,
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

  async function ptzStop(cam) {
    await promisifyCam(cam, "stop", { panTilt: true, zoom: true });
  }

  /**
   * Joystick-style PTZ: continuousMove while held, explicit "stop" on release.
   * (Do NOT auto-stop — ODM-style hold-to-pan.)
   */
  async function ptz({ id, action, speed = 0.55 }) {
    const cam = await ensureSession(id);
    const sp = Math.min(1, Math.max(0.08, Number(speed) || 0.55));

    if (action === "stop") {
      try {
        await ptzStop(cam);
      } catch (err) {
        log.warn("ptz stop", err?.message || err);
      }
      return { ok: true };
    }

    if (action === "home") {
      try {
        await ptzStop(cam);
      } catch {
        /* ignore */
      }
      try {
        await promisifyCam(cam, "gotoHomePosition", {});
      } catch (err) {
        log.warn("ptz home", err?.message || err);
        return { ok: false, error: String(err?.message || err) };
      }
      return { ok: true };
    }

    /** @type {{ x?: number, y?: number, zoom?: number, onlySendPanTilt?: boolean, onlySendZoom?: boolean }} */
    const velocity = {};
    switch (action) {
      case "left":
        velocity.x = -sp;
        velocity.y = 0;
        velocity.onlySendPanTilt = true;
        break;
      case "right":
        velocity.x = sp;
        velocity.y = 0;
        velocity.onlySendPanTilt = true;
        break;
      case "up":
        velocity.x = 0;
        velocity.y = sp;
        velocity.onlySendPanTilt = true;
        break;
      case "down":
        velocity.x = 0;
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

    try {
      await promisifyCam(cam, "continuousMove", velocity);
      return { ok: true };
    } catch (err) {
      log.warn(`ptz ${action}`, err?.message || err);
      return { ok: false, error: String(err?.message || err) };
    }
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
            snapshotUrl: s.snapshotUrl || null,
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
