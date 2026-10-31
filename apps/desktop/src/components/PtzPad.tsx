import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export type PtzDir = "up" | "down" | "left" | "right" | "home" | "zoomin" | "zoomout";
export type PtzHoldDir = Exclude<PtzDir, "home">;

const STORAGE_KEY = "irbis.ptzPad.open";
/** Bazı kameralar ContinuousMove’u kısa süre sonra keser — basılıyken yenile */
const HOLD_PULSE_MS = 450;

export function PtzPad({
  onHoldStart,
  onHoldEnd,
  onHome,
  label,
  ptzReady,
}: {
  onHoldStart: (dir: PtzHoldDir) => void;
  onHoldEnd: () => void;
  onHome: () => void;
  label: string;
  ptzReady?: boolean;
}) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [moving, setMoving] = useState(false);

  const holdingRef = useRef(false);
  const dirRef = useRef<PtzHoldDir | null>(null);
  const pulseRef = useRef<number | null>(null);
  const startRef = useRef(onHoldStart);
  const endRef = useRef(onHoldEnd);
  startRef.current = onHoldStart;
  endRef.current = onHoldEnd;

  const clearPulse = () => {
    if (pulseRef.current != null) {
      window.clearInterval(pulseRef.current);
      pulseRef.current = null;
    }
  };

  const stopHold = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    dirRef.current = null;
    clearPulse();
    setMoving(false);
    endRef.current();
  }, []);

  // Sadece unmount’ta dinleyicileri temizle — dependency değişince stop ÇAĞIRMA
  useEffect(() => {
    const onUp = () => stopHold();
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("blur", onUp);
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("blur", onUp);
      clearPulse();
      if (holdingRef.current) {
        holdingRef.current = false;
        endRef.current();
      }
    };
  }, [stopHold]);

  const beginHold = (dir: PtzHoldDir, el: HTMLButtonElement, pointerId: number) => {
    try {
      el.setPointerCapture(pointerId);
    } catch {
      /* ignore */
    }
    holdingRef.current = true;
    dirRef.current = dir;
    setMoving(true);
    startRef.current(dir);
    clearPulse();
    pulseRef.current = window.setInterval(() => {
      if (!holdingRef.current || !dirRef.current) return;
      startRef.current(dirRef.current);
    }, HOLD_PULSE_MS);
  };

  const bindHold = (dir: PtzHoldDir) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (!ptzReady) return;
      e.preventDefault();
      e.stopPropagation();
      // Aynı anda tek eksen
      if (holdingRef.current) stopHold();
      beginHold(dir, e.currentTarget, e.pointerId);
    },
    onPointerUp: (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      stopHold();
    },
    onLostPointerCapture: () => {
      stopHold();
    },
  });

  const toggleOpen = () => {
    setOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      if (!next) stopHold();
      return next;
    });
  };

  if (!open) {
    return (
      <div className="ptz-pad ptz-pad-collapsed" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" className="ptz-fab" title="PTZ aç" aria-label="PTZ joystick aç" onClick={toggleOpen}>
          <span className="ptz-fab-ring" aria-hidden />
          <span className="ptz-fab-label">PTZ</span>
        </button>
      </div>
    );
  }

  return (
    <div
      className={`ptz-pad ptz-pad-open${ptzReady ? " ready" : ""}${moving ? " moving" : ""}`}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="ptz-meta">
        <div className="ptz-meta-text">
          <strong>{label}</strong>
          <small>{ptzReady ? "Basılı tut · bırak = stop" : "PTZ yok"}</small>
        </div>
        <button type="button" className="ptz-collapse" title="Küçült" aria-label="PTZ kapat" onClick={toggleOpen}>
          −
        </button>
      </div>

      <div className="ptz-cross" role="group" aria-label="PTZ joystick">
        <button type="button" className="ptz-btn n" aria-label="Yukarı" disabled={!ptzReady} {...bindHold("up")}>
          ▲
        </button>
        <button type="button" className="ptz-btn w" aria-label="Sol" disabled={!ptzReady} {...bindHold("left")}>
          ◀
        </button>
        <button
          type="button"
          className="ptz-btn home"
          aria-label="Ana konum"
          disabled={!ptzReady}
          onClick={(e) => {
            e.stopPropagation();
            stopHold();
            onHome();
          }}
        >
          ⌂
        </button>
        <button type="button" className="ptz-btn e" aria-label="Sağ" disabled={!ptzReady} {...bindHold("right")}>
          ▶
        </button>
        <button type="button" className="ptz-btn s" aria-label="Aşağı" disabled={!ptzReady} {...bindHold("down")}>
          ▼
        </button>
      </div>

      <div className="ptz-zoom">
        <button type="button" aria-label="Zoom +" disabled={!ptzReady} {...bindHold("zoomin")}>
          +
        </button>
        <button type="button" aria-label="Zoom −" disabled={!ptzReady} {...bindHold("zoomout")}>
          −
        </button>
      </div>
    </div>
  );
}
