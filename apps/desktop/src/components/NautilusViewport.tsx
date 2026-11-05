import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { AisTarget } from "../hooks/useAis";

type GeoBBox = { north: number; south: number; west: number; east: number };

type RenderInfo = {
  url: string;
  cellId: string;
  bytes: number;
  viewport: GeoBBox | null;
  width: number;
  height: number;
  ms?: number;
  drawMs?: number | null;
  renderMode?: string;
  rev?: number;
};

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

type Cam = { x: number; y: number; scale: number };

function geoToPct(vp: GeoBBox, lon: number, lat: number) {
  const x = ((lon - vp.west) / (vp.east - vp.west)) * 100;
  const y = ((vp.north - lat) / (vp.north - vp.south)) * 100;
  return { x, y };
}

function stagePixelSize(el: HTMLElement | null) {
  if (!el) return { width: 1280, height: 720 };
  const r = el.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
  return {
    width: Math.max(640, Math.min(1920, Math.round(r.width * dpr))),
    height: Math.max(360, Math.min(1080, Math.round(r.height * dpr))),
  };
}

/** MapLibre-benzeri tekerlek → sürekli ölçek (atlama yok). */
function wheelZoomFactor(e: WheelEvent) {
  let dy = e.deltaY;
  if (e.deltaMode === 1) dy *= 16; // lines
  if (e.deltaMode === 2) dy *= 800; // pages
  // ~ MapLibre scrollZoom hissi: küçük delta = pürüzsüz
  const zoomDelta = (-dy / 240) * (e.ctrlKey ? 1.6 : 1);
  return Math.pow(2, zoomDelta);
}

function preload(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("frame load failed"));
    img.src = url;
  });
}

