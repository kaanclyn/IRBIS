import { useCallback, useEffect, useMemo, useState } from "react";
import { ChartMap, type ChartFeatureHit } from "./chart/ChartMap";
import { storeScheme, type ChartScheme } from "./chart/scheme";
import { useOwnShip } from "./hooks/useOwnShip";
import { useAis } from "./hooks/useAis";
import { useCameras } from "./hooks/useCameras";
import type { MobPoint } from "./nav/types";
import emblemUrl from "./assets/brand/irbis-emblem-mark.png";
import { AisShipIcon, RadarIcon, RadarIconAB, RadarIconInfo, RadarIconMarpa } from "./components/DockIcons";
import { MarineTopbar, formatCoordParts } from "./components/MarineTopbar";

function formatCoord(lat: number, lon: number): string {
  const p = formatCoordParts(lat, lon);
  return `${p.lat} ${p.lon}`;
}

function formatLocalStamp(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${dd}.${mo}.${yy} ${hh}:${mm}:${ss}`;
}

function summarizeProps(props: Record<string, unknown>): Array<{ k: string; v: string }> {
  const prefer = ["OBJL", "objl", "OBJNAM", "objnam", "DRVAL1", "drval1", "DRVAL2", "drval2", "LITCHR", "COLOUR"];
  const rows: Array<{ k: string; v: string }> = [];
  const seen = new Set<string>();
  for (const k of prefer) {
    if (k in props && props[k] != null && props[k] !== "") {
      rows.push({ k, v: String(props[k]) });
      seen.add(k);
    }
  }
  for (const [k, v] of Object.entries(props)) {
    if (seen.has(k) || v == null || v === "") continue;
    if (typeof v === "object") continue;
    rows.push({ k, v: String(v) });
    if (rows.length >= 12) break;
  }
  return rows;
}

type CtrlId =
  | "radarSource"
  | "radarInfo"
  | "radarArpa"
  | "camAutoFocus"
  | "camSwitch"
  | "camHome"
  | "camVideoTrack"
  | "camCursor"
  | "camAisLock"
  | "centerOwn"
  | "aisOn"
  | "radarOn";

type RadarLetter = "A" | "B";
/** Harita → kamera PiP → split → kamera → harita PiP → … */
type ViewMode = "map" | "map-cam-pip" | "split" | "camera" | "camera-map-pip";
type PtzDir = "up" | "down" | "left" | "right" | "home" | "zoomin" | "zoomout";

const VIEW_ORDER: ViewMode[] = ["map", "map-cam-pip", "split", "camera", "camera-map-pip"];

const VIEW_LABEL: Record<ViewMode, string> = {
  map: "Sadece harita",
  "map-cam-pip": "Harita · kamera pencere",
  split: "Bölünmüş görünüm",
  camera: "Sadece kamera",
  "camera-map-pip": "Kamera · harita pencere",
};

export function App() {
  const [cursor, setCursor] = useState({ lat: 39.24, lon: -76.55, zoom: 12 });
  const [pointer, setPointer] = useState<{ lat: number; lon: number } | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [chartReload, setChartReload] = useState(0);
  const [maximized, setMaximized] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [scheme, setScheme] = useState<ChartScheme>("night");
  const [featureHit, setFeatureHit] = useState<ChartFeatureHit | null>(null);
  const [mob, setMob] = useState<MobPoint | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("map-cam-pip");
  const [camZoom, setCamZoom] = useState(1);

  const [aisOn, setAisOn] = useState(true);
  const [radarOn, setRadarOn] = useState(false);
  const [radarInfo, setRadarInfo] = useState(false);
  const [radarArpa, setRadarArpa] = useState(false);
  const [radarLetter, setRadarLetter] = useState<RadarLetter>("A");
  const [radarMenuOpen, setRadarMenuOpen] = useState(false);
  const [camAutoFocus, setCamAutoFocus] = useState(false);
  const [camIndex, setCamIndex] = useState(0);
  const [camVideoTrack, setCamVideoTrack] = useState(false);
  const [camCursor, setCamCursor] = useState(false);
  const [camAisLock, setCamAisLock] = useState(false);

  const own = useOwnShip();
  const ais = useAis();
  const cams = useCameras();

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!statusNote) return;
    const id = window.setTimeout(() => setStatusNote(null), 2200);
    return () => window.clearTimeout(id);
  }, [statusNote]);

  useEffect(() => {
    void window.irbis?.windowIsMaximized?.().then((s) => setMaximized(!!s?.maximized));
    const unsub = window.irbis?.onWindowState?.((payload) => {
      const p = payload as { maximized?: boolean };
      setMaximized(!!p?.maximized);
    });
    return () => unsub?.();
  }, []);

  useEffect(() => {
    const unsub = window.irbis?.onChartChanged?.(() => {
      setChartReload((n) => n + 1);
    });
    return () => unsub?.();
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 40);
    return () => window.clearTimeout(id);
  }, [viewMode]);

  useEffect(() => {
    setScheme("night");
    storeScheme("night");
    document.documentElement.dataset.scheme = "night";
    document.documentElement.dataset.ui = "dark";
  }, []);

  const onMove = useCallback((info: { lat: number; lon: number; zoom: number }) => {
    setCursor({ lat: info.lat, lon: info.lon, zoom: info.zoom });
  }, []);

  const onCursorMove = useCallback((info: { lat: number; lon: number } | null) => {
    if (!info) {
      setPointer(null);
      return;
    }
    setPointer({ lat: info.lat, lon: info.lon });
  }, []);

  const onFeatureQuery = useCallback((hit: ChartFeatureHit | null) => {
    setFeatureHit(hit);
  }, []);

  const posParts = own.position ? formatCoordParts(own.position.lat, own.position.lon) : null;
  const pointerParts = pointer ? formatCoordParts(pointer.lat, pointer.lon) : null;
  const headingNum = own.state?.headingDegTrue?.value ?? own.state?.headingDegMagnetic?.value ?? null;
  const headingDeg = headingNum != null && Number.isFinite(headingNum) ? headingNum : null;

  const scaleNm = useMemo(() => {
    const mpp = (156543.03392 * Math.cos((cursor.lat * Math.PI) / 180)) / 2 ** cursor.zoom;
    const barM = mpp * 100;
    return Math.max(0.1, barM / 1852);
  }, [cursor.lat, cursor.zoom]);

  const propRows = featureHit ? summarizeProps(featureHit.properties) : [];
  const centerOwnShip = () => {
    const lat = own.position?.lat;
    const lon = own.position?.lon;
    if (lat == null || lon == null) {
      setStatusNote("OwnShip konumu yok");
      return;
    }
    window.dispatchEvent(new CustomEvent("irbis:map-center", { detail: { lat, lon } }));
    setStatusNote("Tekne merkezlendi");
  };

  const cycleViewMode = () => {
    setViewMode((cur) => {
      const i = VIEW_ORDER.indexOf(cur);
      const next = VIEW_ORDER[(i + 1) % VIEW_ORDER.length]!;
      setStatusNote(VIEW_LABEL[next]);
      return next;
    });
  };

  const mapPrimary = viewMode === "map" || viewMode === "map-cam-pip" || viewMode === "split";
  const cameraVisible = viewMode !== "map";
  const mapVisible = viewMode !== "camera";
  const cameraIsPip = viewMode === "map-cam-pip";
  const mapIsPip = viewMode === "camera-map-pip";

  const runPtz = (dir: PtzDir) => {
    if (cams.active?.capabilities.ptz) {
      void cams.ptz(dir === "home" ? "home" : dir).then((r) => {
        if (!r?.ok) setStatusNote(r?.error || "PTZ hata");
        else setStatusNote(`PTZ · ${dir} · ${cams.active?.name ?? "CAM"}`);
      });
      if (dir === "home") {
        setCamZoom(1);
        setCamCursor(false);
        setCamAisLock(false);
      }
      return;
    }
    switch (dir) {
      case "zoomin":
        setCamZoom((z) => Math.min(8, +(z + 0.5).toFixed(1)));
        setStatusNote(`Dijital zoom · ${Math.min(8, camZoom + 0.5).toFixed(1)}×`);
        break;
      case "zoomout":
        setCamZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)));
        setStatusNote(`Dijital zoom · ${Math.max(1, camZoom - 0.5).toFixed(1)}×`);
        break;
      case "home":
        setCamZoom(1);
        setCamCursor(false);
        setCamAisLock(false);
        setStatusNote("Kamera ana pozisyon");
        break;
      default:
        setStatusNote(`PTZ · ${dir} (ONVIF kamera yok)`);
    }
  };

  const runCtrl = (id: CtrlId) => {
    switch (id) {
      case "radarSource": {
        // kept for ChipBtn typing; dock uses setRadarLetter directly
        const next: RadarLetter = radarLetter === "A" ? "B" : "A";
        setRadarLetter(next);
        setStatusNote(`Radar kaynağı · ${next}`);
        break;
      }
      case "radarInfo":
        setRadarInfo((v) => {
          setStatusNote(!v ? "Radar bilgi katmanı açık" : "Radar bilgi kapalı");
          return !v;
        });
        break;
      case "radarArpa":
        setRadarArpa((v) => {
          setStatusNote(!v ? "ARPA katmanı açık" : "ARPA kapalı");
          return !v;
        });
        break;
      case "camAutoFocus":
        setCamAutoFocus((v) => {
          setStatusNote(!v ? "Oto focus açık" : "Oto focus kapalı");
          return !v;
        });
        break;
      case "camSwitch": {
        if (cams.cameras.length > 0) {
          void cams.cycleActive().then(() => {
            setStatusNote(`Aktif kamera · ${cams.active?.name ?? "CAM"}`);
          });
        } else {
          const next = (camIndex + 1) % 4;
          setCamIndex(next);
          setStatusNote(`Aktif kamera · CAM ${next + 1}`);
        }
        break;
      }
      case "camHome":
        runPtz("home");
        break;
      case "camVideoTrack":
        setCamVideoTrack((v) => {
          setStatusNote(!v ? "Video track açık" : "Video track kapalı");
          return !v;
        });
        break;
      case "camCursor":
        setCamCursor((v) => {
          const on = !v;
          if (on) setCamAisLock(false);
          setStatusNote(on ? "Kamera → imleç" : "İmleç takibi kapalı");
          return on;
        });
        break;
      case "camAisLock":
        setCamAisLock((v) => {
          const on = !v;
          if (on) setCamCursor(false);
          setStatusNote(on ? "Kamera AIS kilidi" : "AIS kilidi kapalı");
          return on;
        });
        break;
      case "centerOwn":
        centerOwnShip();
        break;
      case "aisOn": {
        const next = !aisOn;
        setAisOn(next);
        setStatusNote(next ? `AIS açık · ${ais.count} hedef` : "AIS kapalı");
        break;
      }
      case "radarOn":
        setRadarOn((v) => {
          setStatusNote(!v ? `Radar ${radarLetter} · TX` : `Radar ${radarLetter} · STOP`);
          return !v;
        });
        break;
    }
  };

  return (
    <div className={`app-shell${panelOpen ? "" : " panel-collapsed"}`}>
      <MarineTopbar
        emblemUrl={emblemUrl}
        depth={own.metrics.depth.value}
        sog={own.metrics.sog.value}
        cog={own.metrics.cog.value}
        headingDeg={headingDeg}
        hdgValue={own.metrics.hdg.value}
        hdgUnit={own.metrics.hdg.unit || "T"}
        pos={posParts}
        cursor={pointerParts}
        depthStale={own.metrics.depth.stale || own.metrics.depth.missing}
        sogStale={own.metrics.sog.stale || own.metrics.sog.missing}
        cogStale={own.metrics.cog.stale || own.metrics.cog.missing}
        hdgStale={own.metrics.hdg.stale || own.metrics.hdg.missing}
        maximized={maximized}
        onMinimize={() => void window.irbis?.windowMinimize?.()}
        onMaximizeToggle={() => void window.irbis?.windowMaximizeToggle?.().then((s) => setMaximized(!!s?.maximized))}
        onClose={() => void window.irbis?.windowClose?.()}
      />

      <div className="workspace">
        <main className={`chart-stage stage-swap view-${viewMode}`} aria-label="Ana sahne">
          {mob ? (
            <div className="mob-banner" role="alert">
              MOB AKTİF · {formatCoord(mob.lat, mob.lon)}
              <button type="button" className="mob-clear" onClick={() => setMob(null)}>
                Kapat
              </button>
            </div>
          ) : null}

          <div className="stage-pane stage-map" data-role={mapIsPip ? "pip" : "primary"} hidden={!mapVisible}>
            <ChartMap
              onMove={onMove}
              onCursorMove={onCursorMove}
              ownShip={own.position}
              headingDeg={own.state?.headingDegTrue?.value}
              aisTargets={ais.targets}
              aisVisible={aisOn}
              radarVisible={radarOn}
              radarInfo={radarInfo}
              radarArpa={radarArpa}
              reloadToken={chartReload}
              scheme={scheme}
              onFeatureQuery={onFeatureQuery}
            />
            {mapIsPip ? (
              <button type="button" className="pip-hit" aria-label="Görünümü değiştir" onClick={cycleViewMode}>
                <span>HARİTA</span>
                <small>Dokun · sonraki görünüm</small>
              </button>
            ) : null}
          </div>

          <div className="stage-pane stage-camera" data-role={cameraIsPip ? "pip" : "primary"} hidden={!cameraVisible}>
            <CameraViewport
              label={cams.active?.name ?? `CAM ${camIndex + 1}`}
              playUrl={cams.playUrl}
              streamKind={cams.streamKind}
              status={cams.active?.status}
              zoom={camZoom}
              large={!cameraIsPip && viewMode !== "map"}
              hasThermal={!!cams.active?.streams.thermal}
              onToggleStream={() => {
                const next = cams.streamKind === "visible" ? "thermal" : "visible";
                if (next === "thermal" && !cams.active?.streams.thermal) return;
                void cams.setStream(next).then(() => setStatusNote(next === "thermal" ? "Thermal stream" : "Visible stream"));
              }}
            />
            {cameraIsPip ? (
              <button type="button" className="pip-hit" aria-label="Görünümü değiştir" onClick={cycleViewMode}>
                <span>{cams.active?.name ?? `CAM ${camIndex + 1}`}</span>
                <small>Dokun · sonraki görünüm</small>
              </button>
            ) : null}
          </div>

          {cameraVisible ? (
            <PtzPad
              onCommand={runPtz}
              label={cams.active?.name ?? `CAM ${camIndex + 1}`}
              zoom={camZoom}
              ptzReady={!!cams.active?.capabilities.ptz}
            />
          ) : null}

          {statusNote ? (
            <div className="status-toast" role="status">
              {statusNote}
            </div>
          ) : null}

          {featureHit && mapPrimary ? (
            <div className="feature-query" role="dialog" aria-label="Nesne sorgusu">
              <div className="feature-query-head">
                <div>
                  <div className="feature-query-tag">Sorgu</div>
                  <div className="feature-query-title">{featureHit.sourceLayer || featureHit.layerId}</div>
                </div>
                <button type="button" aria-label="Kapat" onClick={() => setFeatureHit(null)}>
                  ×
                </button>
              </div>
              <dl className="feature-query-props">
                {propRows.length === 0 ? (
                  <div className="ais-empty">Özellik yok</div>
                ) : (
                  propRows.map((r) => (
                    <div key={r.k} className="feature-query-row">
                      <dt>{r.k}</dt>
                      <dd>{r.v}</dd>
                    </div>
                  ))
                )}
              </dl>
            </div>
          ) : null}

          {mapPrimary ? (
            <div className="hud-tools">
              <div className="scale-bar">~{scaleNm.toFixed(1)} NM</div>
            </div>
          ) : null}

          <nav className="dock-bar no-drag" aria-label="Ana menü">
            <div className="dock-island">
              <button
                type="button"
                className="dock-icon-btn active"
                title={`${VIEW_LABEL[viewMode]} · sonraki`}
                aria-label={`${VIEW_LABEL[viewMode]}. Sonraki görünüme geç`}
                onClick={cycleViewMode}
              >
                <ViewModeIcon mode={viewMode} />
              </button>
              <button
                type="button"
                className={`dock-icon-btn${aisOn ? " active" : ""}`}
                title={aisOn ? "AIS açık" : "AIS kapalı"}
                aria-label={aisOn ? "AIS açık" : "AIS kapalı"}
                onClick={() => runCtrl("aisOn")}
              >
                <AisShipIcon />
              </button>
              <div className={`dock-radar${radarMenuOpen ? " open" : ""}`}>
                <button
                  type="button"
                  className={`dock-icon-btn dock-radar-tx${radarOn ? " active" : ""}`}
                  title={radarOn ? `Radar ${radarLetter} · STOP` : `Radar ${radarLetter} · TX`}
                  aria-label={radarOn ? "Radar stop" : "Radar transmit"}
                  onClick={() => runCtrl("radarOn")}
                >
                  <RadarIcon />
                </button>
                <button
                  type="button"
                  className={`dock-icon-btn dock-radar-caret${radarMenuOpen ? " active" : ""}`}
                  title={radarMenuOpen ? "Radar menüyü kapat" : "Radar menüyü aç"}
                  aria-label="Radar alt menü"
                  aria-expanded={radarMenuOpen}
                  onClick={() => setRadarMenuOpen((v) => !v)}
                >
                  <span className="dock-radar-caret-glyph">›</span>
                </button>
                <button
                  type="button"
                  className={`dock-icon-btn dock-settings-btn${panelOpen ? " active" : ""}`}
                  title="Ayarlar"
                  aria-label="Ayarlar"
                  aria-pressed={panelOpen}
                  onClick={() => setPanelOpen((v) => !v)}
                >
                  <SettingsGlyph />
                </button>
                <div className="dock-radar-extra" aria-hidden={!radarMenuOpen}>
                  <button
                    type="button"
                    className="dock-icon-btn active"
                    title={`Radar ${radarLetter} · tıkla A/B değiştir`}
                    aria-label={`Radar ${radarLetter}. A ile B arasında geç`}
                    tabIndex={radarMenuOpen ? 0 : -1}
                    onClick={() => {
                      const next = radarLetter === "A" ? "B" : "A";
                      setRadarLetter(next);
                      setStatusNote(`Radar kaynağı · ${next}`);
                    }}
                  >
                    <RadarIconAB letter={radarLetter} />
                  </button>
                  <button
                    type="button"
                    className={`dock-icon-btn dock-radar-marpa${radarArpa ? " active" : ""}`}
                    title="ARPA katmanı"
                    aria-label="ARPA"
                    aria-pressed={radarArpa}
                    tabIndex={radarMenuOpen ? 0 : -1}
                    onClick={() => runCtrl("radarArpa")}
                  >
                    <RadarIconMarpa />
                  </button>
                  <button
                    type="button"
                    className={`dock-icon-btn${radarInfo ? " active" : ""}`}
                    title="Radar bilgi katmanı"
                    aria-label="Radar bilgi"
                    aria-pressed={radarInfo}
                    tabIndex={radarMenuOpen ? 0 : -1}
                    onClick={() => runCtrl("radarInfo")}
                  >
                    <RadarIconInfo />
                  </button>
                </div>
              </div>
              <span className="dock-clock">{formatLocalStamp(now)}</span>
            </div>
          </nav>
        </main>

        <aside className="side-panel side-panel-bridge side-panel-slim" aria-label="Ayarlar">
          <div className="bridge-head">
            <div className="bridge-brand">
              <div>
                <div className="bridge-kicker">IRBIS</div>
                <div className="bridge-title">Ayarlar</div>
              </div>
            </div>
            <button
              type="button"
              className="bridge-x"
              aria-label="Ayarları kapat"
              onClick={() => setPanelOpen(false)}
            >
              ×
            </button>
          </div>

          <div className="bridge-body" />
        </aside>
      </div>
    </div>
  );
}

function SettingsGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.07 7.07 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.8 2h-3.6a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.55-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.8 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.92 14.66a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.43.34.68.22l2.39-.96c.5.39 1.04.7 1.63.94l.36 2.54c.05.24.26.42.5.42h3.6c.24 0 .45-.18.5-.42l.36-2.54c.59-.24 1.13-.55 1.63-.94l2.39.96c.25.12.54.02.68-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z" />
    </svg>
  );
}

function ViewModeIcon({ mode }: { mode: ViewMode }) {
  const stroke = "currentColor";
  switch (mode) {
    case "map":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <rect x="3" y="4" width="18" height="16" rx="2.5" fill="none" stroke={stroke} strokeWidth="1.7" />
          <path d="M3 10.5h18M12 4v16" fill="none" stroke={stroke} strokeWidth="1.2" opacity="0.45" />
        </svg>
      );
    case "map-cam-pip":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <rect x="2.5" y="3.5" width="19" height="17" rx="2.5" fill="none" stroke={stroke} strokeWidth="1.7" />
          <rect x="13" y="12" width="7" height="6.5" rx="1.2" fill="currentColor" opacity="0.85" />
        </svg>
      );
    case "split":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <rect x="2.5" y="3.5" width="19" height="17" rx="2.5" fill="none" stroke={stroke} strokeWidth="1.7" />
          <path d="M12 3.5v17" stroke={stroke} strokeWidth="1.7" />
          <rect x="3.5" y="4.5" width="7.5" height="15" rx="1" fill="currentColor" opacity="0.28" />
        </svg>
      );
    case "camera":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <rect x="2.5" y="6" width="14" height="12" rx="2.2" fill="none" stroke={stroke} strokeWidth="1.7" />
          <path d="M16.5 10l5-2.5v9L16.5 14z" fill="none" stroke={stroke} strokeWidth="1.7" strokeLinejoin="round" />
          <circle cx="9.5" cy="12" r="2.2" fill="none" stroke={stroke} strokeWidth="1.5" />
        </svg>
      );
    case "camera-map-pip":
      return (
        <svg viewBox="0 0 24 24" aria-hidden>
          <rect x="2.5" y="3.5" width="19" height="17" rx="2.5" fill="currentColor" opacity="0.22" stroke={stroke} strokeWidth="1.7" />
          <rect x="13" y="12" width="7" height="6.5" rx="1.2" fill="none" stroke={stroke} strokeWidth="1.6" />
          <path d="M14.2 14.2h4.6M14.2 16h3.2" stroke={stroke} strokeWidth="1.2" opacity="0.7" />
        </svg>
      );
  }
}

function CameraViewport({
  label,
  playUrl,
  streamKind,
  status,
  zoom,
  large,
  hasThermal,
  onToggleStream,
}: {
  label: string;
  playUrl: string | null;
  streamKind: "visible" | "thermal";
  status?: string;
  zoom: number;
  large: boolean;
  hasThermal?: boolean;
  onToggleStream?: () => void;
}) {
  return (
    <div className={`camera-viewport${large ? " large" : ""}`} data-stream={streamKind}>
      <div className="camera-feed" style={{ transform: `scale(${1 + (zoom - 1) * 0.08})` }}>
        {playUrl ? (
          <img className="camera-live" src={playUrl} alt={label} draggable={false} />
        ) : (
          <>
            <div className="camera-scan" />
            <div className="camera-grid-lines" aria-hidden />
            <div className="camera-empty">ONVIF kamera yok</div>
          </>
        )}
      </div>
      <div className="camera-chrome">
        <span>{label}</span>
        <span>{zoom.toFixed(1)}×</span>
        <button
          type="button"
          className="camera-stream-badge"
          disabled={!hasThermal}
          onClick={(e) => {
            e.stopPropagation();
            onToggleStream?.();
          }}
          title={hasThermal ? "Visible / Thermal değiştir" : "Thermal yok"}
        >
          {streamKind === "thermal" ? "THERMAL" : "VISIBLE"}
        </button>
        <span className="camera-status">{status === "online" ? "LIVE" : status?.toUpperCase() || "—"}</span>
      </div>
    </div>
  );
}

function PtzPad({
  onCommand,
  label,
  zoom,
  ptzReady,
}: {
  onCommand: (d: PtzDir) => void;
  label: string;
  zoom: number;
  ptzReady?: boolean;
}) {
  return (
    <div className="ptz-pad" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <div className="ptz-meta">
        <span>{label}</span>
        <span>{ptzReady ? "ONVIF" : `${zoom.toFixed(1)}×`}</span>
      </div>
      <div className="ptz-cross">
        <button type="button" className="ptz-btn n" aria-label="Yukarı" onClick={() => onCommand("up")}>▲</button>
        <button type="button" className="ptz-btn w" aria-label="Sol" onClick={() => onCommand("left")}>◀</button>
        <button type="button" className="ptz-btn home" aria-label="Ana" onClick={() => onCommand("home")}>⌂</button>
        <button type="button" className="ptz-btn e" aria-label="Sağ" onClick={() => onCommand("right")}>▶</button>
        <button type="button" className="ptz-btn s" aria-label="Aşağı" onClick={() => onCommand("down")}>▼</button>
      </div>
      <div className="ptz-zoom">
        <button type="button" aria-label="Zoom +" onClick={() => onCommand("zoomin")}>+</button>
        <button type="button" aria-label="Zoom −" onClick={() => onCommand("zoomout")}>−</button>
      </div>
    </div>
  );
}

