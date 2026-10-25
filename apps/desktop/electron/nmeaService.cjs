const dgram = require("node:dgram");
const { createAisAssembler } = require("./aisDecode.cjs");
const { OWN: SIM_OWN, AIS_TARGETS: SIM_AIS } = require("./simScenario.cjs");

const DEFAULT_PORT = 10110;
const LIVE_IDLE_MS = 2500;
const AIS_LOST_MS = 60000;

function checksumOk(sentence) {
  const star = sentence.lastIndexOf("*");
  if (star < 0 || star + 3 > sentence.length) return false;
  const bodyStart = sentence[0] === "$" || sentence[0] === "!" ? 1 : 0;
  const body = sentence.slice(bodyStart, star);
  const expected = sentence.slice(star + 1, star + 3).toUpperCase();
  let cs = 0;
  for (let i = 0; i < body.length; i += 1) cs ^= body.charCodeAt(i);
  return cs.toString(16).toUpperCase().padStart(2, "0") === expected;
}

function strip(sentence) {
  const s = sentence.trim();
  const star = s.lastIndexOf("*");
  const core = star >= 0 ? s.slice(0, star) : s;
  return core.startsWith("$") || core.startsWith("!") ? core.slice(1) : core;
}

function sentenceType(body) {
  const comma = body.indexOf(",");
  const tag = comma >= 0 ? body.slice(0, comma) : body;
  return tag.length >= 3 ? tag.slice(-3).toUpperCase() : tag.toUpperCase();
}

function dmToDeg(dm, hemi) {
  if (!dm || dm.length < 3) return undefined;
  const n = Number(dm);
  if (!Number.isFinite(n)) return undefined;
  const deg = Math.trunc(n / 100);
  const minutes = n - deg * 100;
  let d = deg + minutes / 60;
  if (hemi === "S" || hemi === "W") d = -d;
  return d;
}

function stamp(value, source, at) {
  return { value, receivedAtUtc: at, source };
}

function applyPatch(state, patch, source, at) {
  const next = { ...state, lastSentenceAtUtc: at };
  if (patch.lat !== undefined) next.lat = stamp(patch.lat, source, at);
  if (patch.lon !== undefined) next.lon = stamp(patch.lon, source, at);
  if (patch.sogKn !== undefined) next.sogKn = stamp(patch.sogKn, source, at);
  if (patch.cogDegTrue !== undefined) next.cogDegTrue = stamp(patch.cogDegTrue, source, at);
  if (patch.headingDegTrue !== undefined) next.headingDegTrue = stamp(patch.headingDegTrue, source, at);
  if (patch.headingDegMagnetic !== undefined) next.headingDegMagnetic = stamp(patch.headingDegMagnetic, source, at);
  if (patch.depthM !== undefined) next.depthM = stamp(patch.depthM, source, at);
  return next;
}

