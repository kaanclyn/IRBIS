import { useCallback, useEffect, useMemo, useState } from "react";
import { ChartMap, type ChartFeatureHit } from "./chart/ChartMap";
import { loadStoredScheme, storeScheme, type ChartScheme } from "./chart/scheme";
import { ChartLibraryPanel } from "./components/ChartLibraryPanel";
import { NavPanel } from "./components/NavPanel";
import { SchemeSwitcher } from "./components/SchemeSwitcher";
import { useOwnShip } from "./hooks/useOwnShip";
import { useAis } from "./hooks/useAis";
import { haversineM } from "./nav/geo";
import { downloadGpx, gpxToWaypoints, pickGpxFile } from "./nav/gpx";
import type { AnchorWatch, MobPoint, Waypoint } from "./nav/types";
import wordmarkUrl from "./assets/brand/irbis-three-spheres.png";
import emblemUrl from "./assets/brand/irbis-emblem-spheres.png";

const DISCLAIMER_KEY = "irbis.disclaimer.accepted.session";

type HubId = "harita" | "seyir" | "sistem";

const HUBS: Array<{ id: HubId; label: string; mark: string; hint: string }> = [
  { id: "harita", label: "HARİTA", mark: "H", hint: "Katmanlar ve hücre" },
  { id: "seyir", label: "SEYİR", mark: "N", hint: "Rota · MOB · Demir" },
  { id: "sistem", label: "SİSTEM", mark: "A", hint: "AIS · Aletler · Ayar" },
];

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

