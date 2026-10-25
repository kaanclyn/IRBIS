/**
 * Minimal AIS decoder: types 1–3, 5, 18, 19, 24 (+ multi-fragment AIVDM).
 */

const SIXBIT =
  "@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_ !\"#$%&'()*+,-./0123456789:;<=>?";

function payloadToBits(payload) {
  let bits = "";
  for (let i = 0; i < payload.length; i += 1) {
    const v = payload.charCodeAt(i) - 48;
    const six = v > 40 ? v - 8 : v;
    bits += six.toString(2).padStart(6, "0");
  }
  return bits;
}

function u(bits, start, len) {
  return parseInt(bits.slice(start, start + len), 2);
}

function i(bits, start, len) {
  let v = u(bits, start, len);
  const sign = 1 << (len - 1);
  if (v & sign) v -= 1 << len;
  return v;
}

function aisText(bits, start, chars) {
  let out = "";
  for (let c = 0; c < chars; c += 1) {
    const code = u(bits, start + c * 6, 6);
    out += SIXBIT[code] ?? "@";
  }
  return out.replace(/@+$/g, "").trim();
}

function lonLat(bits, lonStart, latStart) {
  const lonRaw = i(bits, lonStart, 28);
  const latRaw = i(bits, latStart, 27);
  if (lonRaw === 0x6791ac0 || latRaw === 0x3412140) return null;
  return { lon: lonRaw / 600000, lat: latRaw / 600000 };
}

function decodePositionClassA(bits) {
  const type = u(bits, 0, 6);
  const mmsi = u(bits, 8, 30);
  const sogRaw = u(bits, 46, 10);
  const cogRaw = u(bits, 116, 12);
  const hdgRaw = u(bits, 128, 9);
  const pos = lonLat(bits, 61, 89);
  if (!pos) return null;
  return {
    msgType: type,
    class: "A",
    mmsi,
    lat: pos.lat,
    lon: pos.lon,
    sogKn: sogRaw === 1023 ? undefined : sogRaw / 10,
    cogDeg: cogRaw === 3600 ? undefined : cogRaw / 10,
    headingDeg: hdgRaw === 511 ? undefined : hdgRaw,
  };
}

function decodeType5(bits) {
  if (bits.length < 424) return null;
  return {
    msgType: 5,
    class: "A",
    mmsi: u(bits, 8, 30),
    shipType: u(bits, 232, 8),
    name: aisText(bits, 112, 20),
    callSign: aisText(bits, 70, 7),
    dimA: u(bits, 240, 9),
    dimB: u(bits, 249, 9),
    dimC: u(bits, 258, 6),
    dimD: u(bits, 264, 6),
  };
}

function decodeType18(bits) {
  const mmsi = u(bits, 8, 30);
  const sogRaw = u(bits, 46, 10);
  const cogRaw = u(bits, 112, 12);
  const hdgRaw = u(bits, 124, 9);
  const pos = lonLat(bits, 57, 85);
  if (!pos) return null;
  return {
    msgType: 18,
    class: "B",
    mmsi,
    lat: pos.lat,
    lon: pos.lon,
    sogKn: sogRaw === 1023 ? undefined : sogRaw / 10,
    cogDeg: cogRaw === 3600 ? undefined : cogRaw / 10,
    headingDeg: hdgRaw === 511 ? undefined : hdgRaw,
  };
}

function decodeType19(bits) {
  const base = decodeType18(bits);
  if (!base) return null;
  return {
    ...base,
    msgType: 19,
    name: aisText(bits, 143, 20),
    shipType: u(bits, 263, 8),
  };
}

function decodeType24(bits) {
  const mmsi = u(bits, 8, 30);
  const part = u(bits, 38, 2);
  if (part === 0) {
    return { msgType: 24, class: "B", mmsi, name: aisText(bits, 40, 20), part: "A" };
  }
  return {
    msgType: 24,
    class: "B",
    mmsi,
    part: "B",
    shipType: u(bits, 40, 8),
    callSign: aisText(bits, 90, 7),
    dimA: u(bits, 132, 9),
    dimB: u(bits, 141, 9),
    dimC: u(bits, 150, 6),
    dimD: u(bits, 156, 6),
  };
}

function decodeBits(bits) {
  const type = u(bits, 0, 6);
  if (type >= 1 && type <= 3) return decodePositionClassA(bits);
  if (type === 5) return decodeType5(bits);
  if (type === 18) return decodeType18(bits);
  if (type === 19) return decodeType19(bits);
  if (type === 24) return decodeType24(bits);
  return null;
}

function createAisAssembler() {
  /** @type {Map<string, { total: number, parts: Map<number, string>, channel: string }>} */
  const pending = new Map();

  /**
   * @param {string} body  AIVDM/AIVDO body without ! and checksum
   * @returns {object | null}
   */
  function feed(body) {
    const f = body.split(",");
    // !AIVDM,fragCount,fragNum,seqId,channel,payload,fill
    if (f.length < 7) return null;
    const total = Number(f[1]);
    const num = Number(f[2]);
    const seq = f[3] || "0";
    const channel = f[4] || "A";
    const payload = f[5];
    if (!payload || !Number.isFinite(total) || !Number.isFinite(num)) return null;

    if (total === 1) {
      return decodeBits(payloadToBits(payload));
    }

    const key = `${seq}:${channel}:${total}`;
    let slot = pending.get(key);
    if (!slot) {
      slot = { total, parts: new Map(), channel };
      pending.set(key, slot);
    }
    slot.parts.set(num, payload);
    if (slot.parts.size < total) return null;

    let full = "";
    for (let i = 1; i <= total; i += 1) {
      const p = slot.parts.get(i);
      if (!p) {
        pending.delete(key);
        return null;
      }
      full += p;
    }
    pending.delete(key);
    return decodeBits(payloadToBits(full));
  }

  return { feed };
}

module.exports = { createAisAssembler, decodeBits, payloadToBits };