function parseOwnShipLine(raw) {
  const line = raw.trim();
  if (!line) return null;
  if (line.includes("*") && !checksumOk(line)) return { error: "checksum" };
  const body = strip(line.split("\r")[0].split("\n")[0]);
  if (!body) return null;
  const type = sentenceType(body);
  const f = body.split(",");

  if (type === "RMC") {
    if (f[2] !== "A") return null;
    const patch = {};
    const lat = dmToDeg(f[3], f[4]);
    const lon = dmToDeg(f[5], f[6]);
    if (lat !== undefined) patch.lat = lat;
    if (lon !== undefined) patch.lon = lon;
    const sog = f[7] ? Number(f[7]) : NaN;
    if (Number.isFinite(sog)) patch.sogKn = sog;
    const cog = f[8] ? Number(f[8]) : NaN;
    if (Number.isFinite(cog)) patch.cogDegTrue = cog;
    return { patch };
  }
  if (type === "HDT") {
    const h = Number(f[1]);
    return Number.isFinite(h) ? { patch: { headingDegTrue: h } } : null;
  }
  if (type === "HDM") {
    const h = Number(f[1]);
    return Number.isFinite(h) ? { patch: { headingDegMagnetic: h } } : null;
  }
  if (type === "HDG") {
    const h = Number(f[1]);
    if (!Number.isFinite(h)) return null;
    const patch = { headingDegMagnetic: h };
    const v = f[4] ? Number(f[4]) : NaN;
    const vDir = f[5];
    if (Number.isFinite(v) && (vDir === "E" || vDir === "W")) {
      const magVar = vDir === "E" ? v : -v;
      patch.headingDegTrue = (h + magVar + 360) % 360;
    }
    return { patch };
  }
  if (type === "DPT") {
    const d = Number(f[1]);
    return Number.isFinite(d) ? { patch: { depthM: d } } : null;
  }
  if (type === "DBT") {
    const m = f[3] ? Number(f[3]) : NaN;
    if (Number.isFinite(m)) return { patch: { depthM: m } };
    const ft = f[1] ? Number(f[1]) : NaN;
    if (Number.isFinite(ft)) return { patch: { depthM: ft * 0.3048 } };
  }
  if (type === "VDM" || type === "VDO") {
    return { aisBody: body };
  }
  return null;
}

function emptyState(mode) {
  return { mode, msgPerSec: 0, checksumErrors: 0, udpPort: DEFAULT_PORT };
}

/**
 * @param {{ broadcast: (channel: string, payload: unknown) => void }} opts
 */
