import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { LayerSpecification, Map, StyleSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  type ChartScheme,
  WORLD_PALETTES,
  fetchSchemeStyle,
} from "./scheme";

export interface ChartConfig {
  baseUrl: string;
  pmtilesPath: string;
  stylePath: string;
  spritePath: string;
  center: [number, number];
  zoom: number;
  cellName: string;
  mode: string;
  bakeReady?: boolean;
  warning?: string;
  worldCenter?: [number, number];
  worldZoom?: number;
  s63Detected?: boolean;
  userPermitCount?: number;
  /** Prefer false — keep subtle nautical basemap under ENC (HeyCaptain-like). */
  hideWorldBasemap?: boolean;
  labBakeActive?: boolean;
  displayLabel?: string;
  fitBounds?: [number, number, number, number] | null;
  mapMode?: "navionics" | "s57-lab" | string;
  navionics?: {
    tileUrl: string;
    sonarUrl?: string | null;
    cacheDir?: string;
    offlineOnly?: boolean;
    cache?: { count?: number; bytesMb?: number };
  } | null;
  readyCells?: Array<{
    name: string;
    pmtilesPath: string;
    center?: [number, number];
    zoom?: number;
    bbox?: [number, number, number, number] | null;
  }>;
}

export interface ChartFeatureHit {
  layerId: string;
  sourceLayer?: string;
  properties: Record<string, unknown>;
}

let protocolRegistered = false;
let workerConfigured = false;

function ensureMaplibreWorker() {
  if (workerConfigured) return;
  let url = maplibreWorkerUrl;
  if (!url || url.includes("/.vite/deps/")) {
    url = new URL(
      "../../../../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs",
      import.meta.url,
    ).href;
  }
  maplibregl.setWorkerUrl(url);
  workerConfigured = true;
}

function ensurePmtilesProtocol() {
  if (protocolRegistered) return;
  const protocol = new Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
  protocolRegistered = true;
}

/** Free Natural Earth world (OpenFreeMap) — Njord-like land/water context, no API key. */
const WORLD_NE = {
  type: "raster" as const,
  tiles: ["https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png"],
  tileSize: 256,
  maxzoom: 6,
  attribution: "© OpenFreeMap · Natural Earth",
};

const WORLD_OMT = {
  type: "vector" as const,
  url: "https://tiles.openfreemap.org/planet",
  attribution: "© OpenMapTiles © OpenStreetMap contributors",
};

function coverageFeatureCollection(cells: NonNullable<ChartConfig["readyCells"]>) {
  return {
    type: "FeatureCollection" as const,
    features: cells
      .filter((c) => c.bbox && c.bbox.length === 4)
      .map((c) => {
        const [w, s, e, n] = c.bbox!;
        return {
          type: "Feature" as const,
          properties: { name: c.name },
          geometry: {
            type: "Polygon" as const,
            coordinates: [
              [
                [w, s],
                [e, s],
                [e, n],
                [w, n],
                [w, s],
              ],
            ],
          },
        };
      }),
  };
}

function cloneChartLayers(
  layers: LayerSpecification[],
  sourceId: string,
  cellName: string,
): LayerSpecification[] {
  return layers
    .filter((l) => "source" in l && (l as { source?: string }).source === "chart")
    .map((l) => {
      const copy = structuredClone(l) as LayerSpecification & { source?: string; id: string };
      copy.id = `${l.id}__${cellName}`;
      copy.source = sourceId;
      return copy;
    });
}

