import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChartMap, type ChartFeatureHit } from "./chart/ChartMap";
import { loadStoredScheme, storeScheme, type ChartScheme } from "./chart/scheme";
import { ChartLibraryPanel } from "./components/ChartLibraryPanel";
import { useOwnShip } from "./hooks/useOwnShip";
import { useAis } from "./hooks/useAis";
import type { MobPoint } from "./nav/types";
import wordmarkUrl from "./assets/brand/irbis-three-spheres.png";
import emblemUrl from "./assets/brand/irbis-emblem-spheres.png";

const DISCLAIMER_KEY = "irbis.disclaimer.accepted.session";

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

function formatUtc(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss} UTC`;
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
  | "radarOn"
  | "layers";

export function App() {
  const [accepted, setAccepted] = useState(() => sessionStorage.getItem(DISCLAIMER_KEY) === "1");
  const [cursor, setCursor] = useState({ lat: 39.24, lon: -76.55, zoom: 12 });
  const [pointer, setPointer] = useState<{ lat: number; lon: number } | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [libOpen, setLibOpen] = useState(false);
  const [chartReload, setChartReload] = useState(0);
  const [activeCell, setActiveCell] = useState("");
  const [maximized, setMaximized] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [scheme, setScheme] = useState<ChartScheme>(() => loadStoredScheme());
  const [featureHit, setFeatureHit] = useState<ChartFeatureHit | null>(null);
  const [mob, setMob] = useState<MobPoint | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  const [aisOn, setAisOn] = useState(true);
  const [radarOn, setRadarOn] = useState(false);
  const [radarInfo, setRadarInfo] = useState(false);
  const [radarArpa, setRadarArpa] = useState(false);
  const [radarSource, setRadarSource] = useState(0);
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
    void window.irbis?.getChartConfig?.().then((cfg) => {
      if (cfg?.mapMode === "navionics" || cfg?.cellName === "NAVIONICS") {
        setActiveCell("NAVIONICS");
        return;
      }
      if (cfg?.cellName) setActiveCell(cfg.cellName);
    });
    void window.irbis?.getChartLibrary?.().then((s) => {
      setActiveCell((prev) => (prev === "NAVIONICS" ? prev : s?.activeCell || prev));
    });
    const unsub = window.irbis?.onChartChanged?.((payload) => {
      const p = payload as { cellName?: string };
      if (p?.cellName) setActiveCell(p.cellName);
      setChartReload((n) => n + 1);
    });
    return () => unsub?.();
  }, []);

  const onMove = useCallback((info: { lat: number; lon: number; zoom: number }) => {
    setCursor(info);
  }, []);

  const onCursorMove = useCallback((info: { lat: number; lon: number } | null) => {
    setPointer(info);
  }, []);

  const onScheme = useCallback((s: ChartScheme) => {
    setScheme(s);
    storeScheme(s);
    document.documentElement.dataset.scheme = s;
  }, []);

  useEffect(() => {
    document.documentElement.dataset.scheme = scheme;
    document.documentElement.dataset.ui = scheme === "night" ? "dark" : "light";
  }, [scheme]);

  const onFeatureQuery = useCallback((hit: ChartFeatureHit | null) => {
    setFeatureHit(hit);
  }, []);

  const posLabel = useMemo(() => {
    if (own.position) return formatCoord(own.position.lat, own.position.lon);
    return formatCoord(cursor.lat, cursor.lon);
  }, [own.position, cursor.lat, cursor.lon]);

  const pointerLabel = useMemo(() => {
    if (!pointer) return null;
    return formatCoord(pointer.lat, pointer.lon);
  }, [pointer]);

  const scaleNm = useMemo(() => {
    const mpp = (156543.03392 * Math.cos((cursor.lat * Math.PI) / 180)) / 2 ** cursor.zoom;
    const barM = mpp * 100;
    return Math.max(0.1, barM / 1852);
  }, [cursor.lat, cursor.zoom]);

  const accept = () => {
    sessionStorage.setItem(DISCLAIMER_KEY, "1");
    setAccepted(true);
  };

  const modeBadge = own.mode === "live" ? "CANLI" : "SİM";
  const modeClass = own.mode === "live" ? "live-badge" : "sim-badge";
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

  const dropMob = () => {
    const lat = own.position?.lat ?? cursor.lat;
    const lon = own.position?.lon ?? cursor.lon;
    setMob({ lat, lon, droppedAtUtc: new Date().toISOString() });
    setStatusNote("MOB bırakıldı");
  };

  const runCtrl = (id: CtrlId) => {
    switch (id) {
      case "radarSource": {
        const next = (radarSource + 1) % 3;
        setRadarSource(next);
        setStatusNote(`Radar kaynağı · ${next + 1}`);
        break;
      }
      case "radarInfo":
        setRadarInfo((v) => {
          setStatusNote(!v ? "Radar bilgi katmanı açık" : "Radar bilgi katmanı kapalı");
          return !v;
        });
        break;
      case "radarArpa":
        setRadarArpa((v) => {
          setStatusNote(!v ? "ARPA katmanı açık" : "ARPA katmanı kapalı");
          return !v;
        });
        break;
      case "camAutoFocus":
        setCamAutoFocus((v) => {
          setStatusNote(!v ? "Kamera oto focus açık" : "Kamera oto focus kapalı");
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
        setCamCursor(false);
        setCamAisLock(false);
        setStatusNote("Kamera ana pozisyon");
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
          setStatusNote(on ? "Kamera → harita imleci" : "İmleç takibi kapalı");
          return on;
        });
        break;
      case "camAisLock":
        setCamAisLock((v) => {
          const on = !v;
          if (on) setCamCursor(false);
          setStatusNote(on ? "Kamera AIS kilidi (hedef seç)" : "AIS kilidi kapalı");
          return on;
        });
        break;
      case "centerOwn":
        centerOwnShip();
        break;
      case "aisOn":
        setAisOn((v) => {
          setStatusNote(!v ? "AIS açık" : "AIS kapalı");
          return !v;
        });
        break;
      case "radarOn":
        setRadarOn((v) => {
          setStatusNote(!v ? "Radar açık" : "Radar kapalı");
          return !v;
        });
        break;
      case "layers":
        setLibOpen(true);
        break;
    }
  };

  const active = (id: CtrlId): boolean => {
    switch (id) {
      case "radarInfo":
        return radarInfo;
      case "radarArpa":
        return radarArpa;
      case "camAutoFocus":
        return camAutoFocus;
      case "camVideoTrack":
        return camVideoTrack;
      case "camCursor":
        return camCursor;
      case "camAisLock":
        return camAisLock;
      case "aisOn":
        return aisOn;
      case "radarOn":
        return radarOn;
      default:
        return false;
    }
  };

  return (
    <div className={`app-shell${panelOpen ? "" : " panel-collapsed"}`}>
      <header className="titlebar">
        <div className="titlebar-left no-drag">
          <img
            className="brand-wordmark"
            src={wordmarkUrl}
            alt="IRBIS Marine Navigation Platform"
            draggable={false}
          />
          <span className={modeClass}>{modeBadge}</span>
        </div>

        <div className="titlebar-meta no-drag">
          <span className="meta-chip">{formatUtc(now)}</span>
          <span className="meta-chip" title={activeCell || undefined}>
            {activeCell === "NAVIONICS" || !activeCell
              ? "NAVIONICS"
              : /^TR/i.test(activeCell)
                ? "LAB S-57"
                : activeCell}
          </span>
          <span className="meta-chip hide-sm">AIS {aisOn ? ais.count : 0}</span>
          <button
            type="button"
            className="rail-toggle"
            title={panelOpen ? "Paneli gizle" : "Paneli göster"}
            onClick={() => setPanelOpen((v) => !v)}
          >
            {panelOpen ? "⟩" : "⟨"}
          </button>
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
        <main className="chart-stage" aria-label="Harita">
          {mob ? (
            <div className="mob-banner" role="alert">
              MOB AKTİF · {formatCoord(mob.lat, mob.lon)}
              <button type="button" className="mob-clear" onClick={() => setMob(null)}>
                Kapat
              </button>
            </div>
          ) : null}

          <ChartMap
            onMove={onMove}
            onCursorMove={onCursorMove}
            ownShip={own.position}
            headingDeg={own.state?.headingDegTrue?.value}
            aisTargets={aisOn ? ais.targets : []}
            aisVisible={aisOn}
            radarVisible={radarOn}
            radarInfo={radarInfo}
            radarArpa={radarArpa}
            reloadToken={chartReload}
            scheme={scheme}
            onFeatureQuery={onFeatureQuery}
          />

          <div className="exp-chip" role="status" title="Deneysel — seyrüsefer için değil">
            DENEYSEL
          </div>

          {pointerLabel ? (
            <div className="cursor-coord" role="status" aria-live="polite">
              <span className="cursor-coord-label">İmleç</span>
              <span className="cursor-coord-value">{pointerLabel}</span>
              <span className="cursor-coord-zoom">z{cursor.zoom.toFixed(1)}</span>
            </div>
          ) : null}

          {statusNote ? (
            <div className="status-toast" role="status">
              {statusNote}
            </div>
          ) : null}

          {featureHit ? (
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
        </main>

        <aside className="side-panel side-panel-bridge" aria-label="Kontrol paneli">
          <div className="bridge-tabs" role="tablist" aria-label="Modüller">
            <span className="bridge-tab active" title="Sistem">
              <CtrlGlyph kind="gauge" />
            </span>
            <span className="bridge-tab" title="Radar">
              <CtrlGlyph kind="radar" />
            </span>
            <span className="bridge-tab" title="Kamera">
              <CtrlGlyph kind="cam" />
            </span>
            <span className="bridge-tab" title="Harita">
              <CtrlGlyph kind="map" />
            </span>
            <button type="button" className="side-panel-close bridge-close" aria-label="Paneli kapat" onClick={() => setPanelOpen(false)}>
              ×
            </button>
          </div>

          <div className="hub-body bridge-body">
            <div className="bridge-meters">
              <MeterRow label="SOG" unit="Kn" metric={own.metrics.sog} />
              <MeterRow label="COG" unit="°T" metric={own.metrics.cog} />
              <MeterRow label="Derinlik" unit="m" metric={own.metrics.depth} />
              <MeterRow label="POS" value={posLabel} />
              <MeterRow label="Pruva" unit="°" metric={own.metrics.hdg} />
            </div>

            <div className="bridge-stamp">
              <div>{pointerLabel ?? posLabel}</div>
              <div>{formatLocalStamp(now)}</div>
            </div>

            <div className="ctrl-grid" role="toolbar" aria-label="Kontroller">
              <CtrlBtn id="radarSource" label="Radar kaynağı değiştir" active={false} badge={String(radarSource + 1)} onClick={runCtrl}>
                <CtrlGlyph kind="radarSrc" />
              </CtrlBtn>
              <CtrlBtn id="radarInfo" label="Radar bilgi katmanı" active={active("radarInfo")} onClick={runCtrl}>
                <CtrlGlyph kind="radarInfo" />
              </CtrlBtn>
              <CtrlBtn id="radarArpa" label="Radar ARPA katmanı" active={active("radarArpa")} onClick={runCtrl}>
                <CtrlGlyph kind="arpa" />
              </CtrlBtn>

              <CtrlBtn id="camAutoFocus" label="Kamera oto focus" active={active("camAutoFocus")} onClick={runCtrl}>
                <CtrlGlyph kind="camA" />
              </CtrlBtn>
              <CtrlBtn id="camSwitch" label="Aktif kamerayı değiştir" active={false} badge={String(camIndex + 1)} onClick={runCtrl}>
                <CtrlGlyph kind="camSwitch" />
              </CtrlBtn>
              <CtrlBtn id="camHome" label="Kamerayı ana pozisyona çevir" active={false} onClick={runCtrl}>
                <CtrlGlyph kind="home" />
              </CtrlBtn>
              <CtrlBtn id="camVideoTrack" label="Kamera video track" active={active("camVideoTrack")} onClick={runCtrl}>
                <CtrlGlyph kind="track" />
              </CtrlBtn>

              <CtrlBtn id="camCursor" label="Kamerayı haritada imleçe çevir" active={active("camCursor")} onClick={runCtrl}>
                <CtrlGlyph kind="cursor" />
              </CtrlBtn>
              <CtrlBtn id="camAisLock" label="Kamerayı seçtiğim AIS'e kilitle" active={active("camAisLock")} onClick={runCtrl}>
                <CtrlGlyph kind="lock" />
              </CtrlBtn>
              <CtrlBtn id="centerOwn" label="Teknemi merkeze al" active={false} onClick={runCtrl}>
                <CtrlGlyph kind="ship" />
              </CtrlBtn>
              <CtrlBtn id="aisOn" label="AIS aç" active={active("aisOn")} onClick={runCtrl}>
                <CtrlGlyph kind="ais" />
              </CtrlBtn>

              <CtrlBtn id="radarOn" label="Radar aç" active={active("radarOn")} onClick={runCtrl}>
                <CtrlGlyph kind="radarOn" />
              </CtrlBtn>
              <CtrlBtn id="layers" label="Katmanları göster" active={false} onClick={runCtrl}>
                <CtrlGlyph kind="layers" />
              </CtrlBtn>
            </div>

            <div className="bridge-footer">
              <button type="button" className={`tool-btn${mob ? " active" : ""}`} title="MOB" aria-label="MOB" onClick={dropMob}>
                <CtrlGlyph kind="mob" />
              </button>
              <button
                type="button"
                className="tool-btn"
                title="Gündüz / gece"
                aria-label="Şema"
                onClick={() => onScheme(scheme === "day" ? "night" : "day")}
              >
                <CtrlGlyph kind="daynight" />
              </button>
              <button type="button" className="tool-btn" title="Çıkış" aria-label="Kapat" onClick={() => void window.irbis?.windowClose?.()}>
                <CtrlGlyph kind="exit" />
              </button>
            </div>

            <div className="link-status bridge-link">
              <span className="link-status-pill">
                <span className={`link-dot${own.mode === "live" ? " live" : " sim"}`} />
                NMEA UDP
                <code>:{own.udpPort}</code>
              </span>
            </div>
          </div>
        </aside>
      </div>

      <ChartLibraryPanel
        open={libOpen}
        onClose={() => setLibOpen(false)}
        scheme={scheme}
        onSchemeChange={onScheme}
        onActivated={() => {
          setChartReload((n) => n + 1);
          void window.irbis?.getChartLibrary?.().then((s) => {
            if (s?.activeCell) setActiveCell(s.activeCell);
          });
        }}
      />

      {!accepted && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="disclaimer-title">
          <div className="modal-card">
            <img className="disclaimer-emblem" src={emblemUrl} alt="" aria-hidden />
            <h1 id="disclaimer-title">Seyir uyarısı</h1>
            <p>
              IRBIS bir seyir yardımcısıdır; resmî haritaların, yayınların ve gemide bulunması zorunlu seyir
              donanımının yerini tutmaz.
            </p>
            <p>
              Harita, konum, derinlik, AIS ve alarm bilgileri gecikmeli, eksik veya hatalı olabilir. Gözcülük
              (COLREG Kural 5) ve tüm kararlar kaptanın sorumluluğundadır.
            </p>
            <p>
              Bu sürüm tip onaylı ECDIS değildir. NMEA UDP varsayılan port <strong>10110</strong> — veri yoksa
              simülasyon çalışır.
            </p>
            <div className="actions">
              <button type="button" onClick={accept}>
                Okudum, kabul ediyorum
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MeterRow({
  label,
  unit,
  metric,
  value,
}: {
  label: string;
  unit?: string;
  metric?: { value: string; unit?: string; stale: boolean; missing: boolean };
  value?: string;
}) {
  const stale = metric ? metric.stale || metric.missing : false;
  const shown = value ?? metric?.value ?? "---";
  const unitTxt = unit ?? metric?.unit ?? "";
  return (
    <div className={`meter-row${stale ? " stale" : ""}`}>
      <div className="meter-row-head">
        <span>{label}</span>
        {unitTxt ? <span className="meter-row-unit">{unitTxt}</span> : null}
      </div>
      <div className="meter-row-value">{shown}</div>
    </div>
  );
}

function CtrlBtn({
  id,
  label,
  active,
  badge,
  onClick,
  children,
}: {
  id: CtrlId;
  label: string;
  active: boolean;
  badge?: string;
  onClick: (id: CtrlId) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`ctrl-btn${active ? " active" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={() => onClick(id)}
    >
      {children}
      {badge ? <span className="ctrl-badge">{badge}</span> : null}
    </button>
  );
}

