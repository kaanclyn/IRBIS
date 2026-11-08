const dgram = require("node:dgram");
const { createAisAssembler } = require("./aisDecode.cjs");
const {
  OWN: SIM_OWN,
  AIS_TARGETS: SIM_AIS,
  CRUISE_ROUTE,
  CRUISE_DEFAULT_SPEED_KN,
  CRUISE_MAX_SPEED_KN,
} = require("./simScenario.cjs");

const MAX_SPEED_KN = Number(CRUISE_MAX_SPEED_KN) || 80;
/** Max rate of turn for sim heading (deg/s) — ani sıçrama yok */
const MAX_ROT_DEG_S = 45;

const DEFAULT_PORT = 10110;
const LIVE_IDLE_MS = 2500;
const AIS_LOST_MS = 60000;
const EARTH_R_M = 6371000;

function haversineM(lat1, lon1, lat2, lon2) {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function destinationPoint(lat, lon, brgDeg, distM) {
  const δ = distM / EARTH_R_M;
  const θ = (brgDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
    );
  return {
    lat: (φ2 * 180) / Math.PI,
    lon: (((λ2 * 180) / Math.PI + 540) % 360) - 180,
  };
}

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

  /** Cruise sim: kullanıcı Başlat deyince rota boyunca ilerler */
  const cruise = {
    running: false,
    speedKn: CRUISE_DEFAULT_SPEED_KN,
    /** @type {number} */
    lat: SIM_OWN.lat,
    /** @type {number} */
    lon: SIM_OWN.lon,
    heading: SIM_OWN.headingDegTrue,
    cog: SIM_OWN.cogDegTrue,
    segIndex: 0,
    lastTickMs: 0,
  };

  function cruiseStatus() {
    const route = CRUISE_ROUTE || [];
    return {
      running: cruise.running,
      speedKn: cruise.speedKn,
      segIndex: cruise.segIndex,
      waypointCount: route.length,
      lat: cruise.lat,
      lon: cruise.lon,
      route: route.map((w) => ({ lat: w.lat, lon: w.lon, name: w.name || null })),
    };
  }

  function clampSpeed(kn) {
    return Math.max(0.5, Math.min(MAX_SPEED_KN, kn));
  }

  function turnToward(current, target, maxDelta) {
    const d = ((target - current + 540) % 360) - 180;
    if (Math.abs(d) <= maxDelta) return ((target % 360) + 360) % 360;
    return ((current + Math.sign(d) * maxDelta) % 360 + 360) % 360;
  }

  function controlSim(cmd = {}) {
    const action = String(cmd.action || "").toLowerCase();
    if (action === "start" || action === "resume") {
      cruise.running = true;
      cruise.lastTickMs = Date.now();
      if (Number.isFinite(Number(cmd.speedKn))) {
        cruise.speedKn = clampSpeed(Number(cmd.speedKn));
      }
      // Sadece açık reset/restart → başa al. Durdur→Başlat kaldığı yerden.
      if ((cmd.reset === true || action === "restart") && CRUISE_ROUTE?.length) {
        cruise.segIndex = 0;
        cruise.lat = CRUISE_ROUTE[0].lat;
        cruise.lon = CRUISE_ROUTE[0].lon;
        const nxt = CRUISE_ROUTE[1] || CRUISE_ROUTE[0];
        cruise.heading = bearingDeg(cruise.lat, cruise.lon, nxt.lat, nxt.lon);
        cruise.cog = cruise.heading;
      }
    } else if (action === "restart") {
      cruise.running = true;
      cruise.lastTickMs = Date.now();
      if (Number.isFinite(Number(cmd.speedKn))) cruise.speedKn = clampSpeed(Number(cmd.speedKn));
      if (CRUISE_ROUTE?.length) {
        cruise.segIndex = 0;
        cruise.lat = CRUISE_ROUTE[0].lat;
        cruise.lon = CRUISE_ROUTE[0].lon;
        const nxt = CRUISE_ROUTE[1] || CRUISE_ROUTE[0];
        cruise.heading = bearingDeg(cruise.lat, cruise.lon, nxt.lat, nxt.lon);
        cruise.cog = cruise.heading;
      }
    } else if (action === "stop") {
      cruise.running = false;
    } else if (action === "setSpeed" || action === "speed") {
      const kn = Number(cmd.speedKn);
      if (Number.isFinite(kn)) cruise.speedKn = clampSpeed(kn);
    } else if (action === "status") {
      /* no-op */
    }
    return cruiseStatus();
  }

  function advanceCruise(nowMs) {
    const route = CRUISE_ROUTE;
    if (!route?.length) return;
    if (!cruise.lastTickMs) cruise.lastTickMs = nowMs;
    const dt = Math.min(1, Math.max(0, (nowMs - cruise.lastTickMs) / 1000));
    cruise.lastTickMs = nowMs;
    if (!cruise.running || dt <= 0) return;

    let remainM = (cruise.speedKn * 1852) / 3600 * dt;
    let targetBrg = cruise.heading;
    let guard = 0;
    while (remainM > 0 && guard++ < 48) {
      const b = route[(cruise.segIndex + 1) % route.length];
      targetBrg = bearingDeg(cruise.lat, cruise.lon, b.lat, b.lon);
      const toWp = haversineM(cruise.lat, cruise.lon, b.lat, b.lon);
      if (toWp <= remainM || toWp < 2) {
        cruise.lat = b.lat;
        cruise.lon = b.lon;
        remainM -= toWp;
        cruise.segIndex = (cruise.segIndex + 1) % route.length;
        continue;
      }
      const next = destinationPoint(cruise.lat, cruise.lon, targetBrg, remainM);
      cruise.lat = next.lat;
      cruise.lon = next.lon;
      remainM = 0;
    }
    // Heading yumuşak döner (ani 77→128 yok)
    cruise.heading = turnToward(cruise.heading, targetBrg, MAX_ROT_DEG_S * dt);
    cruise.cog = cruise.heading;
  }

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
    const nowMs = now.getTime();
    const t = nowMs / 1000;
    const at = now.toISOString();
    const source = cruise.running ? "sim:cruise" : "sim:idle";

    advanceCruise(nowMs);

    const lat = cruise.running
      ? cruise.lat
      : cruise.lat + Math.sin(t / 90) * 0.00001;
    const lon = cruise.running
      ? cruise.lon
      : cruise.lon + Math.cos(t / 95) * 0.00001;
    const sog = cruise.running ? cruise.speedKn : 0;
    const hdg = cruise.heading;
    const cog = cruise.cog;

    state = applyPatch(
      {
        ...state,
        mode: "simulation",
        simScenario: cruise.running ? "cruise-gb5x01nw" : "idle",
        simCruise: cruiseStatus(),
      },
      {
        lat,
        lon,
        sogKn: sog,
        depthM: SIM_OWN.depthM + Math.sin(t / 20) * 0.2,
        cogDegTrue: cog,
        headingDegTrue: hdg,
        headingDegMagnetic: hdg,
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

    simTimer = setInterval(tickSim, 200);
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
    return { ...state, checksumErrors, udpPort: port, simCruise: cruiseStatus() };
  }

  function getAis() {
    return { targets: targetsList(), count: targets.size };
  }

  return { start, stop, getState, getAis, controlSim, cruiseStatus, port };
}

module.exports = { createNmeaService, DEFAULT_PORT };