function worldLayersForScheme(scheme: ChartScheme): LayerSpecification[] {
  const p = WORLD_PALETTES[scheme];
  return [
    {
      id: "world-bg",
      type: "background",
      paint: { "background-color": p.background },
    },
    {
      id: "world-ne",
      type: "raster",
      source: "world_ne",
      maxzoom: 7,
      paint: {
        "raster-opacity": p.rasterOpacity,
        "raster-fade-duration": 0,
        "raster-brightness-min": p.rasterBrightnessMin,
        "raster-brightness-max": p.rasterBrightnessMax,
        "raster-contrast": p.rasterContrast,
        "raster-saturation": p.rasterSaturation,
      },
    },
    {
      id: "world-water",
      type: "fill",
      source: "world_omt",
      "source-layer": "water",
      paint: { "fill-color": p.water },
    },
    {
      id: "world-landcover",
      type: "fill",
      source: "world_omt",
      "source-layer": "landcover",
      paint: {
        "fill-color": [
          "match",
          ["get", "class"],
          "wood",
          p.landWood,
          "grass",
          p.landGrass,
          "sand",
          p.landSand,
          "ice",
          p.landIce,
          p.landDefault,
        ],
        "fill-opacity": scheme === "day" ? 0.55 : scheme === "dusk" ? 0.7 : 0.85,
      },
    },
    {
      id: "world-landuse",
      type: "fill",
      source: "world_omt",
      "source-layer": "landuse",
      filter: ["==", ["get", "class"], "residential"],
      paint: {
        "fill-color": p.residential,
        "fill-opacity": scheme === "day" ? 0.35 : 0.5,
      },
    },
  ];
}

function coverageLayersForScheme(scheme: ChartScheme): LayerSpecification[] {
  const p = WORLD_PALETTES[scheme];
  return [
    {
      id: "enc-coverage-fill",
      type: "fill",
      source: "enc_coverage",
      maxzoom: 10,
      paint: {
        "fill-color": p.coverageFill,
        "fill-opacity": scheme === "day" ? 0.22 : 0.28,
      },
    },
    {
      id: "enc-coverage-outline",
      type: "line",
      source: "enc_coverage",
      paint: {
        "line-color": p.coverageOutline,
        "line-width": ["interpolate", ["linear"], ["zoom"], 0, 0.6, 6, 1.4, 10, 2],
        "line-opacity": 0.9,
      },
    },
    {
      id: "enc-coverage-label",
      type: "symbol",
      source: "enc_coverage",
      minzoom: 5,
      maxzoom: 11,
      layout: {
        "text-field": ["get", "name"],
        "text-size": 11,
        "text-font": ["Noto Sans Regular"],
        "text-optional": true,
      },
      paint: {
        "text-color": p.coverageLabel,
        "text-halo-color": p.coverageHalo,
        "text-halo-width": 1.2,
      },
    },
  ];
}