function newWpId(): string {
  return `wp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

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
  const [hub, setHub] = useState<HubId>("sistem");
  const [scheme, setScheme] = useState<ChartScheme>(() => loadStoredScheme());
  const [featureHit, setFeatureHit] = useState<ChartFeatureHit | null>(null);

  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [clickToAddWp, setClickToAddWp] = useState(false);
  const [gpxMsg, setGpxMsg] = useState<string | null>(null);
  const [mob, setMob] = useState<MobPoint | null>(null);
  const [anchor, setAnchor] = useState<AnchorWatch | null>(null);

  const own = useOwnShip();
  const ais = useAis();

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

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
      // Don't overwrite Navionics display label with TR library selection
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
    if (clickToAddWp) return;
    setFeatureHit(hit);
  }, [clickToAddWp]);

  const onMapClick = useCallback(
    (ll: { lat: number; lon: number }) => {
      if (!clickToAddWp) return;
      setWaypoints((prev) => [
        ...prev,
        { id: newWpId(), lat: ll.lat, lon: ll.lon, name: `WP ${prev.length + 1}` },
      ]);
      setHub("seyir");
      setPanelOpen(true);
    },
    [clickToAddWp],
  );

  const selectHub = useCallback((id: HubId) => {
    setHub(id);
    setPanelOpen(true);
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

  const nextWp = waypoints[0] ?? null;
  const dtwNm = useMemo(() => {
    if (!nextWp || !own.position) return null;
    return haversineM(own.position.lat, own.position.lon, nextWp.lat, nextWp.lon) / 1852;
  }, [nextWp, own.position]);

  const ttgMin = useMemo(() => {
    if (dtwNm == null) return null;
    const sog = own.state?.sogKn?.value;
    if (!sog || sog < 0.1) return null;
    return (dtwNm / sog) * 60;
  }, [dtwNm, own.state?.sogKn?.value]);

  const anchorAlarm = useMemo(() => {
    if (!anchor || !own.position) return false;
    return haversineM(own.position.lat, own.position.lon, anchor.lat, anchor.lon) > anchor.radiusM;
  }, [anchor, own.position]);

  const accept = () => {
    sessionStorage.setItem(DISCLAIMER_KEY, "1");
    setAccepted(true);
  };

  const modeBadge = own.mode === "live" ? "CANLI" : "SİM";
  const modeClass = own.mode === "live" ? "live-badge" : "sim-badge";
  const propRows = featureHit ? summarizeProps(featureHit.properties) : [];

  const addAtOwnShip = () => {
    if (!own.position) {
      setGpxMsg("OwnShip konumu yok");
      return;
    }
    setWaypoints((prev) => [
      ...prev,
      {
        id: newWpId(),
        lat: own.position!.lat,
        lon: own.position!.lon,
        name: `WP ${prev.length + 1}`,
      },
    ]);
    setGpxMsg(null);
  };

  const exportGpx = () => {
    downloadGpx(waypoints);
    setGpxMsg(`${waypoints.length} WP indirildi`);
  };

  const importGpx = async () => {
    try {
      const xml = await pickGpxFile();
      const wps = gpxToWaypoints(xml);
      setWaypoints(wps);
      setGpxMsg(`${wps.length} WP yüklendi`);
      setHub("seyir");
      setPanelOpen(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== "cancelled") setGpxMsg(msg);
    }
  };

  const dropMob = () => {
    const lat = own.position?.lat ?? cursor.lat;
    const lon = own.position?.lon ?? cursor.lon;
    setMob({ lat, lon, droppedAtUtc: new Date().toISOString() });
    setHub("seyir");
    setPanelOpen(true);
  };

  const setAnchorHere = () => {
    const lat = own.position?.lat ?? cursor.lat;
    const lon = own.position?.lon ?? cursor.lon;
    setAnchor({ lat, lon, radiusM: 30 });
    setHub("seyir");
    setPanelOpen(true);
  };

  const AIS_COLORS = [
    "#2563eb",
    "#16a34a",
    "#e11d48",
    "#0891b2",
    "#ca8a04",
    "#7c3aed",
    "#ea580c",
    "#0d9488",
    "#db2777",
    "#4f46e5",
    "#65a30d",
    "#0284c7",
  ];

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
            </div>
          ) : null}
          {anchor && !mob ? (
            <div className={`anchor-banner${anchorAlarm ? " alarm" : ""}`} role="status">
              DEMİR · {anchor.radiusM} m{anchorAlarm ? " · ALARM" : ""}
            </div>
          ) : null}

          <ChartMap
            onMove={onMove}
            onCursorMove={onCursorMove}
            ownShip={own.position}
            headingDeg={own.state?.headingDegTrue?.value}
            aisTargets={ais.targets}
            reloadToken={chartReload}
            scheme={scheme}
            onFeatureQuery={onFeatureQuery}
            onMapClick={onMapClick}
            clickCapture={clickToAddWp}
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
              <p className="feature-query-note">
                MapLibre <code>queryRenderedFeatures</code> — katman özellikleri.
              </p>
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

        <aside className="side-panel" aria-label="Sistem paneli">
          <div className="side-panel-head">
            <div>
              <div className="side-panel-kicker">IRBIS</div>
              <div className="side-panel-title">
                {hub === "harita" ? "Harita" : hub === "seyir" ? "Seyir" : "Sistem"}
              </div>
            </div>
            <button type="button" className="side-panel-close" aria-label="Paneli kapat" onClick={() => setPanelOpen(false)}>
              ×
            </button>
          </div>

          <div className="hub-body">
            {hub === "sistem" || hub === "harita" ? (
              <>
                <div className="instrument-rail">
                  <Metric label="SOG" metric={own.metrics.sog} />
                  <Metric label="Derinlik" metric={own.metrics.depth} />
                  <Metric label="COG" metric={own.metrics.cog} />
                  <Metric label="Pruva" metric={own.metrics.hdg} />
                </div>

                <div className="pos-card">
                  <div className="pos-card-row">
                    <span className="pos-card-label">POS</span>
                    <span className="pos-card-value">{posLabel}</span>
                  </div>
                  <div className="pos-card-row pointer">
                    <span className="pos-card-label">İmleç</span>
                    <span className="pos-card-value">{pointerLabel ?? "—"}</span>
                  </div>
                  {(dtwNm != null || ttgMin != null) && (
                    <div className="pos-card-row muted">
                      <span className="pos-card-label">DTW / TTG</span>
                      <span className="pos-card-value">
                        {dtwNm != null ? `${dtwNm.toFixed(2)} NM` : "--"}
                        {" · "}
                        {ttgMin != null
                          ? ttgMin >= 60
                            ? `${Math.floor(ttgMin / 60)}h`
                            : `${ttgMin.toFixed(0)} min`
                          : "--"}
                      </span>
                    </div>
                  )}
                </div>
              </>
            ) : null}

            {hub === "harita" ? (
              <>
                <div className="hub-block">
                  <div className="hub-block-title">Görünen harita</div>
                  <div className="hub-cell-name">Navionics</div>
                  <p className="hub-note">Offline bizim-harita · S-63 OEM sonra</p>
                </div>
                <div className="hub-block">
                  <div className="hub-block-title">Renk şeması</div>
                  <SchemeSwitcher value={scheme} onChange={onScheme} />
                </div>
              </>
            ) : null}

            {hub === "seyir" ? (
              <div className="hub-body-nav">
                <NavPanel
                  waypoints={waypoints}
                  clickToAddWp={clickToAddWp}
                  onToggleClickAdd={() => setClickToAddWp((v) => !v)}
                  onAddAtOwnShip={addAtOwnShip}
                  onClearRoute={() => {
                    setWaypoints([]);
                    setGpxMsg(null);
                  }}
                  onRemoveWp={(id) => setWaypoints((prev) => prev.filter((w) => w.id !== id))}
                  onExportGpx={exportGpx}
                  onImportGpx={() => void importGpx()}
                  gpxMsg={gpxMsg}
                  mobActive={!!mob}
                  onDropMob={dropMob}
                  onClearMob={() => setMob(null)}
                  anchor={anchor}
                  anchorAlarm={anchorAlarm}
                  onSetAnchor={setAnchorHere}
                  onClearAnchor={() => setAnchor(null)}
                  onRadiusChange={(m) => setAnchor((a) => (a ? { ...a, radiusM: m } : a))}
                />
              </div>
            ) : null}

            {hub === "sistem" ? (
              <div className="ais-panel">
                <div className="ais-panel-title">
                  <span>AIS — {ais.count}</span>
                </div>
                <div className="ais-list">
                  {ais.targets.length === 0 ? (
                    <div className="ais-empty">Hedef yok</div>
                  ) : (
                    ais.targets.map((t) => {
                      const color = AIS_COLORS[Math.abs(t.mmsi) % AIS_COLORS.length];
                      return (
                        <div key={t.mmsi} className={`ais-row${t.lost ? " lost" : ""}`}>
                          <div className="ais-name">
                            <span className="ais-dot" style={{ background: color }} />
                            <span className="ais-name-text">{t.name || String(t.mmsi)}</span>
                            <span className="ais-row-chev" aria-hidden>
                              ›
                            </span>
                          </div>
                          <div className="ais-meta">
                            <span>
                              {t.sogKn !== undefined ? `${t.sogKn.toFixed(1)} kn` : "--"}
                              {t.cogDeg !== undefined ? ` ${Math.round(t.cogDeg)}°` : ""}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : null}

            <div className="panel-footer">
              <div className="link-status">
                <span className="link-status-label">Bağlantı</span>
                <span className="link-status-pill">
                  <span className={`link-dot${own.mode === "live" ? " live" : " sim"}`} />
                  NMEA UDP
                  <code>:{own.udpPort}</code>
                </span>
              </div>

              <div className="tool-grid" role="toolbar" aria-label="Araçlar">
                <button
                  type="button"
                  className={`tool-btn${hub === "sistem" ? " active" : ""}`}
                  title="Sistem"
                  aria-label="Sistem"
                  onClick={() => selectHub("sistem")}
                >
                  <ToolIcon kind="system" />
                </button>
                <button
                  type="button"
                  className={`tool-btn${hub === "seyir" ? " active" : ""}`}
                  title="Seyir"
                  aria-label="Seyir"
                  onClick={() => selectHub("seyir")}
                >
                  <ToolIcon kind="nav" />
                </button>
                <button
                  type="button"
                  className={`tool-btn${hub === "harita" ? " active" : ""}`}
                  title="Harita"
                  aria-label="Harita"
                  onClick={() => selectHub("harita")}
                >
                  <ToolIcon kind="layers" />
                </button>
                <button type="button" className="tool-btn" title="Harita kütüphanesi" aria-label="Kütüphane" onClick={() => setLibOpen(true)}>
                  <ToolIcon kind="lib" />
                </button>
                <button
                  type="button"
                  className={`tool-btn${clickToAddWp ? " active" : ""}`}
                  title="Waypoint ekle"
                  aria-label="Waypoint"
                  onClick={() => {
                    setClickToAddWp((v) => !v);
                    selectHub("seyir");
                  }}
                >
                  <ToolIcon kind="target" />
                </button>
                <button
                  type="button"
                  className="tool-btn"
                  title="Gündüz / gece"
                  aria-label="Şema"
                  onClick={() => onScheme(scheme === "day" ? "night" : "day")}
                >
                  <ToolIcon kind="daynight" />
                </button>
              </div>
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
              Bu sürüm tip onaylı ECDIS değildir. NOAA S-57 hücreleri demodur. NMEA UDP varsayılan port{" "}
              <strong>10110</strong> — veri yoksa simülasyon çalışır.
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

function Metric({
  label,
  metric,
  value,
}: {
  label: string;
  metric?: { value: string; unit?: string; stale: boolean; missing: boolean };
  value?: string;
}) {
  if (value !== undefined) {
    return (
      <div className="metric">
        <div className="metric-label">{label}</div>
        <div className="metric-value">{value}</div>
      </div>
    );
  }
  const m = metric!;
  const stale = m.stale || m.missing;
  return (
    <div className={`metric${stale ? " stale" : ""}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">
        {m.value}
        {m.unit ? <span className="metric-unit">{m.unit}</span> : null}
      </div>
    </div>
  );
}

function ToolIcon({ kind }: { kind: "system" | "nav" | "layers" | "lib" | "target" | "daynight" }) {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, "aria-hidden": true as const };
  if (kind === "system") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
      </svg>
    );
  }
  if (kind === "nav") {
    return (
      <svg {...common}>
        <path d="M12 3l7 18-7-4-7 4z" />
      </svg>
    );
  }
  if (kind === "layers") {
    return (
      <svg {...common}>
        <path d="M12 3l9 5-9 5-9-5 9-5z" />
        <path d="M3 12l9 5 9-5M3 16l9 5 9-5" />
      </svg>
    );
  }
  if (kind === "lib") {
    return (
      <svg {...common}>
        <path d="M4 5h7v14H4zM13 5h7v14h-7z" />
      </svg>
    );
  }
  if (kind === "target") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="7" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M12 3a9 9 0 100 18 7 7 0 010-14" />
    </svg>
  );
}
