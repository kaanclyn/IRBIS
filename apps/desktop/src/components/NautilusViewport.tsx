import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { AisTarget } from "../hooks/useAis";
import {
  NAUTILUS_TILE,
  assertEquirectGrid,
  bboxIntersects,
  lat2tileY,
  lon2tileX,
  tileBBox,
  tileKey,
  tileX2lon,
  tileY2lat,
  viewBBoxFromCenter,
  visibleCoverageRatio,
  visibleTileRange,
  zoomForLonSpan,
  type GeoBBox,
} from "../chart/nautilusTiles";

type PickHit = {
  geo: { lat: number; lon: number };
  features: Array<{
    name?: string;
    primitive?: string;
    attributes?: Array<{ name: string; value: string; type?: string }>;
  }>;
  source?: string;
  note?: string;
};

/** Pan offset + CSS scale (= 2^(zoomFloat − renderedZ)). */
type Cam = { x: number; y: number; scale: number };

type TileEntry = {
  z: number;
  x: number;
  y: number;
  url: string;
  cacheHit?: boolean;
};

type LodJob = {
  id: number;
  targetZ: number;
  reason: string;
  centerLon: number;
  centerLat: number;
};

/** Gerçek karo tavanı; üstü CSS overzoom. */
const RENDER_MAX_Z = 18;
/** LOD commit için görünür kapsama eşiği (centerReady yetmez). */
const COVERAGE_COMMIT = 0.92;

function geoToPct(vp: GeoBBox, lon: number, lat: number) {
  const x = ((lon - vp.west) / (vp.east - vp.west)) * 100;
  const y = ((vp.north - lat) / (vp.north - vp.south)) * 100;
  return { x, y };
}

function wheelZoomFactor(e: WheelEvent) {
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 16;
  if (e.deltaMode === 2) dy *= 800;
  const zoomDelta = (-dy / 240) * (e.ctrlKey ? 1.6 : 1);
  return Math.pow(2, zoomDelta);
}

function chooseLOD(zoomFloat: number, renderedZ: number): number {
  let desired = Math.round(zoomFloat);
  desired = Math.max(0, Math.min(RENDER_MAX_Z, desired));
  if (desired > renderedZ && zoomFloat < renderedZ + 0.55) desired = renderedZ;
  if (desired < renderedZ && zoomFloat > renderedZ - 0.55) desired = renderedZ;
  if (desired > renderedZ + 1) desired = renderedZ + 1;
  if (desired < renderedZ - 1) desired = renderedZ - 1;
  return desired;
}