async function buildStyle(cfg: ChartConfig, scheme: ChartScheme): Promise<{
  style: StyleSpecification;
  styleMeta: { path: string; remapped: boolean };
}> {
  const { style: raw, path, remapped } = await fetchSchemeStyle(
    cfg.baseUrl,
    scheme,
    cfg.stylePath || "style.json",
  );
  const style = raw as StyleSpecification;

  // Empty readyCells = world basemap only (S-63 / no bake). Do not invent a fake NOAA quilt.
  const ready =
    cfg.readyCells && cfg.readyCells.length > 0
      ? cfg.readyCells
      : cfg.bakeReady && cfg.pmtilesPath
        ? [{ name: cfg.cellName, pmtilesPath: cfg.pmtilesPath, bbox: null }]
        : [];

  const chartSources: StyleSpecification["sources"] = {};
  for (const cell of ready) {
    if (!cell.pmtilesPath) continue;
    const id = `chart_${cell.name}`;
    chartSources[id] = {
      type: "vector",
      url: `pmtiles://${cfg.baseUrl}/${cell.pmtilesPath}`,
      encoding: "mlt",
    } as StyleSpecification["sources"][string];
  }

  if (ready.length > 0) {
    chartSources.chart = chartSources[`chart_${cfg.cellName}`] || {
      type: "vector",
      url: `pmtiles://${cfg.baseUrl}/${cfg.pmtilesPath}`,
      encoding: "mlt",
    };
  }

  const useNavionics = cfg.mapMode === "navionics" && !!cfg.navionics?.tileUrl;
  // Under Navionics: skip OpenFreeMap. Under S-57 lab: keep world basemap.
  const hideWorld = useNavionics || (!!cfg.hideWorldBasemap && ready.length > 0);
  const p = WORLD_PALETTES[scheme];

  style.sources = {
    ...(hideWorld
      ? {}
      : {
          world_ne: WORLD_NE,
          world_omt: WORLD_OMT,
        }),
    ...(useNavionics
      ? {
          navionics: {
            type: "raster" as const,
            tiles: [cfg.navionics!.tileUrl],
            tileSize: 256,
            maxzoom: 18,
            attribution: "Navionics (offline cache)",
          },
          ...(cfg.navionics?.sonarUrl
            ? {
                sonar: {
                  type: "raster" as const,
                  tiles: [cfg.navionics.sonarUrl],
                  tileSize: 256,
                  maxzoom: 18,
                  attribution: "Navionics SonarChart",
                },
              }
            : {}),
        }
      : {}),
    enc_coverage: {
      type: "geojson",
      data: coverageFeatureCollection(ready),
    },
    ...chartSources,
  };
  style.sprite = `${cfg.baseUrl}/${cfg.spritePath}`;
  style.glyphs = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

  const chartLayerTemplate = (style.layers || []).filter(
    (l) => "source" in l && (l as { source?: string }).source === "chart",
  );

  const encLayers = ready.flatMap((cell) =>
    cloneChartLayers(chartLayerTemplate, `chart_${cell.name}`, cell.name),
  );

  const voidBg: LayerSpecification = {
    id: "world-bg",
    type: "background",
    paint: { "background-color": p.background },
  };

  const navLayers: LayerSpecification[] = useNavionics
    ? [
        voidBg,
        {
          id: "navionics-raster",
          type: "raster",
          source: "navionics",
          paint: {
            "raster-opacity": 1,
            "raster-fade-duration": 0,
          },
        },
        ...(cfg.navionics?.sonarUrl
          ? [
              {
                id: "sonar-raster",
                type: "raster" as const,
                source: "sonar",
                paint: {
                  "raster-opacity": 0.55,
                  "raster-fade-duration": 0,
                },
              } satisfies LayerSpecification,
            ]
          : []),
      ]
    : hideWorld
      ? [voidBg]
      : worldLayersForScheme(scheme);

  style.layers = [...navLayers, ...coverageLayersForScheme(scheme), ...encLayers];
  return { style, styleMeta: { path, remapped } };
}

const AIS_PALETTE = [
  "#fbbf24",
  "#38bdf8",
  "#a78bfa",
  "#34d399",
  "#fb7185",
  "#f97316",
  "#2dd4bf",
  "#e879f9",
  "#84cc16",
  "#60a5fa",
  "#f472b6",
  "#22d3ee",
];

function colorIndexForMmsi(mmsi: number): number {
  return Math.abs(Number(mmsi) || 0) % AIS_PALETTE.length;
}

