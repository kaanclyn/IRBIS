/** S-52 colour schemes (tile57 `--scheme day|dusk|night`). */
export type ChartScheme = "day" | "dusk" | "night";

export const CHART_SCHEMES: ChartScheme[] = ["day", "dusk", "night"];

export const SCHEME_LABELS: Record<ChartScheme, string> = {
  day: "Gündüz",
  dusk: "Alacakaranlık",
  night: "Gece",
};

const STORAGE_KEY = "irbis.chart.scheme";

export function loadStoredScheme(): ChartScheme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "day" || v === "dusk" || v === "night") return v;
  } catch {
    /* ignore */
  }
  return "day";
}

export function storeScheme(scheme: ChartScheme) {
  try {
    localStorage.setItem(STORAGE_KEY, scheme);
  } catch {
    /* ignore */
  }
}

/** World basemap paints tuned so OpenFreeMap doesn't blow out dusk/night ENC. */
export type WorldPalette = {
  background: string;
  water: string;
  landWood: string;
  landGrass: string;
  landSand: string;
  landIce: string;
  landDefault: string;
  residential: string;
  coverageFill: string;
  coverageOutline: string;
  coverageLabel: string;
  coverageHalo: string;
  /** Natural Earth raster adjustments */
  rasterOpacity: number;
  rasterBrightnessMin: number;
  rasterBrightnessMax: number;
  rasterContrast: number;
  rasterSaturation: number;
};

export const WORLD_PALETTES: Record<ChartScheme, WorldPalette> = {
  day: {
    background: "#a8d4ea",
    water: "#a8d4ea",
    landWood: "#b7c9a3",
    landGrass: "#c9d9a8",
    landSand: "#e6d9b8",
    landIce: "#e8f0f4",
    landDefault: "#d6c7a1",
    residential: "#dccfb3",
    coverageFill: "#c4a574",
    coverageOutline: "#e67e22",
    coverageLabel: "#7a3e0b",
    coverageHalo: "#fff8ee",
    rasterOpacity: 0.95,
    rasterBrightnessMin: 0,
    rasterBrightnessMax: 1,
    rasterContrast: 0,
    rasterSaturation: 0,
  },
  dusk: {
    background: "#0a1218",
    water: "#0a1218",
    landWood: "#2a3324",
    landGrass: "#2e3526",
    landSand: "#3a3428",
    landIce: "#2a3238",
    landDefault: "#322c22",
    residential: "#2e2a22",
    coverageFill: "#5c4030",
    coverageOutline: "#a35a1a",
    coverageLabel: "#c9a27a",
    coverageHalo: "#0a1218",
    rasterOpacity: 0.55,
    rasterBrightnessMin: -0.35,
    rasterBrightnessMax: 0.55,
    rasterContrast: -0.15,
    rasterSaturation: -0.35,
  },
  night: {
    background: "#000000",
    water: "#000000",
    landWood: "#0e120c",
    landGrass: "#10140e",
    landSand: "#14110c",
    landIce: "#0c1014",
    landDefault: "#12100c",
    residential: "#100e0c",
    coverageFill: "#2a1c12",
    coverageOutline: "#6b3a12",
    coverageLabel: "#7a5a3a",
    coverageHalo: "#000000",
    rasterOpacity: 0.32,
    rasterBrightnessMin: -0.55,
    rasterBrightnessMax: 0.28,
    rasterContrast: -0.25,
    rasterSaturation: -0.55,
  },
};

export function stylePathForScheme(scheme: ChartScheme): string {
  return `style-${scheme}.json`;
}

/**
 * Load tile57 style for scheme. Prefers `style-{scheme}.json`, then `style.json`
 * (day). If only day is available for dusk/night, remaps S-52 tokens via colortables.
 */
export async function fetchSchemeStyle(
  baseUrl: string,
  scheme: ChartScheme,
  fallbackPath = "style.json",
): Promise<{ style: unknown; path: string; remapped: boolean }> {
  const preferred = stylePathForScheme(scheme);
  const tryPaths =
    scheme === "day"
      ? [preferred, fallbackPath]
      : [preferred, fallbackPath];

  let raw: unknown | null = null;
  let usedPath = preferred;
  for (const p of tryPaths) {
    const res = await fetch(`${baseUrl}/${p}`);
    if (res.ok) {
      raw = await res.json();
      usedPath = p;
      break;
    }
  }
  if (!raw) throw new Error(`style fetch failed for scheme=${scheme}`);

  const name = (raw as { name?: string }).name ?? "";
  const looksLikeScheme =
    name.includes(`(${scheme})`) || usedPath.includes(`style-${scheme}`);

  if (looksLikeScheme || scheme === "day") {
    return { style: raw, path: usedPath, remapped: false };
  }

  // Day-only bake: remap hex colours using assets/colortables.json
  const ctRes = await fetch(`${baseUrl}/assets/colortables.json`);
  if (!ctRes.ok) {
    return { style: raw, path: usedPath, remapped: false };
  }
  const tables = (await ctRes.json()) as Record<string, Record<string, string>>;
  const from = tables.day;
  const to = tables[scheme];
  if (!from || !to) return { style: raw, path: usedPath, remapped: false };

  const remapped = remapStyleColors(raw, from, to);
  if (remapped && typeof remapped === "object" && remapped !== null) {
    (remapped as { name?: string }).name = `tile57 (${scheme}, remapped)`;
  }
  return { style: remapped, path: usedPath, remapped: true };
}

function remapStyleColors(value: unknown, from: Record<string, string>, to: Record<string, string>): unknown {
  const hexMap = new Map<string, string>();
  for (const [token, dayHex] of Object.entries(from)) {
    const target = to[token];
    if (target && dayHex !== target) {
      hexMap.set(dayHex.toLowerCase(), target);
    }
  }

  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      const hit = hexMap.get(node.toLowerCase());
      return hit ?? node;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        out[k] = walk(v);
      }
      return out;
    }
    return node;
  };

  return walk(value);
}
