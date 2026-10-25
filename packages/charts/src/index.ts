/**
 * Chart library — tile57 bake + offline PMTiles (HeyCaptain BYO S-57).
 * Visual tiles ≠ source ENC geometry used for query/safety.
 */

export type PermitStatus = "plain" | "unsupported-s63" | "future";

export type BakeStatus =
  | "pending"
  | "ready"
  | "error"
  | "quarantine"
  | "raw-only"
  /** S-63 encrypted — tile57 cannot bake (MVP: no OEM decrypt) */
  | "cannot-bake";

export interface ChartCellMeta {
  name: string;
  band?: number;
  edition?: number;
  updateNo?: number;
  /** Absolute or relative path to .000 or bake folder */
  path: string;
  bakeStatus: BakeStatus;
  permitStatus: PermitStatus;
  /** Relative PMTiles path under bake root when ready */
  pmtilesPath?: string;
  center?: [number, number];
  zoom?: number;
  updateFiles?: string[];
  error?: string;
}

export const CHART_ENGINE = "tile57+maplibre" as const;

/**
 * Legacy NOAA demo cell (samples/enc-noaa). Not the app default —
 * primary ENC root is Turkish S-63 Hafta 17 (unsupported until OEM decrypt).
 */
export const DEMO_CELL = {
  name: "US5MD11M",
  center: [-76.55, 39.24] as [number, number],
  zoom: 12,
  bounds: {
    west: -76.6377,
    south: 39.1892,
    east: -76.4604,
    north: 39.2931,
  },
};

/** S-57 cell names: letter after US + digit = navigational purpose (band). */
export function bandFromCellName(name: string): number | undefined {
  const m = /^[A-Z]{2}(\d)/i.exec(name);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

export function cellDisplayTitle(cell: ChartCellMeta): string {
  const band = cell.band != null ? `Band ${cell.band}` : "Band ?";
  const upd = cell.updateNo != null ? ` · U${cell.updateNo}` : "";
  return `${cell.name} · ${band}${upd}`;
}
