import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChartMap, type ChartFeatureHit } from "./chart/ChartMap";
import { loadStoredScheme, storeScheme, type ChartScheme } from "./chart/scheme";
import { useOwnShip } from "./hooks/useOwnShip";
import { useAis } from "./hooks/useAis";
import type { MobPoint } from "./nav/types";
import wordmarkDarkUrl from "./assets/brand/irbis-wordmark-dark.png";
import wordmarkLightUrl from "./assets/brand/irbis-wordmark-light.png";

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
  | "radarOn";

type RadarLetter = "A" | "B";

export function App() {
  const [cursor, setCursor] = useState({ lat: 39.24, lon: -76.55, zoom: 12 });
  const [pointer, setPointer] = useState<{ lat: number; lon: number } | null>(null);
  const [now, setNow] = useState(() => new Date());
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
    void window.irbis?.getChartConfig?.().then((cfg) => {
      if (cfg?.mapMode === "navionics" || cfg?.cellName === "NAVIONICS") {
        setActiveCell("NAVIONICS");
        return;
      }
      if (cfg?.cellName) setActiveCell(cfg.cellName);
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
      <header className="titlebar">
        <div className="titlebar-left no-drag">
          <img
            className="brand-wordmark"
            src={scheme === "night" ? wordmarkDarkUrl : wordmarkLightUrl}
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
            aisTargets={ais.targets}
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
          <div className="bridge-head">
            <div className="bridge-brand">
              <div className="bridge-mark" aria-hidden />
              <div>
                <div className="bridge-kicker">Bridge</div>
                <div className="bridge-title">Kontrol</div>
              </div>
            </div>
            <button type="button" className="bridge-x" aria-label="Paneli kapat" onClick={() => setPanelOpen(false)}>
              ×
            </button>
          </div>

          <div className="bridge-body">
            <div className="meter-mosaic">
              <MeterCard label="SOG" unit="kn" metric={own.metrics.sog} />
              <MeterCard label="COG" unit="°T" metric={own.metrics.cog} />
              <MeterCard label="Derinlik" unit="m" metric={own.metrics.depth} />
              <MeterCard label="Pruva" unit="°" metric={own.metrics.hdg} />
              <MeterCard label="POS" value={posLabel} wide />
            </div>

            <div className="bridge-stamp">
              <div className="bridge-stamp-ico" aria-hidden>
                ⌖
              </div>
              <div>
                <div className="bridge-stamp-main">{pointerLabel ?? "İmleç haritada…"}</div>
                <div className="bridge-stamp-sub">{formatLocalStamp(now)}</div>
              </div>
            </div>

            <section className="bridge-zone">
              <div className="zone-head">
                <span>
                  <i className="zone-dot" aria-hidden />
                  Radar
                </span>
                <div className="radar-ab" role="group" aria-label="Radar kaynağı">
                  <button
                    type="button"
                    className={radarLetter === "A" ? "active" : ""}
                    onClick={() => {
                      setRadarLetter("A");
                      setStatusNote("Radar kaynağı · A");
                    }}
                  >
                    A
                  </button>
                  <button
                    type="button"
                    className={radarLetter === "B" ? "active" : ""}
                    onClick={() => {
                      setRadarLetter("B");
                      setStatusNote("Radar kaynağı · B");
                    }}
                  >
                    B
                  </button>
                </div>
              </div>

              <div className="bento-radar">
                <button
                  type="button"
                  className={`power-orb${radarOn ? " on" : ""}`}
                  title="Radar aç"
                  aria-pressed={radarOn}
                  onClick={() => runCtrl("radarOn")}
                >
                  <CtrlGlyph kind="radarSweep" />
                  <span>{radarOn ? `Radar ${radarLetter}` : "Radar"}</span>
                </button>
                <div className="bento-stack">
                  <ChipBtn id="radarInfo" label="Bilgi" active={radarInfo} onClick={runCtrl}>
                    <CtrlGlyph kind="radarInfo" />
                  </ChipBtn>
                  <ChipBtn id="radarArpa" label="ARPA" active={radarArpa} onClick={runCtrl}>
                    <CtrlGlyph kind="arpa" />
                  </ChipBtn>
                </div>
              </div>
            </section>

            <section className="bridge-zone">
              <div className="zone-head">
                <span>
                  <i className="zone-dot cam" aria-hidden />
                  Kamera
                </span>
                <em>CAM {camIndex + 1}</em>
              </div>
              <div className="chip-rail">
                <ChipBtn id="camAutoFocus" label="Focus" active={camAutoFocus} onClick={runCtrl}>
                  <CtrlGlyph kind="camA" />
                </ChipBtn>
                <ChipBtn id="camSwitch" label="Değiştir" active={false} onClick={runCtrl}>
                  <CtrlGlyph kind="camSwitch" />
                </ChipBtn>
                <ChipBtn id="camHome" label="Ana" active={false} onClick={runCtrl}>
                  <CtrlGlyph kind="home" />
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
                <span>
                  <i className="zone-dot nav" aria-hidden />
                  Seyir
                </span>
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

            <div className="bridge-footer">
              <button type="button" className={`ghost-btn${mob ? " danger" : ""}`} title="MOB" onClick={dropMob}>
                <CtrlGlyph kind="mob" />
                <span>MOB</span>
              </button>
              <button
                type="button"
                className="ghost-btn"
                title="Gündüz / gece"
                onClick={() => onScheme(scheme === "day" ? "night" : "day")}
              >
                <CtrlGlyph kind="daynight" />
                <span>{scheme === "night" ? "Gece" : "Gündüz"}</span>
              </button>
              <button type="button" className="ghost-btn" title="Kapat" onClick={() => void window.irbis?.windowClose?.()}>
                <CtrlGlyph kind="exit" />
                <span>Çık</span>
              </button>
            </div>

            <div className="bridge-link">
              <span className={`link-dot${own.mode === "live" ? " live" : " sim"}`} />
              <span>NMEA UDP</span>
              <code>:{own.udpPort}</code>
            </div>
          </div>
        </aside>
      </div>

    </div>
  );
}

function MeterCard({
  label,
  unit,
  metric,
  value,
  wide,
}: {
  label: string;
  unit?: string;
  metric?: { value: string; unit?: string; stale: boolean; missing: boolean };
  value?: string;
  wide?: boolean;
}) {
  const stale = metric ? metric.stale || metric.missing : false;
  const shown = value ?? metric?.value ?? "---";
  const unitTxt = unit ?? metric?.unit ?? "";
  return (
    <div className={`meter-card${wide ? " wide" : ""}${stale ? " stale" : ""}`}>
      <div className="meter-card-top">
        <span>{label}</span>
        {unitTxt ? <span className="meter-card-unit">{unitTxt}</span> : null}
      </div>
      <div className="meter-card-val">{shown}</div>
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
          <path d="M12 3a9 9 0 018.5 6" opacity="0.7" />
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
          <path d="M5.2 5.2l2.2 2.2M16.6 16.6l2.2 2.2M18.8 5.2l-2.2 2.2M7.4 16.6l-2.2 2.2" opacity="0.7" />
        </svg>
      );
    case "camA":
      return (
        <svg {...common}>
          <rect x="2.5" y="6.5" width="13.5" height="11" rx="2.2" />
          <path d="M16 9.2l5-2.4v10.4l-5-2.4z" />
          <path d="M7.2 15.2l1.8-5.2 1.8 5.2M7.7 13.6h2.8" strokeWidth="1.5" />
        </svg>
      );
    case "camSwitch":
      return (
        <svg {...common}>
          <rect x="2.5" y="7" width="12.5" height="10" rx="2" />
          <path d="M15 9.5l5.5-2.6v10.2L15 14.5z" />
          <path d="M6 4.5h5M8.5 3v3" />
        </svg>
      );
    case "home":
      return (
        <svg {...common}>
          <path d="M4 11.2 12 4.5l8 6.7" />
          <path d="M6.5 10.5V19h11v-8.5" />
          <path d="M10 19v-5h4v5" />
        </svg>
      );
    case "track":
      return (
        <svg {...common}>
          <path d="M4.5 12a7.5 7.5 0 1013.2-5" />
          <path d="M17.8 3.8v4.2h-4.2" />
          <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
        </svg>
      );
    case "cursor":
      return (
        <svg {...common}>
          <path d="M5 3.8 11.8 20l2.1-6.1L20 11.8z" />
          <path d="M13.5 13.5l4.8 6.2" />
        </svg>
      );
    case "lock":
      return (
        <svg {...common}>
          <rect x="5.5" y="11" width="13" height="9.5" rx="2" />
          <path d="M8 11V8.2a4 4 0 018 0V11" />
          <circle cx="12" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      );
    case "ship":
      return (
        <svg {...common} width={26} height={26}>
          <path d="M12 2.8 17.8 18.5 12 15.2 6.2 18.5z" fill="currentColor" fillOpacity="0.15" />
          <path d="M12 2.8 17.8 18.5 12 15.2 6.2 18.5z" />
          <path d="M8 20.5h8" />
        </svg>
      );
    case "ais":
      return (
        <svg {...common}>
          <path d="M12 3.5 16.5 17l-4.5-2.8L7.5 17z" />
          <path d="M5.5 20.2h13" />
          <path d="M9 8.5h6" opacity="0.5" />
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