/**
 * Navionics hissi: CSS ile sürekli pan/zoom; settle’da yeni frame
 * decode edilene kadar eski görüntü + transform kalır → atlama yok.
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
  const camRef = useRef<Cam>({ x: 0, y: 0, scale: 1 });
  const baseVpRef = useRef<GeoBBox | null>(null);
  const infoRef = useRef<RenderInfo | null>(null);
  const sizeRef = useRef({ width: 1280, height: 720 });
  const loadSeq = useRef(0);
  /** Her pan/zoom jesti — render ortasında cam değişirse commit iptal */
  const gestureGen = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<RenderInfo | null>(null);
  const [pick, setPick] = useState<PickHit | null>(null);
  const [cam, setCam] = useState<Cam>({ x: 0, y: 0, scale: 1 });

  const setCamBoth = (next: Cam) => {
    camRef.current = next;
    setCam(next);
  };

  const viewCenter = useCallback((): { lon: number; lat: number } | null => {
    const vp = baseVpRef.current;
    const inf = infoRef.current;
    const stage = stageRef.current;
    if (!vp || !inf || !stage) return null;
    const c = camRef.current;
    const sr = stage.getBoundingClientRect();
    const lx = -c.x / c.scale + sr.width / 2;
    const ly = -c.y / c.scale + sr.height / 2;
    const px = (lx / sr.width) * inf.width;
    const py = (ly / sr.height) * inf.height;
    return {
      lon: vp.west + (px / inf.width) * (vp.east - vp.west),
      lat: vp.north - (py / inf.height) * (vp.north - vp.south),
    };
  }, []);

  /** CSS scale → geo: mevcut PNG’nin N/S/W/E’sini aynı oranda küçült (Nautilus Init ile uyumlu). */
  const visibleBBox = useCallback((): GeoBBox | null => {
    const vp = baseVpRef.current;
    const center = viewCenter();
    if (!vp || !center) return null;
    const scale = Math.max(0.25, camRef.current.scale);
    // Uniform CSS zoom → her iki eksen 1/scale (ekrandaki PNG kırpımı)
    const lonSpan = (vp.east - vp.west) / scale;
    const latSpan = (vp.north - vp.south) / scale;
    return {
      west: center.lon - lonSpan / 2,
      east: center.lon + lonSpan / 2,
      north: center.lat + latSpan / 2,
      south: center.lat - latSpan / 2,
    };
  }, [viewCenter]);

  /** Yeni frame hazır olunca tek karede URL + cam reset → görsel süreklilik */
  const commitFrame = useCallback(async (r: RenderInfo, resetCam: boolean) => {
    try {
      await preload(r.url);
    } catch {
      /* yine de göster */
    }
    const vp = r.viewport ?? null;
    baseVpRef.current = vp;
    const next: RenderInfo = {
      url: r.url,
      cellId: r.cellId,
      bytes: r.bytes,
      viewport: vp,
      width: r.width,
      height: r.height,
      ms: r.ms,
      drawMs: r.drawMs,
      renderMode: r.renderMode,
      rev: r.rev,
    };
    infoRef.current = next;
    setInfo(next);
    if (resetCam) setCamBoth({ x: 0, y: 0, scale: 1 });
    setPick(null);
  }, []);

  const redraw = useCallback(
    async (opts: { action: "fit" | "set"; bbox?: GeoBBox | null }) => {
      if (!window.irbis?.nautilusSetViewport) throw new Error("Nautilus API yok");
      const seq = ++loadSeq.current;
      const genAtStart = gestureGen.current;
      const camAtStart = { ...camRef.current };
      setBusy(true);
      setErr(null);
      sizeRef.current = stagePixelSize(stageRef.current);
      const { width, height } = sizeRef.current;
      try {
        const payload =
          opts.action === "fit"
            ? { cellId: cellId || undefined, width, height, dpi: 96, action: "fit" as const }
            : {
                cellId: cellId || undefined,
                width,
                height,
                dpi: 96,
                action: "set" as const,
                bbox: opts.bbox || undefined,
                north: opts.bbox?.north,
                south: opts.bbox?.south,
                west: opts.bbox?.west,
                east: opts.bbox?.east,
              };
        const r = (await window.irbis.nautilusSetViewport(payload)) as RenderInfo;
        if (seq !== loadSeq.current) return;
        // Render sırasında kullanıcı zoom’a devam ettiyse bu frame’i basma — yeniden settle
        if (genAtStart !== gestureGen.current) {
          scheduleRedrawRef.current?.();
          return;
        }
        await commitFrame(r, true);
        // Commit sonrası cam hâlâ jestten kalmışsa (nadir) temizle
        if (
          Math.abs(camRef.current.x - camAtStart.x) > 2 ||
          Math.abs(camRef.current.scale / Math.max(1e-6, camAtStart.scale) - 1) > 0.04
        ) {
          scheduleRedrawRef.current?.();
        }
      } catch (e) {
        if (seq !== loadSeq.current) return;
        setErr(String((e as { message?: string })?.message || e));
      } finally {
        if (seq === loadSeq.current) setBusy(false);
      }
    },
    [cellId, commitFrame]
  );

  const scheduleRedrawRef = useRef<(() => void) | null>(null);

  const scheduleRedraw = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    // Zoom sürerken CSS akar (Navionics karo akışı gibi); durunca tek native frame
    settleTimer.current = setTimeout(() => {
      const c = camRef.current;
      if (Math.abs(c.x) < 1.5 && Math.abs(c.y) < 1.5 && Math.abs(c.scale - 1) < 0.02) {
        setCamBoth({ x: 0, y: 0, scale: 1 });
        return;
      }
      const bbox = visibleBBox();
      if (!bbox) return;
      void redraw({ action: "set", bbox });
    }, 450);
  }, [redraw, visibleBBox]);

  scheduleRedrawRef.current = scheduleRedraw;

  useEffect(() => {
    void redraw({ action: "fit" });
    return () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
  }, [cellId, reloadToken, redraw]);

  const screenToPngPx = useCallback((clientX: number, clientY: number) => {
    const stage = stageRef.current;
    const inf = infoRef.current;
    if (!stage || !inf) return null;
    const sr = stage.getBoundingClientRect();
    const c = camRef.current;
    let lx = clientX - sr.left;
    let ly = clientY - sr.top;
    const cx = sr.width / 2;
    const cy = sr.height / 2;
    lx = (lx - cx - c.x) / c.scale + cx;
    ly = (ly - cy - c.y) / c.scale + cy;
    const x = (lx / sr.width) * inf.width;
    const y = (ly / sr.height) * inf.height;
    if (x < 0 || y < 0 || x > inf.width || y > inf.height) return null;
    return { x, y };
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!infoRef.current) return;
      const factor = wheelZoomFactor(e);
      const sr = el.getBoundingClientRect();
      const mx = e.clientX - sr.left;
      const my = e.clientY - sr.top;
      const c = camRef.current;
      const nextScale = Math.min(24, Math.max(0.3, c.scale * factor));
      if (Math.abs(nextScale - c.scale) < 1e-4) return;
      const cx = sr.width / 2;
      const cy = sr.height / 2;
      const ratio = nextScale / c.scale;
      setCamBoth({
        x: c.x + (mx - cx) * (1 - ratio),
        y: c.y + (my - cy) * (1 - ratio),
        scale: nextScale,
      });
      scheduleRedraw();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scheduleRedraw]);

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
    const pt = screenToPngPx(e.clientX, e.clientY);
    const vp = baseVpRef.current;
    const inf = infoRef.current;
    if (pt && vp && inf && onCursorMove) {
      onCursorMove({
        lon: vp.west + (pt.x / inf.width) * (vp.east - vp.west),
        lat: vp.north - (pt.y / inf.height) * (vp.north - vp.south),
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
      scheduleRedraw();
      return;
    }
    const pt = screenToPngPx(e.clientX, e.clientY);
    const inf = infoRef.current;
    if (!pt || !baseVpRef.current || !inf || !window.irbis?.nautilusPick) return;
    try {
      const hit = (await window.irbis.nautilusPick({
        cellId: cellId || undefined,
        width: inf.width,
        height: inf.height,
        x: pt.x,
        y: pt.y,
        viewport: baseVpRef.current,
      })) as PickHit;
      setPick(hit);
      const first = hit.features?.[0];
      const props: Record<string, unknown> = {};
      if (first?.attributes) for (const a of first.attributes) props[a.name] = a.value;
      if (first?.primitive) props.primitive = first.primitive;
      if (hit.source) props.source = hit.source;
      onFeatureQuery?.({
        title: first?.name || "Pick",
        props,
        lat: hit.geo?.lat,
        lon: hit.geo?.lon,
      });
    } catch (error) {
      setErr(String((error as { message?: string })?.message || error));
    }
  };

  const markers = useMemo(() => {
    const vp = info?.viewport;
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
  }, [aisTargets, aisVisible, headingDeg, info?.viewport, ownShip, radarVisible]);

  const chromeRight = info
    ? `${info.cellId} · ${info.renderMode || "draw"} · ${info.drawMs ?? info.ms ?? "—"}ms · ×${cam.scale.toFixed(2)}`
    : busy
      ? "…"
      : "—";

  return (
    <div className="nautilus-viewport">
      <div className="nautilus-viewport-chrome">
        <strong>Nautilus ENC</strong>
        <span>{chromeRight}</span>
        <div className="nautilus-viewport-actions">
          <button type="button" disabled={busy && !info} onClick={() => void redraw({ action: "fit" })}>
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
        {busy && !info ? (
          <div className="nautilus-viewport-empty">ENC yükleniyor…</div>
        ) : err && !info ? (
          <div className="nautilus-viewport-empty error">{err}</div>
        ) : info ? (
          <>
            <div
              className="nautilus-layer"
              style={{ transform: `translate3d(${cam.x}px, ${cam.y}px, 0) scale(${cam.scale})` }}
            >
              <img className="nautilus-viewport-img" src={info.url} alt={info.cellId} draggable={false} />
              <div className="nautilus-overlay">
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
                {pick && info.viewport ? (
                  <div
                    className="nautilus-pick-dot"
                    style={{
                      left: `${geoToPct(info.viewport, pick.geo.lon, pick.geo.lat).x}%`,
                      top: `${geoToPct(info.viewport, pick.geo.lon, pick.geo.lat).y}%`,
                    }}
                  />
                ) : null}
              </div>
            </div>
            {busy ? <div className="nautilus-busy">yenileniyor…</div> : null}
          </>
        ) : (
          <div className="nautilus-viewport-empty">ENC yok</div>
        )}
      </div>
    </div>
  );
}
