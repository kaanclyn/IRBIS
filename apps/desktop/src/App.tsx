import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChartMap, type ChartFeatureHit } from "./chart/ChartMap";
import { storeScheme, type ChartScheme } from "./chart/scheme";
import { useOwnShip } from "./hooks/useOwnShip";
import { useAis } from "./hooks/useAis";
import type { MobPoint } from "./nav/types";
import emblemUrl from "./assets/brand/irbis-emblem-mark.png";

function formatCoord(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  const absLat = Math.abs(lat);
  const absLon = Math.abs(lon);
  const latDeg = Math.floor(absLat);
  const lonDeg = Math.floor(absLon);
  const latMin = ((absLat - latDeg) * 60).toFixed(3);
  const lonMin = ((absLon - lonDeg) * 60).toFixed(3);
  return `${ns} ${latDeg}°${latMin}' ${ew} ${lonDeg}°${lonMin}'`;
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
type MainFocus = "map" | "camera";
type PtzDir = "up" | "down" | "left" | "right" | "home" | "zoomin" | "zoomout";

const CARDINAL = (deg: number): string => {
  const d = ((deg % 360) + 360) % 360;
  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return labels[Math.round(d / 45) % 8]!;
};

export function App() {
  const [cursor, setCursor] = useState({ lat: 39.24, lon: -76.55, zoom: 12 });
  const [pointer, setPointer] = useState<{ lat: number; lon: number } | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [chartReload, setChartReload] = useState(0);
  const [maximized, setMaximized] = useState(false);
  const [panelOpen] = useState(false);
  const [scheme, setScheme] = useState<ChartScheme>("night");
  const [featureHit, setFeatureHit] = useState<ChartFeatureHit | null>(null);
  const [mob, setMob] = useState<MobPoint | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [mainFocus, setMainFocus] = useState<MainFocus>("map");
  const [camZoom, setCamZoom] = useState(1);

  const [aisOn, setAisOn] = useState(true);
  const [radarOn, setRadarOn] = useState(false);
  const [radarInfo, setRadarInfo] = useState(false);
  const [radarArpa, setRadarArpa] = useState(false);
  const [radarLetter, setRadarLetter] = useState<RadarLetter>("A");
  const [camAutoFocus, setCamAutoFocus] = useState(false);
  const [camIndex, setCamIndex] = useState(0);
  const [camVideoTrack, setCamVideoTrack] = useState(false);
  const [camCursor, setCamCursor] = useState(false);
  const [camAisLock, setCamAisLock] = useState(false);

  const own = useOwnShip();
  const ais = useAis();

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

  const posLabel = own.position ? formatCoord(own.position.lat, own.position.lon) : "—";
  const pointerLabel = pointer ? formatCoord(pointer.lat, pointer.lon) : null;
  const headingNum = own.state?.headingDegTrue?.value ?? own.state?.headingDegMagnetic?.value ?? null;
  const headingDeg = headingNum != null && Number.isFinite(headingNum) ? headingNum : null;

  const scaleNm = useMemo(() => {
    const mpp = (156543.03392 * Math.cos((cursor.lat * Math.PI) / 180)) / 2 ** cursor.zoom;
    const barM = mpp * 100;
    return Math.max(0.1, barM / 1852);
  }, [cursor.lat, cursor.zoom]);

  const propRows = featureHit ? summarizeProps(featureHit.properties) : [];
  const gpsOk = !!own.position;
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

  const dropMob = () => {
    const lat = own.position?.lat ?? cursor.lat;
    const lon = own.position?.lon ?? cursor.lon;
    setMob({ lat, lon, droppedAtUtc: new Date().toISOString() });
    setStatusNote("MOB bırakıldı");
  };

  const toggleMainFocus = () => {
    setMainFocus((f) => {
      const next = f === "map" ? "camera" : "map";
      setStatusNote(next === "camera" ? "Kamera ana görünüm" : "Harita ana görünüm");
      return next;
    });
  };

  const runPtz = (dir: PtzDir) => {
    switch (dir) {
      case "zoomin":
        setCamZoom((z) => Math.min(8, +(z + 0.5).toFixed(1)));
        setStatusNote(`Kamera zoom · ${Math.min(8, camZoom + 0.5).toFixed(1)}×`);
        break;
      case "zoomout":
        setCamZoom((z) => Math.max(1, +(z - 0.5).toFixed(1)));
        setStatusNote(`Kamera zoom · ${Math.max(1, camZoom - 0.5).toFixed(1)}×`);
        break;
      case "home":
        setCamZoom(1);
        setCamCursor(false);
        setCamAisLock(false);
        setStatusNote("Kamera ana pozisyon");
        break;
      default:
        setStatusNote(`PTZ · ${dir} (CAM ${camIndex + 1})`);
    }
  };

  const runCtrl = (id: CtrlId) => {
    switch (id) {
      case "radarSource": {
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
        const next = (camIndex + 1) % 4;
        setCamIndex(next);
        setStatusNote(`Aktif kamera · CAM ${next + 1}`);
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
          setStatusNote(!v ? `Radar ${radarLetter} açık` : "Radar kapalı");
          return !v;
        });
        break;
    }
  };

  return (
    <div className={`app-shell${panelOpen ? "" : " panel-collapsed"}`}>
      <header className="titlebar titlebar-bridgev2">
        <div className="tb-shell no-drag">
          <div className="titlebar-brand">
            <img className="brand-emblem" src={emblemUrl} alt="IRBIS" draggable={false} />
          </div>

          <div className="tb-metrics tb-metrics-left" aria-label="Seyir">
            <TelemChip label="DEPTH" value={own.metrics.depth.value} unit="m" stale={own.metrics.depth.stale || own.metrics.depth.missing} />
            <TelemChip label="SOG" value={own.metrics.sog.value} unit="kn" stale={own.metrics.sog.stale || own.metrics.sog.missing} />
            <TelemChip label="COG" value={own.metrics.cog.value} unit="°" stale={own.metrics.cog.stale || own.metrics.cog.missing} />
          </div>

          <div className="tb-compass-wrap" aria-label="Pusula">
            <CompassRibbon headingDeg={headingDeg} />
          </div>

          <div className="tb-metrics tb-metrics-right" aria-label="Konum">
            <TelemChip label="HDG" value={own.metrics.hdg.value} unit={own.metrics.hdg.unit || "°"} stale={own.metrics.hdg.stale || own.metrics.hdg.missing} />
            <div className={`telem-chip telem-chip-wide${gpsOk ? "" : " stale"}`}>
              <span className="telem-chip-l">POS</span>
              <strong className="telem-chip-v telem-chip-pos">{posLabel}</strong>
            </div>
            <div className="telem-chip telem-chip-wide">
              <span className="telem-chip-l">İMLEÇ POS</span>
              <strong className="telem-chip-v telem-chip-pos">{pointerLabel ?? "—"}</strong>
            </div>
          </div>
        </div>

        <div className="window-controls no-drag">
          <button type="button" className="win-btn" aria-label="Küçült" onClick={() => void window.irbis?.windowMinimize?.()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path d="M1 5h8" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
          <button
            type="button"
            className="win-btn"
            aria-label={maximized ? "Geri yükle" : "Büyüt"}
            onClick={() => void window.irbis?.windowMaximizeToggle?.().then((s) => setMaximized(!!s?.maximized))}
          >
            {maximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                <path d="M2.5 3.5h5v5h-5zM3.5 2.5h5v5" fill="none" stroke="currentColor" strokeWidth="1.1" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                <rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.1" />
              </svg>
            )}
          </button>
          <button type="button" className="win-btn win-close" aria-label="Kapat" onClick={() => void window.irbis?.windowClose?.()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        </div>
      </header>

      <div className="workspace">
        <main className={`chart-stage stage-swap focus-${mainFocus}`} aria-label="Ana sahne">
          {mob ? (
            <div className="mob-banner" role="alert">
              MOB AKTİF · {formatCoord(mob.lat, mob.lon)}
              <button type="button" className="mob-clear" onClick={() => setMob(null)}>
                Kapat
              </button>
            </div>
          ) : null}

          <div className="stage-pane stage-map" data-role={mainFocus === "map" ? "primary" : "pip"}>
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
            {mainFocus === "camera" ? (
              <button type="button" className="pip-hit" aria-label="Haritayı büyüt" onClick={toggleMainFocus}>
                <span>HARİTA</span>
                <small>Dokun · tam ekran</small>
              </button>
            ) : null}
          </div>

          <div className="stage-pane stage-camera" data-role={mainFocus === "camera" ? "primary" : "pip"}>
            <CameraViewport camIndex={camIndex} zoom={camZoom} large={mainFocus === "camera"} />
            {mainFocus === "map" ? (
              <button type="button" className="pip-hit" aria-label="Kamerayı büyüt" onClick={toggleMainFocus}>
                <span>CAM {camIndex + 1}</span>
                <small>Dokun · tam ekran</small>
              </button>
            ) : null}
          </div>

          <PtzPad onCommand={runPtz} camIndex={camIndex} zoom={camZoom} />

          {statusNote ? (
            <div className="status-toast" role="status">
              {statusNote}
            </div>
          ) : null}

          {featureHit && mainFocus === "map" ? (
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

          {mainFocus === "map" ? (
            <div className="hud-tools">
              <div className="zoom-cluster">
                <button
                  type="button"
                  aria-label="Yakınlaştır"
                  onClick={() => window.dispatchEvent(new CustomEvent("irbis:map-zoom", { detail: 1 }))}
                >
                  +
                </button>
                <button
                  type="button"
                  aria-label="Uzaklaştır"
                  onClick={() => window.dispatchEvent(new CustomEvent("irbis:map-zoom", { detail: -1 }))}
                >
                  −
                </button>
              </div>
              <div className="scale-bar">~{scaleNm.toFixed(1)} NM</div>
            </div>
          ) : null}

          <nav className="dock-bar no-drag" aria-label="Ana menü">
            <div className="dock-island">
              <button type="button" className={mainFocus === "map" ? "active" : ""} onClick={() => setMainFocus("map")}>
                HARİTA
              </button>
              <button type="button" className={mainFocus === "camera" ? "active" : ""} onClick={() => setMainFocus("camera")}>
                KAMERA
              </button>
              <button type="button" className={aisOn ? "active" : ""} onClick={() => runCtrl("aisOn")}>
                AIS
              </button>
              <span className="dock-clock">{formatLocalStamp(now)}</span>
            </div>
          </nav>
        </main>

        <aside className="side-panel side-panel-bridge side-panel-slim" aria-label="Kontrol paneli">
          <div className="bridge-head">
            <div className="bridge-brand">
              <div>
                <div className="bridge-kicker">IRBIS</div>
                <div className="bridge-title">Kontrol</div>
              </div>
            </div>
            <button type="button" className="bridge-x" aria-label="Paneli kapat" onClick={() => setPanelOpen(false)}>
              ×
            </button>
          </div>

          <div className="bridge-body">
            <div className="pos-card">
              <div className="pos-card-label">POS</div>
              <div className="pos-card-val">{posLabel}</div>
              <div className="pos-card-sub">{pointerLabel ?? "İmleç haritada…"}</div>
            </div>

            <section className="bridge-zone">
              <div className="zone-head">
                <span>Kamera</span>
                <em>CAM {camIndex + 1}</em>
              </div>
              <div className="chip-rail">
                <ChipBtn id="camSwitch" label="Değiştir" active={false} onClick={runCtrl}>
                  <CtrlGlyph kind="camSwitch" />
                </ChipBtn>
                <ChipBtn id="camHome" label="Ana" active={false} onClick={runCtrl}>
                  <CtrlGlyph kind="home" />
                </ChipBtn>
                <ChipBtn id="camAutoFocus" label="Focus" active={camAutoFocus} onClick={runCtrl}>
                  <CtrlGlyph kind="camA" />
                </ChipBtn>
                <ChipBtn id="camVideoTrack" label="Track" active={camVideoTrack} onClick={runCtrl}>
                  <CtrlGlyph kind="track" />
                </ChipBtn>
                <ChipBtn id="camCursor" label="İmleç" active={camCursor} onClick={runCtrl}>
                  <CtrlGlyph kind="cursor" />
                </ChipBtn>
                <ChipBtn id="camAisLock" label="AIS kilit" active={camAisLock} onClick={runCtrl}>
                  <CtrlGlyph kind="lock" />
                </ChipBtn>
              </div>
            </section>

            <section className="bridge-zone">
              <div className="zone-head">
                <span>Seyir</span>
              </div>
              <div className="bento-nav bento-nav-2">
                <button type="button" className="hero-center" title="Teknemi merkeze al" onClick={() => runCtrl("centerOwn")}>
                  <span className="hero-ico">
                    <CtrlGlyph kind="ship" />
                  </span>
                  <div>
                    <strong>Merkeze al</strong>
                    <small>OwnShip</small>
                  </div>
                </button>
                <ChipBtn id="aisOn" label={aisOn ? "AIS açık" : "AIS kapalı"} active={aisOn} onClick={runCtrl} tall>
                  <CtrlGlyph kind="ais" />
                </ChipBtn>
              </div>
            </section>

            <details className="bridge-adv">
              <summary>Radar (sonra)</summary>
              <div className="radar-ab" role="group" aria-label="Radar kaynağı">
                <button type="button" className={radarLetter === "A" ? "active" : ""} onClick={() => { setRadarLetter("A"); setStatusNote("Radar · A"); }}>A</button>
                <button type="button" className={radarLetter === "B" ? "active" : ""} onClick={() => { setRadarLetter("B"); setStatusNote("Radar · B"); }}>B</button>
              </div>
              <div className="chip-rail" style={{ marginTop: 8 }}>
                <ChipBtn id="radarOn" label={radarOn ? `Radar ${radarLetter}` : "Radar"} active={radarOn} onClick={runCtrl}>
                  <CtrlGlyph kind="radarSweep" />
                </ChipBtn>
                <ChipBtn id="radarInfo" label="Bilgi" active={radarInfo} onClick={runCtrl}>
                  <CtrlGlyph kind="radarInfo" />
                </ChipBtn>
                <ChipBtn id="radarArpa" label="ARPA" active={radarArpa} onClick={runCtrl}>
                  <CtrlGlyph kind="arpa" />
                </ChipBtn>
              </div>
            </details>

            <div className="bridge-footer">
              <button type="button" className={`ghost-btn${mob ? " danger" : ""}`} title="MOB" onClick={dropMob}>
                <CtrlGlyph kind="mob" />
                <span>MOB</span>
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function TelemChip({ label, value, unit, stale }: { label: string; value: string; unit: string; stale?: boolean }) {
  return (
    <div className={`telem-chip${stale ? " stale" : ""}`}>
      <span className="telem-chip-l">{label}</span>
      <strong className="telem-chip-v">{value}</strong>
      {unit ? <span className="telem-chip-u">{unit}</span> : null}
    </div>
  );
}

function CompassRibbon({ headingDeg }: { headingDeg: number | null }) {
  const h = headingDeg ?? 0;
  const tickW = 28;
  const span = 150; // degrees visible each side
  const marks: Array<{ deg: number; label: string; major: boolean }> = [];
  for (let offset = -span; offset <= span; offset += 15) {
    const deg = ((Math.round(h) + offset) % 360 + 360) % 360;
    const major = deg % 45 === 0;
    const label = major ? CARDINAL(deg) : "";
    marks.push({ deg, label, major });
  }
  // Center the current heading under the needle: shift by fractional degree within tick
  const frac = ((h % 15) + 15) % 15;
  const shiftPx = -(frac / 15) * tickW;

  return (
    <div className="compass-ribbon">
      <div className="compass-ribbon-track">
        <div className="compass-ribbon-tape" style={{ transform: `translateX(${shiftPx}px)` }}>
          {marks.map((m, i) => (
            <div key={`${m.deg}-${i}`} className={`compass-ribbon-tick${m.major ? " major" : ""}`} style={{ width: tickW }}>
              <i />
              {m.label ? <span>{m.label}</span> : null}
            </div>
          ))}
        </div>
        <div className="compass-ribbon-needle" aria-hidden />
      </div>
      <div className="compass-ribbon-bubble">
        <span className="compass-ribbon-caret" aria-hidden />
        <strong>{headingDeg != null ? `${Math.round(headingDeg)}°` : "—"}</strong>
      </div>
    </div>
  );
}

function CameraViewport({ camIndex, zoom, large }: { camIndex: number; zoom: number; large: boolean }) {
  return (
    <div className={`camera-viewport${large ? " large" : ""}`} data-cam={camIndex + 1}>
      <div className="camera-feed" style={{ transform: `scale(${1 + (zoom - 1) * 0.08})` }}>
        <div className="camera-scan" />
        <div className="camera-grid-lines" aria-hidden />
      </div>
      <div className="camera-chrome">
        <span>CAM {camIndex + 1}</span>
        <span>{zoom.toFixed(1)}×</span>
        <span>FLIR</span>
      </div>
    </div>
  );
}

function PtzPad({
  onCommand,
  camIndex,
  zoom,
}: {
  onCommand: (d: PtzDir) => void;
  camIndex: number;
  zoom: number;
}) {
  return (
    <div className="ptz-pad" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <div className="ptz-meta">
        <span>CAM {camIndex + 1}</span>
        <span>{zoom.toFixed(1)}×</span>
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

function ChipBtn({
  id,
  label,
  active,
  onClick,
  children,
  tall,
}: {
  id: CtrlId;
  label: string;
  active: boolean;
  onClick: (id: CtrlId) => void;
  children: ReactNode;
  tall?: boolean;
}) {
  return (
    <button
      type="button"
      className={`chip-btn${active ? " active" : ""}${tall ? " tall" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={() => onClick(id)}
    >
      <span className="chip-ico">{children}</span>
      <span className="chip-lbl">{label}</span>
    </button>
  );
}

function CtrlGlyph({
  kind,
}: {
  kind:
    | "radarSweep"
    | "radarInfo"
    | "arpa"
    | "camA"
    | "camSwitch"
    | "home"
    | "track"
    | "cursor"
    | "lock"
    | "ship"
    | "ais"
    | "mob"
    | "daynight"
    | "exit";
}) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.65,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (kind) {
    case "radarSweep":
      return (
        <svg {...common} width={28} height={28}>
          <circle cx="12" cy="12" r="9" opacity="0.35" />
          <circle cx="12" cy="12" r="5.5" opacity="0.55" />
          <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
          <path d="M12 12l7-5" strokeWidth="2.2" />
        </svg>
      );
    case "radarInfo":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 10.5v5" strokeWidth="2" />
          <circle cx="12" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "arpa":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3.2" />
          <path d="M12 2.8v3.2M12 18v3.2M2.8 12h3.2M18 12h3.2" />
        </svg>
      );
    case "camA":
      return (
        <svg {...common}>
          <rect x="2.5" y="6.5" width="13.5" height="11" rx="2.2" />
          <path d="M16 9.2l5-2.4v10.4l-5-2.4z" />
        </svg>
      );
    case "camSwitch":
      return (
        <svg {...common}>
          <rect x="2.5" y="7" width="12.5" height="10" rx="2" />
          <path d="M15 9.5l5.5-2.6v10.2L15 14.5z" />
        </svg>
      );
    case "home":
      return (
        <svg {...common}>
          <path d="M4 11.2 12 4.5l8 6.7" />
          <path d="M6.5 10.5V19h11v-8.5" />
        </svg>
      );
    case "track":
      return (
        <svg {...common}>
          <path d="M4.5 12a7.5 7.5 0 1013.2-5" />
          <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
        </svg>
      );
    case "cursor":
      return (
        <svg {...common}>
          <path d="M5 3.8 11.8 20l2.1-6.1L20 11.8z" />
        </svg>
      );
    case "lock":
      return (
        <svg {...common}>
          <rect x="5.5" y="11" width="13" height="9.5" rx="2" />
          <path d="M8 11V8.2a4 4 0 018 0V11" />
        </svg>
      );
    case "ship":
      return (
        <svg {...common} width={26} height={26}>
          <path d="M12 2.8 17.8 18.5 12 15.2 6.2 18.5z" />
        </svg>
      );
    case "ais":
      return (
        <svg {...common}>
          <path d="M12 3.5 16.5 17l-4.5-2.8L7.5 17z" />
        </svg>
      );
    case "mob":
      return (
        <svg {...common}>
          <circle cx="12" cy="7" r="3" />
          <path d="M6.2 20.5v-1.8a4.3 4.3 0 014.3-4.3h3a4.3 4.3 0 014.3 4.3v1.8" />
        </svg>
      );
    case "daynight":
      return (
        <svg {...common}>
          <path d="M12 3.2a8.8 8.8 0 100 17.6 6.8 6.8 0 010-13.6" />
        </svg>
      );
    case "exit":
      return (
        <svg {...common}>
          <path d="M10 4.5H6.2A2.2 2.2 0 004 6.7v10.6a2.2 2.2 0 002.2 2.2H10" />
          <path d="M13.5 12H21M17.5 8.2 21.2 12l-3.7 3.8" />
        </svg>
      );
  }
}
