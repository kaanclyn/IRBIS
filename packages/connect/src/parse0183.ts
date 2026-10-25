import { nmeaChecksumOk, stripNmea } from "./checksum";

export type ParsedOwnShipPatch = {
  lat?: number;
  lon?: number;
  sogKn?: number;
  /** Course over ground — magnetic if sentence gives mag; we store both when known */
  cogDegTrue?: number;
  cogDegMagnetic?: number;
  headingDegTrue?: number;
  headingDegMagnetic?: number;
  depthM?: number;
};

function dmToDeg(dm: string, hemi: string): number | undefined {
  if (!dm || dm.length < 3) return undefined;
  const n = Number(dm);
  if (!Number.isFinite(n)) return undefined;
  const deg = Math.trunc(n / 100);
  const minutes = n - deg * 100;
  let d = deg + minutes / 60;
  if (hemi === "S" || hemi === "W") d = -d;
  return d;
}

/** Talker-agnostic sentence type: chars after talker (e.g. GPRMC → RMC). */
export function sentenceType(body: string): string {
  const comma = body.indexOf(",");
  const tag = comma >= 0 ? body.slice(0, comma) : body;
  return tag.length >= 3 ? tag.slice(-3).toUpperCase() : tag.toUpperCase();
}

export function parseRmc(fields: string[]): ParsedOwnShipPatch | null {
  // RMC: time,status,lat,N,lon,E,sog,cog,date,...
  if (fields[2] !== "A") return null;
  const lat = dmToDeg(fields[3], fields[4]);
  const lon = dmToDeg(fields[5], fields[6]);
  const sogKn = fields[7] ? Number(fields[7]) : undefined;
  const cog = fields[8] ? Number(fields[8]) : undefined;
  const patch: ParsedOwnShipPatch = {};
  if (lat !== undefined) patch.lat = lat;
  if (lon !== undefined) patch.lon = lon;
  if (sogKn !== undefined && Number.isFinite(sogKn)) patch.sogKn = sogKn;
  // RMC COG is degrees true
  if (cog !== undefined && Number.isFinite(cog)) patch.cogDegTrue = cog;
  return patch;
}

export function parseHdgFamily(type: string, fields: string[]): ParsedOwnShipPatch | null {
  const h = fields[1] ? Number(fields[1]) : NaN;
  if (!Number.isFinite(h)) return null;
  if (type === "HDT") return { headingDegTrue: h };
  if (type === "HDM") return { headingDegMagnetic: h };
  if (type === "HDG") {
    // HDG: heading,dev,devDir,var,varDir — heading is magnetic
    const patch: ParsedOwnShipPatch = { headingDegMagnetic: h };
    const v = fields[4] ? Number(fields[4]) : NaN;
    const vDir = fields[5];
    if (Number.isFinite(v) && (vDir === "E" || vDir === "W")) {
      const magVar = vDir === "E" ? v : -v;
      patch.headingDegTrue = (h + magVar + 360) % 360;
    }
    return patch;
  }
  return null;
}

export function parseDepth(type: string, fields: string[]): ParsedOwnShipPatch | null {
  if (type === "DPT") {
    const d = fields[1] ? Number(fields[1]) : NaN;
    if (!Number.isFinite(d)) return null;
    return { depthM: d };
  }
  if (type === "DBT") {
    // feet, meters, fathoms — prefer meters field
    const m = fields[3] ? Number(fields[3]) : NaN;
    if (Number.isFinite(m)) return { depthM: m };
    const ft = fields[1] ? Number(fields[1]) : NaN;
    if (Number.isFinite(ft)) return { depthM: ft * 0.3048 };
  }
  return null;
}

export function parseNmea0183Line(raw: string): ParsedOwnShipPatch | null {
  const line = raw.trim();
  if (!line) return null;
  if (!nmeaChecksumOk(line) && line.includes("*")) return null;
  // allow missing checksum in sim for robustness only if no *
  if (line.includes("*") && !nmeaChecksumOk(line)) return null;

  const body = stripNmea(line.split("\r")[0].split("\n")[0]);
  if (!body) return null;
  const type = sentenceType(body);
  const fields = body.split(",");

  if (type === "RMC") return parseRmc(fields);
  if (type === "HDT" || type === "HDM" || type === "HDG") return parseHdgFamily(type, fields);
  if (type === "DPT" || type === "DBT") return parseDepth(type, fields);
  return null;
}
