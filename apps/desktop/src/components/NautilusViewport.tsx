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
  cacheHit: boolean;
  cellId: string;
  bytes: number;
  viewport: GeoBBox | null;
  width: number;
  height: number;
  cacheDir?: string;
  tile?: { z: number; tx: number; ty: number } | null;
  fit?: GeoBBox | null;
  key?: string;
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

function scaleToZ(scale: number) {
  // Navionics benzeri: sürekli CSS scale → settle’da en yakın karo seviyesi
  return Math.max(0, Math.min(5, Math.round(Math.log2(Math.max(0.5, scale)))));
}

/**
 * Navionics modeli: sürükle/tekerlek = doğrusal CSS.
 * Bırakınca bakış z/x/y karosuna snap → disk PNG (aynı karoya dönüş = CACHE HIT).
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
  const fitRef = useRef<GeoBBox | null>(null);
  const tileRef = useRef<{ z: number; tx: number; ty: number } | null>(null);
  const infoRef = useRef<RenderInfo | null>(null);
  const sizeRef = useRef({ width: 1280, height: 720 });
  const loadSeq = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTileKey = useRef<string>("");

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
    const lx = (sr.width / 2 - sr.width / 2 - c.x) / c.scale + sr.width / 2;
    const ly = (sr.height / 2 - sr.height / 2 - c.y) / c.scale + sr.height / 2;
    const px = (lx / sr.width) * inf.width;
    const py = (ly / sr.height) * inf.height;
    return {
      lon: vp.west + (px / inf.width) * (vp.east - vp.west),
      lat: vp.north - (py / inf.height) * (vp.north - vp.south),
    };
  }, []);

  const applyRender = useCallback((r: RenderInfo & { key?: string; fit?: GeoBBox | null }) => {
    const vp = r.viewport ?? null;
    baseVpRef.current = vp;
    if (r.fit) fitRef.current = r.fit;
    else if (r.tile?.z === 0 && vp) fitRef.current = vp;
    tileRef.current = r.tile || { z: 0, tx: 0, ty: 0 };
    lastTileKey.current = r.key || "";
    const next: RenderInfo = {
      url: r.url,
      cacheHit: r.cacheHit,
      cellId: r.cellId,
      bytes: r.bytes,
      viewport: vp,
      width: r.width,
      height: r.height,
      cacheDir: r.cacheDir,
      tile: tileRef.current,
      fit: fitRef.current,
      key: r.key,
    };
    infoRef.current = next;
    setInfo(next);
    setCamBoth({ x: 0, y: 0, scale: 1 });
    setPick(null);
  }, []);

  const loadTile = useCallback(
    async (opts: { action: "fit" | "settle"; z?: number; centerLon?: number; centerLat?: number }) => {
      if (!window.irbis?.nautilusSetViewport) throw new Error("Nautilus API yok");
      const seq = ++loadSeq.current;
      setBusy(true);
      setErr(null);
      sizeRef.current = stagePixelSize(stageRef.current);
      const { width, height } = sizeRef.current;
      try {
        const r = (await window.irbis.nautilusSetViewport({
          cellId: cellId || undefined,
          width,
          height,
          dpi: 96,
          action: opts.action === "fit" ? "fit" : "settle",
          z: opts.z,
          centerLon: opts.centerLon,
          centerLat: opts.centerLat,
        })) as RenderInfo & { key?: string };

        if (seq !== loadSeq.current) return;

        // Aynı karo tekrar istenmişse (cache key aynı) CSS sıfırla, yeniden çizme hissi yok
        if (r.key && r.key === lastTileKey.current && infoRef.current) {
          setCamBoth({ x: 0, y: 0, scale: 1 });
          setBusy(false);
          if (r.cacheHit) {
            setInfo((prev) => (prev ? { ...prev, cacheHit: true } : prev));
          }
          return;
        }

        applyRender(r);
      } catch (e) {
        if (seq !== loadSeq.current) return;
        setErr(String((e as { message?: string })?.message || e));
      } finally {
        if (seq === loadSeq.current) setBusy(false);
      }
    },
    [applyRender, cellId]
  );

  const scheduleSettle = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const c = camRef.current;
      const center = viewCenter();
      if (!center) return;
      const z = scaleToZ(c.scale);
      // neredeyse kimlik ve z aynı → dokunma
      const cur = tileRef.current;
      if (
        Math.abs(c.x) < 3 &&
        Math.abs(c.y) < 3 &&
        Math.abs(c.scale - 1) < 0.05 &&
        cur &&
        cur.z === z
      ) {
        setCamBoth({ x: 0, y: 0, scale: 1 });
        return;
      }
      void loadTile({
        action: "settle",
        z,
        centerLon: center.lon,
        centerLat: center.lat,
      });
    }, 280);
  }, [loadTile, viewCenter]);

  useEffect(() => {
    lastTileKey.current = "";
    void loadTile({ action: "fit" });
    return () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
  }, [cellId, reloadToken, loadTile]);

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

  // Doğrusal zoom: küçük adımlar, busy olsa bile CSS akar; settle karo çeker
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!infoRef.current) return;
      const step = e.deltaY < 0 ? 1.04 : 1 / 1.04;
      const sr = el.getBoundingClientRect();
      const mx = e.clientX - sr.left;
      const my = e.clientY - sr.top;
      const c = camRef.current;
      const nextScale = Math.min(12, Math.max(0.4, c.scale * step));
      const cx = sr.width / 2;
      const cy = sr.height / 2;
      const ratio = nextScale / c.scale;
      setCamBoth({
        x: c.x + (mx - cx) * (1 - ratio),
        y: c.y + (my - cy) * (1 - ratio),
        scale: nextScale,
      });
      scheduleSettle();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scheduleSettle]);

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
      scheduleSettle();
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
    } catch (err) {
      setErr(String((err as { message?: string })?.message || err));
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

  const tileLabel = info?.tile ? `z${info.tile.z}/${info.tile.tx}/${info.tile.ty}` : "—";
  const chromeRight = info
    ? `${info.cellId} · ${tileLabel} · ${info.cacheHit ? "CACHE" : "DRAW"} · ×${cam.scale.toFixed(2)}`
    : busy
      ? "…"
      : "—";

  return (
    <div className="nautilus-viewport">
      <div className="nautilus-viewport-chrome">
        <strong>Nautilus ENC</strong>
        <span title={info?.cacheDir || ""}>{chromeRight}</span>
        <div className="nautilus-viewport-actions">
          <button type="button" disabled={busy} onClick={() => void loadTile({ action: "fit" })}>
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
          <div className="nautilus-viewport-empty">İlk karo çiziliyor…</div>
        ) : err && !info ? (
          <div className="nautilus-viewport-empty error">{err}</div>
        ) : info ? (
          <>
            <div
              className="nautilus-layer"
              style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale})` }}
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
            {busy ? <div className="nautilus-busy">karo…</div> : null}
            {info.cacheHit && !busy ? <div className="nautilus-cache-badge">disk cache</div> : null}
          </>
        ) : (
          <div className="nautilus-viewport-empty">ENC yok</div>
        )}
      </div>
    </div>
  );
}
