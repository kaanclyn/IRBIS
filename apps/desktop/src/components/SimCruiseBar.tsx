import { useCallback, useEffect, useRef, useState } from "react";

type SimStatus = {
  running?: boolean;
  speedKn?: number;
  segIndex?: number;
  waypointCount?: number;
  lat?: number;
  lon?: number;
  route?: Array<{ lat: number; lon: number; name?: string | null }>;
};

export function SimCruiseBar({
  follow,
  onFollowChange,
  onRoute,
  onRunningChange,
}: {
  follow: boolean;
  onFollowChange: (v: boolean) => void;
  onRoute?: (route: Array<{ lat: number; lon: number; name?: string | null }>) => void;
  onRunningChange?: (running: boolean) => void;
}) {
  const [status, setStatus] = useState<SimStatus>({ running: false, speedKn: 12 });
  const [speed, setSpeedLocal] = useState(12);
  const [busy, setBusy] = useState(false);
  const dragging = useRef(false);

  const applyStatus = useCallback(
    (s: SimStatus) => {
      setStatus(s);
      if (!dragging.current && Number.isFinite(s.speedKn)) {
        setSpeedLocal(Math.round(Number(s.speedKn)));
      }
      onRunningChange?.(!!s.running);
      if (s.running && s.route?.length) onRoute?.(s.route);
      if (!s.running) onRoute?.([]);
    },
    [onRoute, onRunningChange]
  );

  const refresh = useCallback(async () => {
    const s = await window.irbis?.simStatus?.();
    if (s) applyStatus(s);
  }, [applyStatus]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 800);
    return () => window.clearInterval(id);
  }, [refresh]);

  const applySpeed = async (kn: number) => {
    const next = Math.max(1, Math.min(80, Math.round(kn)));
    setSpeedLocal(next);
    const r = await window.irbis?.simControl?.({ action: "setSpeed", speedKn: next });
    if (r) applyStatus({ ...status, ...r, speedKn: r.speedKn ?? next });
  };

  const startOrResume = async (reset: boolean) => {
    setBusy(true);
    try {
      const r = await window.irbis?.simControl?.({
        action: reset ? "restart" : "start",
        speedKn: speed,
        reset,
      });
      if (r) {
        applyStatus(r);
        if (Number.isFinite(r.lat) && Number.isFinite(r.lon)) {
          window.dispatchEvent(
            new CustomEvent("irbis:map-center", { detail: { lat: r.lat, lon: r.lon } })
          );
        }
      }
      onFollowChange(true);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      const r = await window.irbis?.simControl?.({ action: "stop" });
      if (r) applyStatus(r);
      else {
        applyStatus({ ...status, running: false });
      }
    } finally {
      setBusy(false);
    }
  };

  const running = !!status.running;
  const wp = status.waypointCount ?? 0;
  const seg = (status.segIndex ?? 0) + 1;

  return (
    <div className="sim-panel" role="group" aria-label="Seyir simülatörü">
      <div className="sim-panel-top">
        <div>
          <div className="sim-panel-kicker">Test</div>
          <div className="sim-panel-title">Seyir simülatörü</div>
        </div>
        <span className={`sim-badge${running ? " live" : ""}`}>
          {running ? `WP ${seg}/${wp || "—"}` : "Hazır"}
        </span>
      </div>

      <p className="sim-panel-desc">
        Canlı NMEA gibi konum akar. Durdurunca yer korunur; Baştan rotanın başına döner.
      </p>

      <div className="sim-row sim-row-actions">
        {running ? (
          <button
            type="button"
            className="sim-btn danger"
            disabled={busy}
            onClick={() => void stop()}
          >
            <span className="sim-stop-sq" aria-hidden />
            Durdur
          </button>
        ) : (
          <button
            type="button"
            className="sim-btn primary"
            disabled={busy}
            onClick={() => void startOrResume(false)}
          >
            Devam et
          </button>
        )}
        <button
          type="button"
          className="sim-btn ghost"
          disabled={busy}
          onClick={() => void startOrResume(true)}
        >
          Baştan
        </button>
      </div>

      <div className="sim-field">
        <div className="sim-field-label">
          <span>Hız</span>
          <strong>{speed} kn</strong>
        </div>
        <div className="sim-speed">
          <button type="button" className="sim-nudge" onClick={() => void applySpeed(speed - 5)}>
            −
          </button>
          <input
            type="range"
            min={1}
            max={80}
            step={1}
            value={speed}
            onPointerDown={() => {
              dragging.current = true;
            }}
            onPointerUp={() => {
              dragging.current = false;
            }}
            onChange={(e) => void applySpeed(Number(e.target.value))}
          />
          <button type="button" className="sim-nudge" onClick={() => void applySpeed(speed + 5)}>
            +
          </button>
        </div>
      </div>

      <label className="sim-check">
        <input
          type="checkbox"
          checked={follow}
          onChange={(e) => onFollowChange(e.target.checked)}
        />
        <span>
          Harita takibi
          <em>Kenara gelince yeni frame</em>
        </span>
      </label>
    </div>
  );
}
