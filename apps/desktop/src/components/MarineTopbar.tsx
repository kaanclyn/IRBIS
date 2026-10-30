import { useEffect, useRef, useState } from "react";

const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

function deltaAngle(angle: number, middle: number): number {
  return ((angle - middle + 540) % 360) - 180;
}

export function formatCoordParts(lat: number, lon: number): { lat: string; lon: string } {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  const absLat = Math.abs(lat);
  const absLon = Math.abs(lon);
  const latDeg = Math.floor(absLat);
  const lonDeg = Math.floor(absLon);
  const latMin = ((absLat - latDeg) * 60).toFixed(3);
  const lonMin = ((absLon - lonDeg) * 60).toFixed(3);
  return {
    lat: `${ns} ${latDeg}°${latMin}′`,
    lon: `${ew} ${lonDeg}°${lonMin}′`,
  };
}

function withDegree(raw: string): string {
  if (!raw || raw === "--" || raw === "—") return "—";
  return raw.includes("°") ? raw : `${raw}°`;
}

function SvgCompass({ heading }: { heading: number }) {
  const hostRef = useRef<HTMLElement | null>(null);
  const [geom, setGeom] = useState({ width: 320, height: 42 });

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => {
      const pad = window.innerWidth <= 670 ? 14 : window.innerWidth <= 1540 ? 18 : 28;
      const width = Math.max(el.clientWidth - pad, 150);
      setGeom({ width, height: 42 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { width, height } = geom;
  const degreesPerView = 154;
  const pixelsPerDegree = width / degreesPerView;
  const ticks: Array<{ x: number; major: boolean; medium: boolean; label?: string }> = [];
  for (let degree = 0; degree < 360; degree += 5) {
    const diff = deltaAngle(degree, heading);
    const x = width / 2 + diff * pixelsPerDegree;
    if (x < 9 || x > width - 9) continue;
    const major = degree % 45 === 0;
    const medium = degree % 15 === 0;
    ticks.push({
      x,
      major,
      medium,
      label: major && Math.abs(x - width / 2) > 14 ? DIRECTIONS[degree / 45] : undefined,
    });
  }

  return (
    <section className="compass" aria-label="Pusula / heading" ref={hostRef}>
      <svg className="compass-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Dinamik pusula skalası">
        <line x1={0} y1={30} x2={width} y2={30} className="track" />
        {ticks.map((t, i) => (
          <g key={`${Math.round(t.x * 10)}-${i}`}>
            <line
              x1={t.x}
              y1={t.major ? 24 : t.medium ? 26 : 28}
              x2={t.x}
              y2={t.major ? 36 : t.medium ? 34 : 32}
              className={t.major ? "tick major" : t.medium ? "tick medium" : "tick"}
            />
            {t.label ? (
              <text x={t.x} y={16} className="direction">
                {t.label}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <div className="heading-pointer" aria-hidden>
        <span className="shaft" />
        <span className="triangle" />
      </div>
      <div className="heading-readout">{`${heading}°`}</div>
    </section>
  );
}

function Metric({
  label,
  value,
  unit,
  stale,
  coordinate,
}: {
  label: string;
  value?: string;
  unit?: string;
  stale?: boolean;
  coordinate?: { lat: string; lon: string } | null;
}) {
  return (
    <div className={`metric${coordinate ? " coordinate" : ""}${stale ? " stale" : ""}`}>
      <span className="metric-label">{label}</span>
      {coordinate ? (
        <div className="coords">
          <span>{coordinate.lat}</span>
          <span>{coordinate.lon}</span>
        </div>
      ) : (
        <>
          <span className="metric-value">{value ?? "—"}</span>
          {unit ? <span className="metric-unit">{unit}</span> : null}
        </>
      )}
    </div>
  );
}

export function MarineTopbar({
  emblemUrl,
  depth,
  sog,
  cog,
  headingDeg,
  hdgValue,
  hdgUnit,
  pos,
  cursor,
  depthStale,
  sogStale,
  cogStale,
  hdgStale,
  maximized,
  onMinimize,
  onMaximizeToggle,
  onClose,
}: {
  emblemUrl: string;
  depth: string;
  sog: string;
  cog: string;
  headingDeg: number | null;
  hdgValue: string;
  hdgUnit: string;
  pos: { lat: string; lon: string } | null;
  cursor: { lat: string; lon: string } | null;
  depthStale?: boolean;
  sogStale?: boolean;
  cogStale?: boolean;
  hdgStale?: boolean;
  maximized: boolean;
  onMinimize: () => void;
  onMaximizeToggle: () => void;
  onClose: () => void;
}) {
  const heading =
    headingDeg != null && Number.isFinite(headingDeg)
      ? Math.round(((headingDeg % 360) + 360) % 360)
      : 0;
  const unitClean = hdgUnit.replace(/°/g, "").trim() || "T";

  return (
    <header className="navigation-bar" id="navigationBar">
      <div className="logo-section">
        <img className="brand-logo" src={emblemUrl} alt="IRMARINETECH" draggable={false} />
      </div>

      <section className="left-metrics" aria-label="Seyir verileri">
        <Metric label="DEPTH" value={depth} unit="m" stale={depthStale} />
        <Metric label="SOG" value={sog} unit="kn" stale={sogStale} />
        <Metric label="COG" value={withDegree(cog)} stale={cogStale} />
      </section>

      <SvgCompass heading={heading} />

      <section className="right-metrics" aria-label="Konum ve yön bilgileri">
        <Metric label="HDG" value={withDegree(hdgValue)} unit={unitClean} stale={hdgStale} />
        <Metric label="POS" coordinate={pos} stale={!pos} />
        <Metric label="İMLEÇ POS" coordinate={cursor ?? { lat: "—", lon: "—" }} />
      </section>

      <nav className="window-controls" aria-label="Pencere kontrolleri">
        <button className="window-button" type="button" title="Simge durumuna küçült" aria-label="Simge durumuna küçült" onClick={onMinimize}>
          <svg viewBox="0 0 20 20">
            <path d="M4 10h12" />
          </svg>
        </button>
        <button
          className="window-button"
          type="button"
          title={maximized ? "Geri yükle" : "Ekranı kapla"}
          aria-label={maximized ? "Geri yükle" : "Ekranı kapla"}
          onClick={onMaximizeToggle}
        >
          {maximized ? (
            <svg viewBox="0 0 20 20">
              <path d="M6 8h8v8H6zM8 6h8v8" fill="none" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20">
              <rect x="4" y="4" width="12" height="12" rx="1.1" />
            </svg>
          )}
        </button>
        <button className="window-button close" type="button" title="Kapat" aria-label="Kapat" onClick={onClose}>
          <svg viewBox="0 0 20 20">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </nav>
    </header>
  );
}