function createNmeaService(opts) {
  const port = Number(process.env.IRBIS_NMEA_PORT || DEFAULT_PORT);
  let state = emptyState("simulation");
  /** @type {Map<number, object>} */
  const targets = new Map();
  const ais = createAisAssembler();
  let socket = null;
  let lastUdpMs = 0;
  let msgCountWindow = 0;
  let checksumErrors = 0;
  let rateTimer = null;
  let simTimer = null;
  let publishTimer = null;

  function upsertAis(decoded, at, source) {
    if (!decoded?.mmsi) return;
    const prev = targets.get(decoded.mmsi) || { mmsi: decoded.mmsi };
    const next = {
      ...prev,
      ...decoded,
      lastSeenUtc: at,
      source,
      lost: false,
    };
    // Don't wipe name/dims on position-only updates
    if (decoded.name) next.name = decoded.name;
    if (decoded.callSign) next.callSign = decoded.callSign;
    if (decoded.shipType !== undefined) next.shipType = decoded.shipType;
    if (decoded.lat === undefined && prev.lat !== undefined) next.lat = prev.lat;
    if (decoded.lon === undefined && prev.lon !== undefined) next.lon = prev.lon;
    targets.set(decoded.mmsi, next);
  }

  function pruneLost(nowMs) {
    for (const [mmsi, t] of targets) {
      const age = nowMs - Date.parse(t.lastSeenUtc || 0);
      if (age > AIS_LOST_MS) {
        targets.set(mmsi, { ...t, lost: true });
      }
      if (age > AIS_LOST_MS * 3) targets.delete(mmsi);
    }
  }

  function targetsList() {
    return [...targets.values()]
      .filter((t) => t.lat !== undefined && t.lon !== undefined)
      .map((t) => ({
        mmsi: t.mmsi,
        name: t.name || null,
        class: t.class || null,
        msgType: t.msgType,
        lat: t.lat,
        lon: t.lon,
        sogKn: t.sogKn,
        cogDeg: t.cogDeg,
        headingDeg: t.headingDeg,
        shipType: t.shipType,
        lost: !!t.lost,
        lastSeenUtc: t.lastSeenUtc,
        source: t.source,
      }));
  }

  function publish() {
    pruneLost(Date.now());
    const payload = {
      ...state,
      checksumErrors,
      msgPerSec: state.msgPerSec,
      udpPort: port,
      serverTimeUtc: new Date().toISOString(),
    };
    opts.broadcast("irbis:ownship", payload);
    opts.broadcast("irbis:ais", { targets: targetsList(), count: targets.size });
  }

  function ingest(raw, sourceIp) {
    const at = new Date().toISOString();
    const parsed = parseOwnShipLine(raw);
    if (!parsed) return;
    if (parsed.error === "checksum") {
      checksumErrors += 1;
      return;
    }
    lastUdpMs = Date.now();
    msgCountWindow += 1;

    if (parsed.aisBody) {
      const decoded = ais.feed(parsed.aisBody);
      if (decoded) upsertAis(decoded, at, `udp:${sourceIp}`);
      state = { ...state, mode: "live" };
      return;
    }
    if (!parsed.patch) return;
    state = applyPatch(state, parsed.patch, `udp:${sourceIp}:${port}`, at);
    state = { ...state, mode: "live" };
  }

  function tickSimAis(t, at) {
    // Light jitter so markers look alive without leaving captured harbor positions
    for (let i = 0; i < SIM_AIS.length; i += 1) {
      const base = SIM_AIS[i];
      const wobble = 0.00004;
      const phase = t / 40 + i * 0.7;
      upsertAis(
        {
          mmsi: base.mmsi,
          name: base.name,
          class: base.class,
          msgType: base.msgType,
          lat: base.lat + Math.sin(phase) * wobble,
          lon: base.lon + Math.cos(phase * 0.9) * wobble,
          sogKn: base.sogKn,
          cogDeg: base.cogDeg,
          headingDeg: base.headingDeg,
          shipType: base.shipType,
          navStatus: base.status,
        },
        at,
        "sim:pcap-tuzla",
      );
    }
  }

  function tickSim() {
    if (Date.now() - lastUdpMs < LIVE_IDLE_MS && lastUdpMs > 0) return;
    const now = new Date();
    const t = now.getTime() / 1000;
    const at = now.toISOString();
    const source = "sim:pcap-tuzla";
    // Own ship from AISveGPS.pcapng (Tuzla / İzmit Körfezi)
    const lat = SIM_OWN.lat + Math.sin(t / 90) * 0.00002;
    const lon = SIM_OWN.lon + Math.cos(t / 95) * 0.00002;
    state = applyPatch(
      { ...state, mode: "simulation", simScenario: "AISveGPS.pcapng" },
      {
        lat,
        lon,
        sogKn: SIM_OWN.sogKn,
        depthM: SIM_OWN.depthM + Math.sin(t / 20) * 0.15,
        cogDegTrue: SIM_OWN.cogDegTrue,
        headingDegTrue: SIM_OWN.headingDegTrue,
        headingDegMagnetic: SIM_OWN.headingDegMagnetic,
      },
      source,
      at,
    );
    tickSimAis(t, at);
  }

  function start() {
    socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    socket.on("message", (buf, rinfo) => {
      const text = buf.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) ingest(line, rinfo.address);
      }
    });
    socket.on("error", (err) => {
      console.error("[irbis] nmea udp error", err.message);
    });
    socket.bind(port, "0.0.0.0", () => {
      console.log(`[irbis] NMEA UDP listening 0.0.0.0:${port}`);
    });

    rateTimer = setInterval(() => {
      state = { ...state, msgPerSec: msgCountWindow, checksumErrors };
      msgCountWindow = 0;
    }, 1000);

    simTimer = setInterval(tickSim, 500);
    publishTimer = setInterval(publish, 250);
    tickSim();
    publish();
  }

  function stop() {
    if (rateTimer) clearInterval(rateTimer);
    if (simTimer) clearInterval(simTimer);
    if (publishTimer) clearInterval(publishTimer);
    try {
      socket?.close();
    } catch {
      /* ignore */
    }
    socket = null;
  }

  function getState() {
    return { ...state, checksumErrors, udpPort: port };
  }

  function getAis() {
    return { targets: targetsList(), count: targets.size };
  }

  return { start, stop, getState, getAis, port };
}

module.exports = { createNmeaService, DEFAULT_PORT };
