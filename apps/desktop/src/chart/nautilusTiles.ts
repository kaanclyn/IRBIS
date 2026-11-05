/**
 * Nautilus karo ızgarası — equirectangular (lon/lat derece).
 *
 * Navionics disk: bizim-harita/navionics/{z}/{x}/{y}.png (256², Web-Mercator bake).
 * Nautilus Kernel ise bbox’ı kare PNG’ye lon/lat doğrusal basar → Mercator XYZ
 * yerleştirince kıyı kırılır (kara düzen). Bu yüzden derece ızgarası kullanıyoruz;
 * klasör fikri aynı: z / x / y.
 */

export const NAUTILUS_TILE = 256;

export type GeoBBox = { north: number; south: number; west: number; east: number };

export function lonStep(z: number) {
  return 360 / 2 ** Math.max(0, z);
}

/** Kare PNG + Kernel doğrusal map → lon/lat span eşit derece. */
export function latStep(z: number) {
  return lonStep(z);
}

export function lon2tileX(lon: number, z: number) {
  return (lon + 180) / lonStep(z);
}

export function lat2tileY(lat: number, z: number) {
  return (90 - lat) / latStep(z);
}

export function tileX2lon(x: number, z: number) {
  return -180 + x * lonStep(z);
}

export function tileY2lat(y: number, z: number) {
  return 90 - y * latStep(z);
}

export function tileBBox(x: number, y: number, z: number): GeoBBox {
  const dLon = lonStep(z);
  const dLat = latStep(z);
  const west = -180 + x * dLon;
  const east = west + dLon;
  const north = 90 - y * dLat;
  const south = north - dLat;
  return { west, east, north, south };
}

export function zoomForLonSpan(lonSpan: number, widthPx: number) {
  const span = Math.max(1e-8, Math.abs(lonSpan));
  const z = Math.log2((360 / span) * (widthPx / NAUTILUS_TILE));
  return Math.max(0, Math.min(18, Math.round(z)));
}

export function tileKey(z: number, x: number, y: number) {
  return `${z}/${x}/${y}`;
}

export function visibleTileRange(
  west: number,
  east: number,
  south: number,
  north: number,
  z: number,
  margin = 1
) {
  const maxX = 2 ** z;
  const maxY = Math.ceil(180 / latStep(z));
  let x0 = Math.floor(lon2tileX(west, z)) - margin;
  let x1 = Math.floor(lon2tileX(east, z)) + margin;
  let y0 = Math.floor(lat2tileY(north, z)) - margin;
  let y1 = Math.floor(lat2tileY(south, z)) + margin;
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(maxX - 1, x1);
  y1 = Math.min(maxY - 1, y1);
  return { x0, x1, y0, y1 };
}

/** İki bbox kesişiyor mu (hücre dışı karo atmak için). */
export function bboxIntersects(a: GeoBBox, b: GeoBBox) {
  return a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south;
}

export function viewBBoxFromCenter(
  centerLon: number,
  centerLat: number,
  z: number,
  stageW: number,
  stageH: number,
  cam: { x: number; y: number; scale: number }
): GeoBBox {
  const scale = Math.max(0.25, cam.scale);
  const cx = lon2tileX(centerLon, z) * NAUTILUS_TILE;
  const cy = lat2tileY(centerLat, z) * NAUTILUS_TILE;
  const left = cx - cam.x / scale - stageW / (2 * scale);
  const top = cy - cam.y / scale - stageH / (2 * scale);
  const right = left + stageW / scale;
  const bottom = top + stageH / scale;
  return {
    west: tileX2lon(left / NAUTILUS_TILE, z),
    east: tileX2lon(right / NAUTILUS_TILE, z),
    north: tileY2lat(top / NAUTILUS_TILE, z),
    south: tileY2lat(bottom / NAUTILUS_TILE, z),
  };
}

/** Komşu karo kenarları birebir örtüşüyor mu? (projeksiyon doğrulama) */
export function assertEquirectGrid(z = 10): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const x = 100;
  const y = 50;
  const a = tileBBox(x, y, z);
  const right = tileBBox(x + 1, y, z);
  const below = tileBBox(x, y + 1, z);
  if (Math.abs(a.east - right.west) > 1e-12) {
    errors.push(`lon seam z${z}: ${a.east} vs ${right.west}`);
  }
  if (Math.abs(a.south - below.north) > 1e-12) {
    errors.push(`lat seam z${z}: ${a.south} vs ${below.north}`);
  }
  const lon = tileX2lon(lon2tileX(12.5, z), z);
  const lat = tileY2lat(lat2tileY(55.25, z), z);
  if (Math.abs(lon - 12.5) > 1e-9) errors.push(`lon roundtrip ${lon}`);
  if (Math.abs(lat - 55.25) > 1e-9) errors.push(`lat roundtrip ${lat}`);
  // Çocuk karo, ebeveynin sol-üst çeyreğiyle örtüşmeli
  if (z < 18) {
    const parent = tileBBox(x, y, z);
    const child = tileBBox(x * 2, y * 2, z + 1);
    if (Math.abs(parent.west - child.west) > 1e-12 || Math.abs(parent.north - child.north) > 1e-12) {
      errors.push(`parent/child origin z${z}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Görünür karo setinin cache kapsama oranı 0..1 */
export function visibleCoverageRatio(wantedKeys: string[], has: (key: string) => boolean): number {
  if (wantedKeys.length === 0) return 1;
  let n = 0;
  for (const k of wantedKeys) if (has(k)) n += 1;
  return n / wantedKeys.length;
}