function CtrlGlyph({
  kind,
}: {
  kind:
    | "gauge"
    | "radar"
    | "cam"
    | "map"
    | "radarSrc"
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
    | "radarOn"
    | "layers"
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
    strokeWidth: 1.7,
    "aria-hidden": true as const,
  };
  switch (kind) {
    case "gauge":
      return (
        <svg {...common}>
          <path d="M4 14a8 8 0 1116 0" />
          <path d="M12 14l4-5" />
          <circle cx="12" cy="14" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "radar":
    case "radarOn":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="4" />
          <path d="M12 12l6-4" />
        </svg>
      );
    case "radarSrc":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7" />
          <path d="M12 5v7l5 3" />
          <text x="16" y="10" fontSize="7" fill="currentColor" stroke="none" fontWeight="700">
            A
          </text>
        </svg>
      );
    case "radarInfo":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 10v5M12 7.5h.01" strokeWidth="2" />
        </svg>
      );
    case "arpa":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
          <text x="15" y="9" fontSize="5.5" fill="currentColor" stroke="none" fontWeight="700">
            ARPA
          </text>
        </svg>
      );
    case "cam":
    case "camSwitch":
      return (
        <svg {...common}>
          <rect x="3" y="7" width="14" height="11" rx="2" />
          <path d="M17 10l4-2v9l-4-2z" />
        </svg>
      );
    case "camA":
      return (
        <svg {...common}>
          <rect x="3" y="7" width="14" height="11" rx="2" />
          <path d="M17 10l4-2v9l-4-2z" />
          <text x="7.5" y="15" fontSize="8" fill="currentColor" stroke="none" fontWeight="700">
            A
          </text>
        </svg>
      );
    case "home":
      return (
        <svg {...common}>
          <path d="M4 11l8-7 8 7" />
          <path d="M6 10v9h12v-9" />
        </svg>
      );
    case "track":
      return (
        <svg {...common}>
          <path d="M4 12a8 8 0 1014.5-4.5" />
          <path d="M18.5 4v4h-4" />
        </svg>
      );
    case "cursor":
      return (
        <svg {...common}>
          <path d="M5 4l6 16 2-6 6-2z" />
        </svg>
      );
    case "lock":
      return (
        <svg {...common}>
          <rect x="6" y="11" width="12" height="9" rx="1.5" />
          <path d="M8 11V8a4 4 0 018 0v3" />
        </svg>
      );
    case "ship":
      return (
        <svg {...common}>
          <path d="M12 3l5 14-5-3-5 3z" />
        </svg>
      );
    case "ais":
      return (
        <svg {...common}>
          <path d="M12 4l4 12-4-2.5L8 16z" />
          <path d="M7 19h10" />
        </svg>
      );
    case "map":
    case "layers":
      return (
        <svg {...common}>
          <path d="M12 3l9 5-9 5-9-5 9-5z" />
          <path d="M3 12l9 5 9-5M3 16l9 5 9-5" />
        </svg>
      );
    case "mob":
      return (
        <svg {...common}>
          <circle cx="12" cy="7" r="3" />
          <path d="M6 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" />
        </svg>
      );
    case "daynight":
      return (
        <svg {...common}>
          <path d="M12 3a9 9 0 100 18 7 7 0 010-14" />
        </svg>
      );
    case "exit":
      return (
        <svg {...common}>
          <path d="M10 5H6a2 2 0 00-2 2v10a2 2 0 002 2h4" />
          <path d="M14 12H22M18 8l4 4-4 4" />
        </svg>
      );
  }
}