function drawShipIcon(
  fill: string,
  stroke = "#0b0d10",
  size = 72,
): ImageData | null {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);
  // vessel wedge (nose up = heading 0)
  ctx.beginPath();
  ctx.moveTo(0, -26);
  ctx.lineTo(16, 24);
  ctx.lineTo(0, 14);
  ctx.lineTo(-16, 24);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 3.5;
  ctx.lineJoin = "round";
  ctx.fill();
  ctx.stroke();
  // glow ring for prominence
  ctx.beginPath();
  ctx.arc(0, 2, 6, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

function ensureOwnShipLayers(map: Map) {
  if (map.getSource("ownship")) return;
  map.addSource("ownship", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "ownship-halo",
    type: "circle",
    source: "ownship",
    paint: {
      "circle-radius": 18,
      "circle-color": "rgba(46, 184, 230, 0.22)",
      "circle-stroke-width": 2,
      "circle-stroke-color": "rgba(46, 184, 230, 0.65)",
    },
  });
  map.addLayer({
    id: "ownship-triangle",
    type: "symbol",
    source: "ownship",
    layout: {
      "icon-image": "ownship-arrow",
      "icon-size": 1.15,
      "icon-rotate": ["get", "heading"],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });
}

function ensureAisIcons(map: Map) {
  for (let i = 0; i < AIS_PALETTE.length; i += 1) {
    const id = `ais-ship-${i}`;
    if (map.hasImage(id)) continue;
    const data = drawShipIcon(AIS_PALETTE[i], "#061018");
    if (data) map.addImage(id, data, { pixelRatio: 2 });
  }
  if (!map.hasImage("ais-ship-lost")) {
    const lost = drawShipIcon("#94a3b8", "#334155");
    if (lost) map.addImage("ais-ship-lost", lost, { pixelRatio: 2 });
  }
}

function ensureAisLayers(map: Map, scheme: ChartScheme = "day") {
  const label = scheme === "night" ? "#cbd5e1" : "#f8fafc";
  const halo = scheme === "day" ? "rgba(6,16,24,0.92)" : "rgba(0,0,0,0.9)";

  ensureAisIcons(map);

  if (!map.getSource("ais")) {
    map.addSource("ais", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: "ais-halo",
      type: "circle",
      source: "ais",
      paint: {
        "circle-radius": 14,
        "circle-color": [
          "case",
          ["==", ["get", "lost"], 1],
          "rgba(148,163,184,0.2)",
          ["concat", "rgba(", ["get", "rgb"], ",0.28)"],
        ],
        "circle-stroke-width": 1.5,
        "circle-stroke-color": [
          "case",
          ["==", ["get", "lost"], 1],
          "#94a3b8",
          ["get", "color"],
        ],
      },
    });
    // Fallback if rgb concat fails in some MapLibre builds — use color with opacity via match
    try {
      map.setPaintProperty("ais-halo", "circle-color", [
        "case",
        ["==", ["get", "lost"], 1],
        "rgba(148,163,184,0.25)",
        ["get", "color"],
      ]);
      map.setPaintProperty("ais-halo", "circle-opacity", 0.35);
    } catch {
      /* keep */
    }
    map.addLayer({
      id: "ais-ships",
      type: "symbol",
      source: "ais",
      layout: {
        "icon-image": [
          "case",
          ["==", ["get", "lost"], 1],
          "ais-ship-lost",
          ["concat", "ais-ship-", ["to-string", ["get", "colorIdx"]]],
        ],
        "icon-size": 1.05,
        "icon-rotate": ["coalesce", ["get", "heading"], ["get", "cog"], 0],
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
    map.addLayer({
      id: "ais-labels",
      type: "symbol",
      source: "ais",
      layout: {
        "text-field": ["get", "label"],
        "text-size": 12,
        "text-offset": [0, 1.85],
        "text-anchor": "top",
        "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        "text-optional": true,
        "text-allow-overlap": false,
        "text-max-width": 10,
      },
      paint: {
        "text-color": label,
        "text-halo-color": halo,
        "text-halo-width": 1.6,
      },
    });
    return;
  }

  if (map.getLayer("ais-labels")) {
    map.setPaintProperty("ais-labels", "text-color", label);
    map.setPaintProperty("ais-labels", "text-halo-color", halo);
  }
}

function ensureOwnShipIcon(map: Map) {
  if (map.hasImage("ownship-arrow")) return;
  const data = drawShipIcon("#2eb8e6", "#031018", 80);
  if (data) map.addImage("ownship-arrow", data, { pixelRatio: 2 });
}

function aisPopupHtml(p: Record<string, unknown>): string {
  const name = String(p.label || p.name || p.mmsi || "AIS");
  const mmsi = p.mmsi != null ? String(p.mmsi) : "—";
  const cls = p.class != null ? String(p.class) : "—";
  const sog = p.sog != null && p.sog !== "" ? `${Number(p.sog).toFixed(1)} kn` : "—";
  const cog = p.cog != null && p.cog !== "" ? `${Math.round(Number(p.cog))}°` : "—";
  const hdg = p.heading != null && p.heading !== "" ? `${Math.round(Number(p.heading))}°` : "—";
  const lost = Number(p.lost) === 1 ? " (kayıp)" : "";
  const color = String(p.color || "#2eb8e6");
  return `<div class="ais-popup">
    <div class="ais-popup-head" style="border-color:${color}">
      <span class="ais-popup-dot" style="background:${color}"></span>
      <strong>${name}${lost}</strong>
    </div>
    <div class="ais-popup-grid">
      <span>MMSI</span><b>${mmsi}</b>
      <span>Sınıf</span><b>${cls}</b>
      <span>SOG</span><b>${sog}</b>
      <span>COG</span><b>${cog}</b>
      <span>HDG</span><b>${hdg}</b>
    </div>
  </div>`;
}

function toAisFeatures(
  targets: Array<{
    mmsi: number;
    name: string | null;
    class: string | null;
    lat: number;
    lon: number;
    lost: boolean;
    sogKn?: number;
    cogDeg?: number;
    headingDeg?: number;
  }> | undefined,
) {
  return (targets ?? []).map((t) => {
    const colorIdx = colorIndexForMmsi(t.mmsi);
    const color = AIS_PALETTE[colorIdx];
    const heading = t.headingDeg ?? t.cogDeg ?? 0;
    return {
      type: "Feature" as const,
      properties: {
        mmsi: t.mmsi,
        name: t.name,
        label: t.name || String(t.mmsi),
        class: t.class || "A",
        lost: t.lost ? 1 : 0,
        sog: t.sogKn ?? "",
        cog: t.cogDeg ?? "",
        heading,
        colorIdx,
        color,
      },
      geometry: { type: "Point" as const, coordinates: [t.lon, t.lat] },
    };
  });
}

function chartQueryLayerIds(map: Map): string[] {
  const style = map.getStyle();
  if (!style?.layers) return [];
  return style.layers
    .filter((l) => {
      if (!("source" in l)) return false;
      const src = (l as { source?: string }).source ?? "";
      return src === "chart" || src.startsWith("chart_");
    })
    .map((l) => l.id);
}

export function ChartMap({
  onMove,
  onCursorMove,
  ownShip,
  headingDeg,
  aisTargets,
  aisVisible = true,
  radarVisible = false,
  radarInfo = false,
  radarArpa = false,
  reloadToken = 0,
  scheme = "day",
  onFeatureQuery,
  onMapClick,
  clickCapture = false,
}: {
  onMove?: (info: { lat: number; lon: number; zoom: number }) => void;
  /** Mouse pointer lat/lon over the chart; null when pointer leaves. */
  onCursorMove?: (info: { lat: number; lon: number } | null) => void;
  ownShip?: { lat: number; lon: number; stale?: boolean } | null;
  headingDeg?: number;
  aisTargets?: Array<{
    mmsi: number;
    name: string | null;
    class: string | null;
    lat: number;
    lon: number;
    lost: boolean;
    sogKn?: number;
    cogDeg?: number;
    headingDeg?: number;
  }>;
  aisVisible?: boolean;
  radarVisible?: boolean;
  radarInfo?: boolean;
  radarArpa?: boolean;
  reloadToken?: number;
  scheme?: ChartScheme;
  onFeatureQuery?: (hit: ChartFeatureHit | null) => void;
  onMapClick?: (ll: { lat: number; lon: number }) => void;
  /** When true, map clicks add waypoints instead of feature queries. */
  clickCapture?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const schemeRef = useRef(scheme);
  const onFeatureQueryRef = useRef(onFeatureQuery);
  const onMapClickRef = useRef(onMapClick);
  const onCursorMoveRef = useRef(onCursorMove);
  const clickCaptureRef = useRef(clickCapture);
  const ownShipRef = useRef(ownShip);
  const headingRef = useRef(headingDeg);
  const aisRef = useRef(aisTargets);
  const aisPopupRef = useRef<maplibregl.Popup | null>(null);
  const [status, setStatus] = useState("Harita yükleniyor…");
  const [error, setError] = useState<string | null>(null);
  const cfgRef = useRef<ChartConfig | null>(null);
  const cameraRef = useRef<{ center: [number, number]; zoom: number } | null>(null);

  useEffect(() => {
    onFeatureQueryRef.current = onFeatureQuery;
  }, [onFeatureQuery]);

  useEffect(() => {
    onCursorMoveRef.current = onCursorMove;
  }, [onCursorMove]);

  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  useEffect(() => {
    clickCaptureRef.current = clickCapture;
  }, [clickCapture]);

  useEffect(() => {
    ownShipRef.current = ownShip;
    headingRef.current = headingDeg;
    aisRef.current = aisTargets;
  }, [ownShip, headingDeg, aisTargets]);

  function pushOverlays(map: Map, s: ChartScheme) {
    ensureOwnShipIcon(map);
    ensureOwnShipLayers(map);
    ensureAisLayers(map, s);
    const ship = ownShipRef.current;
    const ownSrc = map.getSource("ownship") as maplibregl.GeoJSONSource | undefined;
    if (ship) {
      ownSrc?.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { heading: headingRef.current ?? 0 },
            geometry: { type: "Point", coordinates: [ship.lon, ship.lat] },
          },
        ],
      });
    }
    const aisSrc = map.getSource("ais") as maplibregl.GeoJSONSource | undefined;
    aisSrc?.setData({
      type: "FeatureCollection",
      features: toAisFeatures(aisRef.current),
    });
  }

  useEffect(() => {
    const onZoom = (e: Event) => {
      const map = mapRef.current;
      if (!map) return;
      const dir = (e as CustomEvent<number>).detail;
      map.zoomTo(map.getZoom() + dir, { duration: 200 });
    };
    const onCenter = (e: Event) => {
      const map = mapRef.current;
      if (!map) return;
      const d = (e as CustomEvent<{ lat: number; lon: number }>).detail;
      if (d?.lat == null || d?.lon == null) return;
      map.easeTo({ center: [d.lon, d.lat], duration: 450 });
    };
    window.addEventListener("irbis:map-zoom", onZoom as EventListener);
    window.addEventListener("irbis:map-center", onCenter as EventListener);
    return () => {
      window.removeEventListener("irbis:map-zoom", onZoom as EventListener);
      window.removeEventListener("irbis:map-center", onCenter as EventListener);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let map: Map | null = null;

    async function boot() {
      try {
        ensureMaplibreWorker();
        ensurePmtilesProtocol();
        const cfg = (await window.irbis?.getChartConfig()) as ChartConfig | undefined;
        if (!cfg) throw new Error("Chart config IPC yok (Electron preload)");
        if (cancelled || !containerRef.current) return;
        cfgRef.current = cfg;

        const { style, styleMeta } = await buildStyle(cfg, schemeRef.current);
        if (cancelled || !containerRef.current) return;

        const useWorld = reloadToken === 0;
        const saved = cameraRef.current;
        const center = saved
          ? saved.center
          : useWorld
            ? (cfg.worldCenter ?? ([-20, 10] as [number, number]))
            : cfg.center;
        const zoom = saved ? saved.zoom : useWorld ? (cfg.worldZoom ?? 1.25) : cfg.zoom;

        map = new maplibregl.Map({
          container: containerRef.current,
          style,
          center,
          zoom,
          maxPitch: 0,
          attributionControl: false,
          fadeDuration: 0,
        });
        mapRef.current = map;

        map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
        map.addControl(
          new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }),
          "top-right",
        );

        map.on("load", () => {
          if (!map) return;
          pushOverlays(map, schemeRef.current);
          const n = cfg.readyCells?.length ?? 0;
          const remapNote = styleMeta.remapped ? " · renk eşlemesi" : "";
          if (!cancelled) {
            if (cfg.mapMode === "navionics") {
              const tiles = cfg.navionics?.cache?.count;
              setStatus(
                `Navionics offline${tiles != null ? ` · ${tiles} karo` : ""} · ${schemeRef.current}${cfg.warning ? " · " + cfg.warning : ""}`,
              );
            } else if (cfg.bakeReady && n > 0) {
              setStatus(
                `S-57 · ${n} hücre · ${cfg.cellName} · ${schemeRef.current}${remapNote}${cfg.warning ? " · " + cfg.warning : ""}`,
              );
            } else if (cfg.warning) {
              setStatus(cfg.warning);
            } else if (useWorld && !saved) {
              setStatus(
                `S-57 · ${n} hücre · ${schemeRef.current}${remapNote} · dünya (OpenFreeMap + tile57)`,
              );
            } else {
              setStatus(`S-57 · ${cfg.cellName} · ${n} hücre · ${schemeRef.current}${remapNote}`);
            }
          }
        });

        const setAisCursor = (on: boolean) => {
          if (!map) return;
          map.getCanvas().style.cursor = on ? "pointer" : "";
        };
        map.on("mouseenter", "ais-ships", () => setAisCursor(true));
        map.on("mouseleave", "ais-ships", () => setAisCursor(false));
        map.on("mouseenter", "ais-halo", () => setAisCursor(true));
        map.on("mouseleave", "ais-halo", () => setAisCursor(false));

        map.on("click", (e) => {
          if (!map) return;
          if (clickCaptureRef.current) {
            aisPopupRef.current?.remove();
            onMapClickRef.current?.({ lat: e.lngLat.lat, lon: e.lngLat.lng });
            return;
          }

          const liveMap = map;
          const aisLayerIds = ["ais-ships", "ais-halo"].filter((id) => !!liveMap.getLayer(id));
          const aisHits = aisLayerIds.length
            ? liveMap.queryRenderedFeatures(e.point, { layers: aisLayerIds })
            : [];
          if (aisHits.length) {
            const hit = aisHits[0];
            const props = { ...(hit.properties ?? {}) } as Record<string, unknown>;
            const g = hit.geometry as { type?: string; coordinates?: number[] };
            const coords: [number, number] =
              g?.type === "Point" && g.coordinates
                ? [g.coordinates[0], g.coordinates[1]]
                : [e.lngLat.lng, e.lngLat.lat];
            aisPopupRef.current?.remove();
            aisPopupRef.current = new maplibregl.Popup({
              closeButton: true,
              closeOnClick: true,
              offset: 18,
              className: "ais-map-popup",
              maxWidth: "260px",
            })
              .setLngLat(coords)
              .setHTML(aisPopupHtml(props))
              .addTo(map);
            onFeatureQueryRef.current?.(null);
            return;
          }

          aisPopupRef.current?.remove();
          const layers = chartQueryLayerIds(map);
          if (layers.length === 0) {
            onFeatureQueryRef.current?.(null);
            return;
          }
          const feats = map.queryRenderedFeatures(e.point, { layers });
          if (!feats.length) {
            onFeatureQueryRef.current?.(null);
            return;
          }
          const f = feats[0];
          const props = { ...(f.properties ?? {}) } as Record<string, unknown>;
          onFeatureQueryRef.current?.({
            layerId: f.layer.id,
            sourceLayer: f.sourceLayer,
            properties: props,
          });
        });

        map.on("error", (e) => {
          console.warn("[irbis map]", e.error?.message ?? e);
        });
        map.on("move", () => {
          if (!map || !onMove) return;
          const c = map.getCenter();
          cameraRef.current = { center: [c.lng, c.lat], zoom: map.getZoom() };
          onMove({ lat: c.lat, lon: c.lng, zoom: map.getZoom() });
        });

        map.on("mousemove", (e) => {
          onCursorMoveRef.current?.({ lat: e.lngLat.lat, lon: e.lngLat.lng });
        });
        map.on("mouseout", () => {
          onCursorMoveRef.current?.(null);
        });

        const c = map.getCenter();
        onMove?.({ lat: c.lat, lon: c.lng, zoom: map.getZoom() });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(err);
        if (!cancelled) setError(msg);
      }
    }

    void boot();

    return () => {
      cancelled = true;
      if (map) {
        const c = map.getCenter();
        cameraRef.current = { center: [c.lng, c.lat], zoom: map.getZoom() };
      }
      map?.remove();
      mapRef.current = null;
    };
  }, [onMove, reloadToken]);

  // Live scheme switch without tearing down camera/cells.
  useEffect(() => {
    const map = mapRef.current;
    const cfg = cfgRef.current;
    if (!map || !cfg || schemeRef.current === scheme) {
      schemeRef.current = scheme;
      return;
    }
    schemeRef.current = scheme;
    let cancelled = false;

    async function applyScheme() {
      try {
        const { style, styleMeta } = await buildStyle(cfg!, scheme);
        if (cancelled || !mapRef.current) return;
        const m = mapRef.current;
        const c = m.getCenter();
        const z = m.getZoom();
        m.setStyle(style, { diff: false });
        m.once("style.load", () => {
          if (!mapRef.current) return;
          mapRef.current.jumpTo({ center: c, zoom: z });
          pushOverlays(mapRef.current, scheme);
          const n = cfg!.readyCells?.length ?? 0;
          const remapNote = styleMeta.remapped ? " · renk eşlemesi" : "";
          if (cfg!.warning && !cfg!.bakeReady) {
            setStatus(cfg!.warning);
          } else {
            setStatus(`S-57 · ${cfg!.cellName} · ${n} hücre · ${scheme}${remapNote}`);
          }
          setError(null);
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!cancelled) setError(msg);
      }
    }

    void applyScheme();
    return () => {
      cancelled = true;
    };
  }, [scheme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !ownShip) return;
    ensureOwnShipIcon(map);
    ensureOwnShipLayers(map);
    const src = map.getSource("ownship") as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { heading: headingDeg ?? 0 },
          geometry: { type: "Point", coordinates: [ownShip.lon, ownShip.lat] },
        },
      ],
    });
  }, [ownShip, headingDeg, scheme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    ensureAisLayers(map, scheme);
    const src = map.getSource("ais") as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: "FeatureCollection",
      features: toAisFeatures(aisTargets),
    });
    for (const id of ["ais-halo", "ais-ships", "ais-labels"]) {
      if (!map.getLayer(id)) continue;
      map.setLayoutProperty(id, "visibility", aisVisible ? "visible" : "none");
    }
  }, [aisTargets, scheme, aisVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    ensureRadarLayers(map);
    const show = radarVisible;
    const setVis = (id: string, on: boolean) => {
      if (!map.getLayer(id)) return;
      map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    };
    setVis("radar-ring", show);
    setVis("radar-info", show && radarInfo);
    setVis("radar-arpa", show && radarArpa);
    if (!ownShip) return;
    const src = map.getSource("radar") as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [ownShip.lon, ownShip.lat] },
        },
      ],
    });
  }, [radarVisible, radarInfo, radarArpa, ownShip, scheme]);

  return (
    <div className={`chart-map-root scheme-${scheme}`}>
      <div ref={containerRef} className="chart-map-canvas" />
      <div className="chart-watermark">{error ? `Hata: ${error}` : status}</div>
    </div>
  );
}