function tileSetHash(keys: string[]) {
  let h = keys.length;
  for (const k of keys) {
    for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

/**
 * Active/pending LOD modeli (P0):
 * - zoomFloat tek otorite; async yazamaz
 * - Ekranda yalnız activeLayer (tek Z) — z/z-1 karışımı yok → çift görüntü yok
 * - Yeni LOD pending’de; visibleCoverage yeterince dolunca atomik commit
 * - Karo kuyruğu cameraRevision’dan ayrı; wheel tile işini iptal etmez
 */
export function NautilusViewport({
  cellId,
  reloadToken = 0,
  ownShip,
  headingDeg,
  aisTargets,
  aisVisible = true,
  radarVisible = false,
  onCursorMove,
  onFeatureQuery,
}: {
  cellId?: string | null;
  reloadToken?: number;
  ownShip?: { lat: number; lon: number; stale?: boolean } | null;
  headingDeg?: number;
  aisTargets?: AisTarget[];
  aisVisible?: boolean;
  radarVisible?: boolean;
  onCursorMove?: (p: { lat: number; lon: number }) => void;
  onFeatureQuery?: (hit: {
    title: string;
    props: Record<string, unknown>;
    lat?: number;
    lon?: number;
  } | null) => void;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; moved: boolean; origin: Cam } | null>(null);

  const zoomFloatRef = useRef(10);
  const renderedZRef = useRef(10);
  const targetZRef = useRef(10);
  const centerRef = useRef<{ lon: number; lat: number } | null>(null);
  const cellExtentRef = useRef<GeoBBox | null>(null);
  const tileCacheRef = useRef<Map<string, TileEntry>>(new Map());
  /** Telemetri / niyet kimliği — tile iptali için KULLANILMAZ. */
  const cameraRevision = useRef(0);
  /** Yalnız hedef LOD değişince artar; aynı Z yüklemesi devam eder. */
  const lodJobId = useRef(0);
  const activeLodJob = useRef<LodJob | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(new Set<string>());
  const flightMap = useRef(new Map<string, Promise<TileEntry | null>>());
  const lastSettleSig = useRef("");
  const camRef = useRef<Cam>({ x: 0, y: 0, scale: 1 });
  const gridChecked = useRef(false);

  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [outOfCell, setOutOfCell] = useState(false);
  const [cellLabel, setCellLabel] = useState<string>("—");
  const [z, setZ] = useState(10);
  /** activeLayer — ekranda commit edilmiş tek LOD. */
  const [activeTiles, setActiveTiles] = useState<TileEntry[]>([]);
  const [cam, setCam] = useState<Cam>({ x: 0, y: 0, scale: 1 });
  const [pick, setPick] = useState<PickHit | null>(null);
  const [stats, setStats] = useState({
    hit: 0,
    miss: 0,
    lastMs: 0,
    coverage: 1,
    coverageRequest: 1,
    coverageLayout: 1,
    coverageEnc: 1,
  });
  const [centerTick, setCenterTick] = useState(0);
  const [zoomUi, setZoomUi] = useState(10);
  /** Karo debug: kırmızı çerçeve + z/x/y + getBoundingClientRect log */
  const [debugTiles, setDebugTiles] = useState(false);
  const tileImgRefs = useRef(new Map<string, HTMLImageElement>());

  const setCamBoth = (next: Cam) => {
    camRef.current = next;
    setCam(next);
  };

  const cssScaleOf = () => Math.pow(2, zoomFloatRef.current - renderedZRef.current);

  const stageSize = () => {
    const el = stageRef.current;
    if (!el) return { w: 1280, h: 720 };
    const r = el.getBoundingClientRect();
    return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
  };

  const currentViewBBox = useCallback((): GeoBBox | null => {
    const c = centerRef.current;
    if (!c) return null;
    const { w, h } = stageSize();
    return viewBBoxFromCenter(c.lon, c.lat, renderedZRef.current, w, h, camRef.current);
  }, []);

  /** Yalnız tek Z — parent LOD karıştırma (çift görüntü) yok. */
  const publishActive = useCallback((zKeep: number) => {
    const list = [...tileCacheRef.current.values()].filter((t) => t.z === zKeep);
    setActiveTiles(list);
  }, []);

  const bakePanIntoCenter = useCallback(() => {
    const center = centerRef.current;
    if (!center) return;
    const c = camRef.current;
    if (Math.abs(c.x) < 0.5 && Math.abs(c.y) < 0.5) return;
    const { w, h } = stageSize();
    const view = viewBBoxFromCenter(center.lon, center.lat, renderedZRef.current, w, h, c);
    centerRef.current = {
      lon: (view.west + view.east) / 2,
      lat: (view.north + view.south) / 2,
    };
    setCenterTick((n) => n + 1);
    setCamBoth({ x: 0, y: 0, scale: cssScaleOf() });
  }, []);

  const buildWanted = useCallback(
    (targetZ: number, view: GeoBBox, center: { lon: number; lat: number }) => {
      const margin = targetZ >= 15 ? 0 : 1;
      const range = visibleTileRange(view.west, view.east, view.south, view.north, targetZ, margin);
      const extent = cellExtentRef.current;
      const wanted: Array<{ z: number; x: number; y: number; key: string; dist: number }> = [];
      const tcx = Math.floor(lon2tileX(center.lon, targetZ));
      const tcy = Math.floor(lat2tileY(center.lat, targetZ));
      for (let x = range.x0; x <= range.x1; x++) {
        for (let y = range.y0; y <= range.y1; y++) {
          const bb = tileBBox(x, y, targetZ);
          if (extent && !bboxIntersects(bb, extent)) continue;
          wanted.push({
            z: targetZ,
            x,
            y,
            key: tileKey(targetZ, x, y),
            dist: Math.hypot(x - tcx, y - tcy),
          });
        }
      }
      wanted.sort((a, b) => a.dist - b.dist);
      return wanted;
    },
    []
  );

  const fetchTile = useCallback(
    (item: { z: number; x: number; y: number; key: string }): Promise<TileEntry | null> => {
      const existing = flightMap.current.get(item.key);
      if (existing) return existing;
      if (!window.irbis?.nautilusEnsureTile || !cellId) return Promise.resolve(null);
      const p = (async (): Promise<TileEntry | null> => {
        if (tileCacheRef.current.has(item.key)) {
          return tileCacheRef.current.get(item.key) || null;
        }
        if (inflight.current.has(item.key)) return null;
        inflight.current.add(item.key);
        try {
          const r = await window.irbis!.nautilusEnsureTile!({
            cellId: cellId || undefined,
            size: NAUTILUS_TILE,
            bbox: tileBBox(item.x, item.y, item.z),
            z: item.z,
            x: item.x,
            y: item.y,
          });
          if (!r?.url) return null;
          const entry: TileEntry = {
            z: item.z,
            x: item.x,
            y: item.y,
            url: r.url,
            cacheHit: !!r.cacheHit,
          };
          tileCacheRef.current.set(item.key, entry);
          if (tileCacheRef.current.size > 400) {
            const rz = renderedZRef.current;
            const tz = targetZRef.current;
            for (const [k, v] of tileCacheRef.current) {
              if (v.z < Math.min(rz, tz) - 1 || v.z > Math.max(rz, tz) + 1) {
                tileCacheRef.current.delete(k);
              }
            }
          }
          return entry;
        } catch (e) {
          console.warn("[nautilus] tile fail", item.key, e);
          return null;
        } finally {
          inflight.current.delete(item.key);
          flightMap.current.delete(item.key);
        }
      })();
      flightMap.current.set(item.key, p);
      return p;
    },
    [cellId]
  );

  /**
   * Karo yaşam döngüsü — cameraRevision değişince iptal YOK.
   * Yalnız yeni lodJob (farklı targetZ) eski işi bırakır; cache yazımı sürer.
   */
  const runLodJob = useCallback(
    async (job: LodJob): Promise<{
      cancelled: boolean;
      coverage: number;
      hit: number;
      miss: number;
      wanted: number;
      wantedKeys: string[];
      outOfCell: boolean;
    }> => {
      const center = centerRef.current;
      if (!center || !window.irbis?.nautilusEnsureTile || !cellId) {
        return {
          cancelled: true,
          coverage: 0,
          hit: 0,
          miss: 0,
          wanted: 0,
          wantedKeys: [],
          outOfCell: false,
        };
      }
      const { w, h } = stageSize();
      const view = viewBBoxFromCenter(center.lon, center.lat, renderedZRef.current, w, h, camRef.current);
      const wanted = buildWanted(job.targetZ, view, center);
      const hash = tileSetHash(wanted.map((t) => t.key));

      if (wanted.length === 0) {
        // eslint-disable-next-line no-console
        console.info(
          `[nautilus] TILE_REQUEST job=${job.id} z=${job.targetZ} n=0 outOfCell=Y · ${job.reason}`
        );
        return {
          cancelled: false,
          coverage: 1,
          hit: 0,
          miss: 0,
          wanted: 0,
          wantedKeys: [],
          outOfCell: true,
        };
      }

      // eslint-disable-next-line no-console
      console.info(
        `[nautilus] TILE_REQUEST job=${job.id} camRev=${cameraRevision.current} z=${job.targetZ} n=${wanted.length} hash=${hash} · ${job.reason}`
      );

      const wantedKeys = wanted.map((t) => t.key);
      const missing = wanted.filter((t) => !tileCacheRef.current.has(t.key));
      if (missing.length === 0) {
        const coverage = 1;
        setStats((s) => ({
          ...s,
          hit: wanted.length,
          miss: 0,
          lastMs: 0,
          coverage,
          coverageRequest: coverage,
        }));
        if (job.targetZ === renderedZRef.current) publishActive(job.targetZ);
        // eslint-disable-next-line no-console
        console.info(
          `[nautilus] TILES z=${job.targetZ} n=${wanted.length} hit=${wanted.length} miss=0 coverageRequest=1.00 · ${job.reason} (noop reason=all-cached)`
        );
        return {
          cancelled: false,
          coverage,
          hit: wanted.length,
          miss: 0,
          wanted: wanted.length,
          wantedKeys,
          outOfCell: false,
        };
      }

      setBusy(true);
      let hit = wanted.length - missing.length;
      let miss = 0;
      let lastMs = 0;

      for (const item of missing) {
        // Yalnız LOD job değiştiyse bırak (cameraRevision değil!)
        if (activeLodJob.current?.id !== job.id) {
          // eslint-disable-next-line no-console
          console.info(
            `[nautilus] SCHED cancel job=${job.id} cur=${activeLodJob.current?.id ?? "-"} cancelReason=lod-superseded · ${job.reason}`
          );
          return {
            cancelled: true,
            coverage: visibleCoverageRatio(wantedKeys, (k) => tileCacheRef.current.has(k)),
            hit,
            miss,
            wanted: wanted.length,
            wantedKeys,
            outOfCell: false,
          };
        }
        const t0 = performance.now();
        const entry = await fetchTile(item);
        lastMs = Math.round(performance.now() - t0);
        if (entry) {
          if (entry.cacheHit) hit += 1;
          else miss += 1;
        }
        if (job.targetZ === renderedZRef.current && activeLodJob.current?.id === job.id) {
          publishActive(job.targetZ);
        }
      }

      const coverage = visibleCoverageRatio(wantedKeys, (k) => tileCacheRef.current.has(k));
      setStats((s) => ({
        ...s,
        hit,
        miss,
        lastMs,
        coverage,
        coverageRequest: coverage,
      }));
      setBusy(false);
      // eslint-disable-next-line no-console
      console.info(
        `[nautilus] TILES z=${job.targetZ} n=${wanted.length} hit=${hit} miss=${miss} coverageRequest=${coverage.toFixed(2)} queueDepth=${flightMap.current.size} · ${job.reason}`
      );
      return {
        cancelled: false,
        coverage,
        hit,
        miss,
        wanted: wanted.length,
        wantedKeys,
        outOfCell: false,
      };
    },
    [buildWanted, cellId, fetchTile, publishActive]
  );

  /**
   * Yüksek z’de absolute `x*256` (~4.5e7 px) GPU float32’de sütunları üst üste yığar
   * (tek ~215px şerit). Göreli origin ile layout self-test.
   */
  const layoutColumnHealth = useCallback(
    (tiles: TileEntry[], targetZ: number, center: { lon: number; lat: number }, scale: number) => {
      const originX = Math.floor(lon2tileX(center.lon, targetZ));
      const originY = Math.floor(lat2tileY(center.lat, targetZ));
      const localCx = (lon2tileX(center.lon, targetZ) - originX) * NAUTILUS_TILE;
      const { w } = stageSize();
      const xsRel = new Set<number>();
      const xsAbsF32 = new Set<number>();
      for (const t of tiles) {
        const rel = (t.x - originX) * NAUTILUS_TILE;
        const screenRel = Math.round((w / 2 - localCx + rel) * scale);
        xsRel.add(screenRel);
        // Eski absolute yolun float32 simülasyonu (teşhis)
        const absLeft = Math.fround(t.x * NAUTILUS_TILE);
        const absWorld = Math.fround(w / 2 - Math.fround(lon2tileX(center.lon, targetZ) * NAUTILUS_TILE));
        xsAbsF32.add(Math.round(Math.fround((absWorld + absLeft) * scale)));
      }
      const expectCols = new Set(tiles.map((t) => t.x)).size;
      return {
        expectCols,
        relCols: xsRel.size,
        absF32Cols: xsAbsF32.size,
        originX,
        originY,
        ok: xsRel.size >= Math.max(1, expectCols - 1),
      };
    },
    []
  );

  const commitLod = useCallback(
    (
      targetZ: number,
      jobId: number,
      coverageRequest: number,
      reason: string,
      wantedKeys: string[]
    ) => {
      if (activeLodJob.current?.id !== jobId) {
        // eslint-disable-next-line no-console
        console.info(`[nautilus] LOD_COMMIT skipped-stale job=${jobId}`);
        return false;
      }
      const want = chooseLOD(zoomFloatRef.current, renderedZRef.current);
      if (want !== targetZ && Math.round(zoomFloatRef.current) !== targetZ) {
        // eslint-disable-next-line no-console
        console.info(
          `[nautilus] LOD_COMMIT skipped-intent job=${jobId} want=${want} target=${targetZ} zFloat=${zoomFloatRef.current.toFixed(3)}`
        );
        return false;
      }
      if (coverageRequest < COVERAGE_COMMIT) {
        // eslint-disable-next-line no-console
        console.info(
          `[nautilus] LOD_COMMIT deferred coverageRequest=${coverageRequest.toFixed(2)} < ${COVERAGE_COMMIT} z=${targetZ}`
        );
        return false;
      }

      const center = centerRef.current;
      if (!center) return false;
      const tiles = wantedKeys
        .map((k) => tileCacheRef.current.get(k))
        .filter((t): t is TileEntry => !!t && t.z === targetZ);
      const zFloatBefore = zoomFloatRef.current;
      const scale = Math.min(32, Math.max(0.25, Math.pow(2, zFloatBefore - targetZ)));
      const layout = layoutColumnHealth(tiles, targetZ, center, scale);

      // ENC kapsam örtüşmesi (veri yok ≠ render hatası)
      const extent = cellExtentRef.current;
      const { w, h } = stageSize();
      const view = viewBBoxFromCenter(center.lon, center.lat, targetZ, w, h, {
        x: 0,
        y: 0,
        scale,
      });
      let coverageEnc = 1;
      if (extent) {
        const overlapW = Math.max(0, Math.min(view.east, extent.east) - Math.max(view.west, extent.west));
        const overlapH = Math.max(0, Math.min(view.north, extent.north) - Math.max(view.south, extent.south));
        const viewArea = Math.max(1e-18, (view.east - view.west) * (view.north - view.south));
        coverageEnc = (overlapW * overlapH) / viewArea;
      }
      const coverageLayout = layout.expectCols > 0 ? layout.relCols / layout.expectCols : 1;

      // eslint-disable-next-line no-console
      console.info(
        `[nautilus] COVERAGE request=${coverageRequest.toFixed(2)} layout=${coverageLayout.toFixed(2)} (relCols=${layout.relCols}/${layout.expectCols} absF32Cols=${layout.absF32Cols}) enc=${coverageEnc.toFixed(2)} origin=${layout.originX},${layout.originY}`
      );

      if (!layout.ok) {
        // eslint-disable-next-line no-console
        console.info(
          `[nautilus] LOD_COMMIT blocked-layout job=${jobId} relCols=${layout.relCols} expect=${layout.expectCols} absF32Cols=${layout.absF32Cols} — absolute px precision?`
        );
        return false;
      }

      const fromZ = renderedZRef.current;
      renderedZRef.current = targetZ;
      targetZRef.current = targetZ;
      setZ(targetZ);
      setCamBoth({ x: 0, y: 0, scale });
      publishActive(targetZ);
      setStats((s) => ({
        ...s,
        coverage: coverageRequest,
        coverageRequest,
        coverageLayout,
        coverageEnc,
      }));
      const zFloatAfter = zoomFloatRef.current;
      // eslint-disable-next-line no-console
      console.info(
        `[nautilus] LOD_COMMIT job=${jobId} camRev=${cameraRevision.current} from=${fromZ} to=${targetZ} zFloatBefore=${zFloatBefore.toFixed(3)} zFloatAfter=${zFloatAfter.toFixed(3)} cssScale=${scale.toFixed(3)} coverageRequest=${coverageRequest.toFixed(2)} coverageLayout=${coverageLayout.toFixed(2)} coverageEnc=${coverageEnc.toFixed(2)} · ${reason}`
      );
      return true;
    },
    [layoutColumnHealth, publishActive]
  );

  const startLodJob = useCallback(
    (targetZ: number, reason: string) => {
      const center = centerRef.current;
      if (!center) return;
      targetZRef.current = targetZ;
      const cur = activeLodJob.current;
      if (cur?.targetZ === targetZ) {
        const step = 360 / 2 ** targetZ;
        const near =
          Math.abs(cur.centerLon - center.lon) < step * 0.4 &&
          Math.abs(cur.centerLat - center.lat) < step * 0.4;
        if (near) {
          // eslint-disable-next-line no-console
          console.info(`[nautilus] LOD job reuse z=${targetZ} job=${cur.id}`);
          return;
        }
      }
      const id = ++lodJobId.current;
      const job: LodJob = {
        id,
        targetZ,
        reason,
        centerLon: center.lon,
        centerLat: center.lat,
      };
      activeLodJob.current = job;

      void (async () => {
        const result = await runLodJob(job);
        if (activeLodJob.current?.id !== job.id) return;
        if (result.cancelled) {
          setBusy(false);
          return;
        }
        setOutOfCell(result.outOfCell);
        if (result.outOfCell) {
          activeLodJob.current = null;
          setBusy(false);
          return;
        }
        if (targetZ === renderedZRef.current) {
          publishActive(targetZ);
          activeLodJob.current = null;
          setBusy(false);
          return;
        }
        const ok = commitLod(targetZ, job.id, result.coverage, reason, result.wantedKeys);
        if (!ok) {
          // eslint-disable-next-line no-console
          console.info(
            `[nautilus] pendingLayer keep activeZ=${renderedZRef.current} pendingZ=${targetZ} coverageRequest=${result.coverage.toFixed(2)}`
          );
        }
        // Job bitti — sonraki settle yeniden başlatabilir
        if (activeLodJob.current?.id === job.id) activeLodJob.current = null;
        setBusy(false);
      })();
    },
    [commitLod, publishActive, runLodJob]
  );

  const scheduleSettle = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    const zoomingNow =
      Math.abs(zoomFloatRef.current - renderedZRef.current) > 0.05 ||
      Math.abs(camRef.current.x) > 2 ||
      Math.abs(camRef.current.y) > 2;
    settleTimer.current = setTimeout(() => {
      const center = centerRef.current;
      if (!center) return;
      const c = camRef.current;
      const limX = NAUTILUS_TILE * 0.85;
      const limY = NAUTILUS_TILE * 0.85;
      if (
        Math.abs(zoomFloatRef.current - renderedZRef.current) < 0.05 &&
        Math.abs(c.scale - 1) < 0.05 &&
        Math.abs(c.x) <= limX &&
        Math.abs(c.y) <= limY
      ) {
        // eslint-disable-next-line no-console
        console.info(
          `[nautilus] TILE skip · cam=${c.x.toFixed(0)},${c.y.toFixed(0)} lim±${limX.toFixed(0)}`
        );
        return;
      }

      bakePanIntoCenter();
      const zFloat = zoomFloatRef.current;
      const renderedZ = renderedZRef.current;
      const desiredZ = Math.max(0, Math.min(22, Math.round(zFloat)));
      const targetZ = chooseLOD(zFloat, renderedZ);
      const { w, h } = stageSize();
      const view = viewBBoxFromCenter(
        centerRef.current!.lon,
        centerRef.current!.lat,
        renderedZRef.current,
        w,
        h,
        camRef.current
      );
      const sig = `${zFloat.toFixed(3)}|${renderedZ}|${targetZ}|${centerRef.current!.lon.toFixed(5)}|${centerRef.current!.lat.toFixed(5)}`;
      if (sig === lastSettleSig.current && targetZ === renderedZ) {
        // eslint-disable-next-line no-console
        console.info(`[nautilus] ZOOM settle dedupe sig=${sig}`);
        return;
      }
      lastSettleSig.current = sig;

      // eslint-disable-next-line no-console
      console.info(
        `[nautilus] CAMERA event=settle camRev=${cameraRevision.current} zFloat=${zFloat.toFixed(3)} renderedZ=${renderedZ} targetZ=${targetZ} desiredZ=${desiredZ} cssScale=${camRef.current.scale.toFixed(3)} centerLon=${centerRef.current!.lon.toFixed(5)} centerLat=${centerRef.current!.lat.toFixed(5)} bboxWSES=${view.west.toFixed(5)},${view.south.toFixed(5)},${view.east.toFixed(5)},${view.north.toFixed(5)}`
      );

      // Scale senkron (zoomFloat otorite)
      setCamBoth({ x: 0, y: 0, scale: cssScaleOf() });
      startLodJob(targetZ, `settle→z${targetZ}`);
    }, zoomingNow ? 380 : 180);
  }, [bakePanIntoCenter, startLodJob]);

  const runFit = useCallback(async () => {
    if (!cellId || !window.irbis?.nautilusSetViewport) return;
    setBusy(true);
    setErr(null);
    setOutOfCell(false);
    tileCacheRef.current.clear();
    flightMap.current.clear();
    setActiveTiles([]);
    cameraRevision.current += 1;
    lodJobId.current += 1;
    activeLodJob.current = null;
    try {
      if (!gridChecked.current) {
        gridChecked.current = true;
        const g = assertEquirectGrid(10);
        // eslint-disable-next-line no-console
        console.info(`[nautilus] GRID_CHECK ok=${g.ok} errors=${g.errors.join("|") || "none"}`);
      }
      const { w, h } = stageSize();
      const r = await window.irbis.nautilusSetViewport({
        cellId,
        width: Math.round(w),
        height: Math.round(h),
        dpi: 96,
        action: "fit",
        overscan: false,
      });
      const vp = r.viewport;
      if (!vp) throw new Error("fit viewport yok");
      cellExtentRef.current = {
        west: vp.west,
        east: vp.east,
        north: vp.north,
        south: vp.south,
      };
      centerRef.current = {
        lon: (vp.west + vp.east) / 2,
        lat: (vp.north + vp.south) / 2,
      };
      setCenterTick((n) => n + 1);
      setCellLabel(r.cellId || cellId);
      const zz = zoomForLonSpan(vp.east - vp.west, w);
      zoomFloatRef.current = zz;
      renderedZRef.current = zz;
      targetZRef.current = zz;
      setZ(zz);
      setZoomUi(zz);
      setCamBoth({ x: 0, y: 0, scale: 1 });
      lastSettleSig.current = "";
      const id = ++lodJobId.current;
      const job: LodJob = {
        id,
        targetZ: zz,
        reason: "fit",
        centerLon: centerRef.current!.lon,
        centerLat: centerRef.current!.lat,
      };
      activeLodJob.current = job;
      const result = await runLodJob(job);
      if (activeLodJob.current?.id === job.id && !result.cancelled) {
        publishActive(zz);
        setOutOfCell(result.outOfCell);
      }
      if (activeLodJob.current?.id === job.id) activeLodJob.current = null;
      setBusy(false);
    } catch (e) {
      setErr(String((e as { message?: string })?.message || e));
      setBusy(false);
    }
  }, [cellId, publishActive, runLodJob]);

  const fitOnceKey = `${cellId || ""}:${reloadToken}`;
  const lastFitKey = useRef("");
  useEffect(() => {
    if (lastFitKey.current === fitOnceKey) return;
    lastFitKey.current = fitOnceKey;
    void runFit();
    return () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitOnceKey]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!centerRef.current) return;
      // cameraRevision = telemetri; tile job İPTAL EDİLMEZ
      cameraRevision.current += 1;
      const factor = wheelZoomFactor(e);
      const sr = el.getBoundingClientRect();
      const mx = e.clientX - sr.left;
      const my = e.clientY - sr.top;
      const c = camRef.current;
      const oldScale = Math.max(0.25, c.scale);
      const nextZf = Math.min(RENDER_MAX_Z + 4, Math.max(0, zoomFloatRef.current + Math.log2(factor)));
      if (Math.abs(nextZf - zoomFloatRef.current) < 1e-6) return;
      zoomFloatRef.current = nextZf;
      setZoomUi(nextZf);
      const nextScale = Math.min(32, Math.max(0.25, Math.pow(2, nextZf - renderedZRef.current)));
      const cx = sr.width / 2;
      const cy = sr.height / 2;
      const ratio = nextScale / oldScale;
      setCamBoth({
        x: c.x + (mx - cx) * (1 - ratio),
        y: c.y + (my - cy) * (1 - ratio),
        scale: nextScale,
      });
      // eslint-disable-next-line no-console
      console.info(
        `[nautilus] CAMERA event=wheel camRev=${cameraRevision.current} zFloat=${nextZf.toFixed(3)} renderedZ=${renderedZRef.current} targetZ=${targetZRef.current} desiredZ=${Math.round(nextZf)} cssScale=${nextScale.toFixed(3)} Δy=${e.deltaY.toFixed(1)}`
      );
      scheduleSettle();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scheduleSettle]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = { w: 0, h: 0 };
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const { w, h } = stageSize();
        if (Math.abs(w - last.w) < 16 && Math.abs(h - last.h) < 16) return;
        last = { w, h };
        cameraRevision.current += 1;
        // eslint-disable-next-line no-console
        console.info(
          `[nautilus] CAMERA event=resize camRev=${cameraRevision.current} zFloat=${zoomFloatRef.current.toFixed(3)} renderedZ=${renderedZRef.current}`
        );
        startLodJob(renderedZRef.current, "resize");
      }, 280);
    });
    ro.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      ro.disconnect();
    };
  }, [startLodJob]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      moved: false,
      origin: { ...camRef.current },
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const view = currentViewBBox();
    if (view && onCursorMove && stageRef.current && centerRef.current) {
      const sr = stageRef.current.getBoundingClientRect();
      const c = camRef.current;
      const z0 = renderedZRef.current;
      const center = centerRef.current;
      const scale = Math.max(0.25, c.scale);
      const cx = lon2tileX(center.lon, z0) * NAUTILUS_TILE;
      const cy = lat2tileY(center.lat, z0) * NAUTILUS_TILE;
      const lx = (e.clientX - sr.left - sr.width / 2 - c.x) / scale + cx;
      const ly = (e.clientY - sr.top - sr.height / 2 - c.y) / scale + cy;
      onCursorMove({
        lon: tileX2lon(lx / NAUTILUS_TILE, z0),
        lat: tileY2lat(ly / NAUTILUS_TILE, z0),
      });
    }
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 2) drag.moved = true;
    if (drag.moved) {
      setCamBoth({
        x: drag.origin.x + dx,
        y: drag.origin.y + dy,
        scale: drag.origin.scale,
      });
    }
  };

  const onPointerUp = async (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.moved) {
      cameraRevision.current += 1;
      // eslint-disable-next-line no-console
      console.info(
        `[nautilus] CAMERA event=pan camRev=${cameraRevision.current} zFloat=${zoomFloatRef.current.toFixed(3)} renderedZ=${renderedZRef.current} centerLon=${centerRef.current?.lon.toFixed(5)} centerLat=${centerRef.current?.lat.toFixed(5)}`
      );
      scheduleSettle();
      return;
    }
    const view = currentViewBBox();
    const center = centerRef.current;
    if (!view || !center || !stageRef.current || !window.irbis?.nautilusPick) return;
    const sr = stageRef.current.getBoundingClientRect();
    const c = camRef.current;
    const z0 = renderedZRef.current;
    const scale = Math.max(0.25, c.scale);
    const cx = lon2tileX(center.lon, z0) * NAUTILUS_TILE;
    const cy = lat2tileY(center.lat, z0) * NAUTILUS_TILE;
    const lx = (e.clientX - sr.left - sr.width / 2 - c.x) / scale + cx;
    const ly = (e.clientY - sr.top - sr.height / 2 - c.y) / scale + cy;
    const lon = tileX2lon(lx / NAUTILUS_TILE, z0);
    const lat = tileY2lat(ly / NAUTILUS_TILE, z0);
    const px = ((lon - view.west) / (view.east - view.west)) * sr.width;
    const py = ((view.north - lat) / (view.north - view.south)) * sr.height;
    try {
      const hit = (await window.irbis.nautilusPick({
        cellId: cellId || undefined,
        width: Math.round(sr.width),
        height: Math.round(sr.height),
        x: px,
        y: py,
        viewport: view,
      })) as PickHit;
      setPick(hit);
      const first = hit.features?.[0];
      const props: Record<string, unknown> = {
        // Explicit order — lat/lon karışıklığını log’da ayırt etmek için
        pickLat: hit.geo?.lat,
        pickLon: hit.geo?.lon,
        cursorLat: lat,
        cursorLon: lon,
      };
      if (first?.attributes) for (const a of first.attributes) props[a.name] = a.value;
      if (first?.primitive) props.primitive = first.primitive;
      if (hit.source) props.source = hit.source;
      onFeatureQuery?.({
        title: first?.name || "Pick",
        props,
        lat: hit.geo?.lat ?? lat,
        lon: hit.geo?.lon ?? lon,
      });
    } catch (error) {
      setErr(String((error as { message?: string })?.message || error));
    }
  };

  const viewForMarkers = currentViewBBox();

  const markers = useMemo(() => {
    const vp = viewForMarkers;
    if (!vp) return [] as Array<{ key: string; kind: "ais" | "own" | "radar"; x: number; y: number; label?: string; rot?: number }>;
    const out: Array<{ key: string; kind: "ais" | "own" | "radar"; x: number; y: number; label?: string; rot?: number }> = [];
    if (aisVisible && aisTargets) {
      for (const t of aisTargets) {
        if (!Number.isFinite(t.lat) || !Number.isFinite(t.lon)) continue;
        const p = geoToPct(vp, t.lon, t.lat);
        if (p.x < -8 || p.x > 108 || p.y < -8 || p.y > 108) continue;
        out.push({
          key: `ais-${t.mmsi}`,
          kind: "ais",
          x: p.x,
          y: p.y,
          label: t.name || String(t.mmsi),
          rot: t.headingDeg ?? t.cogDeg,
        });
      }
    }
    if (ownShip && Number.isFinite(ownShip.lat) && Number.isFinite(ownShip.lon)) {
      const p = geoToPct(vp, ownShip.lon, ownShip.lat);
      out.push({ key: "own", kind: "own", x: p.x, y: p.y, label: "OWN", rot: headingDeg });
      if (radarVisible) out.push({ key: "radar", kind: "radar", x: p.x, y: p.y });
    }
    return out;
  }, [aisTargets, aisVisible, headingDeg, ownShip, radarVisible, viewForMarkers]);

  const { w: stageW, h: stageH } = stageSize();
  const center = centerRef.current;
  void centerTick;
  /**
   * P0 fix: göreli karo origin (merkez tile). Absolute x*256 @ z18 ≈ 4.5e7 px
   * GPU float32’de sütunları tek şeride yığırdı (cssScale≈0.84 → ~215px).
   */
  const originX = center ? Math.floor(lon2tileX(center.lon, z)) : 0;
  const originY = center ? Math.floor(lat2tileY(center.lat, z)) : 0;
  const localCx = center ? (lon2tileX(center.lon, z) - originX) * NAUTILUS_TILE : 0;
  const localCy = center ? (lat2tileY(center.lat, z) - originY) * NAUTILUS_TILE : 0;

  // Debug: her commit/paint sonrası gerçek DOM X sütunlarını doğrula
  useEffect(() => {
    if (!debugTiles || activeTiles.length === 0) return;
    const id = requestAnimationFrame(() => {
      const xs = new Set<number>();
      const ys = new Set<number>();
      const rows: string[] = [];
      for (const t of activeTiles) {
        const key = tileKey(t.z, t.x, t.y);
        const el = tileImgRefs.current.get(key);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        xs.add(Math.round(r.left));
        ys.add(Math.round(r.top));
        rows.push(
          `${key} left=${r.left.toFixed(1)} top=${r.top.toFixed(1)} w=${r.width.toFixed(1)} h=${r.height.toFixed(1)}`
        );
      }
      // eslint-disable-next-line no-console
      console.info(
        `[nautilus] LAYOUT_AUDIT uniqueX=${xs.size} uniqueY=${ys.size} n=${activeTiles.length} expectX≈${new Set(activeTiles.map((t) => t.x)).size} xs=[${[...xs].sort((a, b) => a - b).join(",")}]`
      );
      for (const line of rows) {
        // eslint-disable-next-line no-console
        console.info(`[nautilus] TILE_RECT ${line}`);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [debugTiles, activeTiles, cam, z, centerTick]);

  const chromeRight = `${cellLabel} · z${z} · f${zoomUi.toFixed(2)} · req${(stats.coverageRequest * 100).toFixed(0)}% lay${(stats.coverageLayout * 100).toFixed(0)}% enc${(stats.coverageEnc * 100).toFixed(0)}% · ${activeTiles.length} karo · hit ${stats.hit}/miss ${stats.miss}${busy ? " · …" : ""}${outOfCell ? " · ENC dışı" : ""} · ×${cam.scale.toFixed(2)}`;

  return (
    <div className="nautilus-viewport">
      <div className="nautilus-viewport-chrome">
        <strong>Nautilus ENC</strong>
        <span>{chromeRight}</span>
        <div className="nautilus-viewport-actions">
          <button
            type="button"
            className={debugTiles ? "is-active" : undefined}
            onClick={() => setDebugTiles((v) => !v)}
            title="Karo debug: kırmızı çerçeve + RECT log"
          >
            Debug
          </button>
          <button type="button" disabled={busy && activeTiles.length === 0} onClick={() => void runFit()}>
            Fit
          </button>
        </div>
      </div>
      <div
        className="nautilus-viewport-stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => void onPointerUp(e)}
      >
        {err && activeTiles.length === 0 ? (
          <div className="nautilus-viewport-empty error">{err}</div>
        ) : (
          <>
            <div
              className="nautilus-tile-cam"
              style={{
                transform: `translate3d(${cam.x}px, ${cam.y}px, 0) scale(${cam.scale})`,
              }}
            >
              <div
                className="nautilus-tile-world"
                style={{
                  left: stageW / 2 - localCx,
                  top: stageH / 2 - localCy,
                }}
              >
                {activeTiles.map((t) => {
                  const key = tileKey(t.z, t.x, t.y);
                  return (
                    <div
                      key={key}
                      className={debugTiles ? "nautilus-tile-slot is-debug" : "nautilus-tile-slot"}
                      style={{
                        left: (t.x - originX) * NAUTILUS_TILE,
                        top: (t.y - originY) * NAUTILUS_TILE,
                        width: NAUTILUS_TILE,
                        height: NAUTILUS_TILE,
                      }}
                    >
                      <img
                        ref={(el) => {
                          if (el) tileImgRefs.current.set(key, el);
                          else tileImgRefs.current.delete(key);
                        }}
                        className="nautilus-tile-img"
                        src={t.url}
                        alt=""
                        draggable={false}
                        decoding="async"
                      />
                      {debugTiles ? (
                        <span className="nautilus-tile-debug-label">
                          {t.z}/{t.x}/{t.y}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
            {outOfCell ? (
              <div className="nautilus-viewport-empty" style={{ pointerEvents: "none", background: "transparent" }}>
                ENC hücre kapsamı dışı
              </div>
            ) : null}
            <div className="nautilus-overlay nautilus-overlay-screen">
              {markers.map((m) =>
                m.kind === "radar" ? (
                  <div key={m.key} className="nautilus-radar-ring" style={{ left: `${m.x}%`, top: `${m.y}%` }} />
                ) : (
                  <div
                    key={m.key}
                    className={`nautilus-marker nautilus-marker-${m.kind}`}
                    style={{
                      left: `${m.x}%`,
                      top: `${m.y}%`,
                      transform: `translate(-50%, -50%) rotate(${Number.isFinite(m.rot) ? m.rot : 0}deg)`,
                    }}
                    title={m.label}
                  >
                    <span className="nautilus-marker-glyph" />
                    {m.kind === "ais" ? <em>{m.label}</em> : null}
                  </div>
                )
              )}
              {pick && viewForMarkers ? (
                <div
                  className="nautilus-pick-dot"
                  style={{
                    left: `${geoToPct(viewForMarkers, pick.geo.lon, pick.geo.lat).x}%`,
                    top: `${geoToPct(viewForMarkers, pick.geo.lon, pick.geo.lat).y}%`,
                  }}
                />
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