function ensureRadarLayers(map: Map) {
  if (!map.getSource("radar")) {
    map.addSource("radar", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getLayer("radar-ring")) {
    map.addLayer({
      id: "radar-ring",
      type: "circle",
      source: "radar",
      layout: { visibility: "none" },
      paint: {
        "circle-radius": 90,
        "circle-color": "rgba(34, 197, 94, 0.08)",
        "circle-stroke-width": 2,
        "circle-stroke-color": "rgba(34, 197, 94, 0.65)",
        "circle-pitch-alignment": "map",
      },
    });
  }
  if (!map.getLayer("radar-info")) {
    map.addLayer({
      id: "radar-info",
      type: "circle",
      source: "radar",
      layout: { visibility: "none" },
      paint: {
        "circle-radius": 55,
        "circle-color": "rgba(56, 189, 248, 0.06)",
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "rgba(56, 189, 248, 0.7)",
      },
    });
  }
  if (!map.getLayer("radar-arpa")) {
    map.addLayer({
      id: "radar-arpa",
      type: "circle",
      source: "radar",
      layout: { visibility: "none" },
      paint: {
        "circle-radius": 28,
        "circle-color": "rgba(251, 146, 60, 0.12)",
        "circle-stroke-width": 2,
        "circle-stroke-color": "rgba(251, 146, 60, 0.85)",
      },
    });
  }
}
