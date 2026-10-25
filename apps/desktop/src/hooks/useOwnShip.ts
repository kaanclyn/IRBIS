import { useEffect, useState } from "react";
import { channelAgeMs, STALE_MS, type OwnShipState } from "@irbis/connect";

export type DisplayMetric = {
  value: string;
  unit?: string;
  stale: boolean;
  missing: boolean;
};

function fmt(n: number | undefined, digits: number): string {
  if (n === undefined || !Number.isFinite(n)) return "--";
  return n.toFixed(digits);
}

export function useOwnShip() {
  const [state, setState] = useState<OwnShipState | null>(null);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    if (window.irbis?.onOwnShip) {
      unsub = window.irbis.onOwnShip((payload) => {
        setState(payload as OwnShipState);
      });
    }
    void window.irbis?.getOwnShip?.().then((s) => {
      if (s) setState(s as OwnShipState);
    });
    return () => unsub?.();
  }, []);

  const now = Date.now();
  const mode = state?.mode ?? "simulation";

  const sogAge = channelAgeMs(state?.sogKn, now);
  const depthAge = channelAgeMs(state?.depthM, now);
  const cogAge = channelAgeMs(state?.cogDegTrue, now);
  const hdgAge = channelAgeMs(state?.headingDegTrue ?? state?.headingDegMagnetic, now);
  const posAge = Math.max(channelAgeMs(state?.lat, now), channelAgeMs(state?.lon, now));

  const metrics = {
    sog: {
      value: fmt(state?.sogKn?.value, 1),
      unit: "kn",
      stale: sogAge > STALE_MS.sog,
      missing: !state?.sogKn,
    } satisfies DisplayMetric,
    depth: {
      value: fmt(state?.depthM?.value, 1),
      unit: "m",
      stale: depthAge > STALE_MS.depth,
      missing: !state?.depthM,
    } satisfies DisplayMetric,
    // Prefer true COG; never substitute heading
    cog: {
      value: state?.cogDegTrue ? String(Math.round(state.cogDegTrue.value)) : "--",
      unit: "°T",
      stale: cogAge > STALE_MS.cog,
      missing: !state?.cogDegTrue,
    } satisfies DisplayMetric,
    hdg: {
      value: state?.headingDegTrue
        ? String(Math.round(state.headingDegTrue.value))
        : state?.headingDegMagnetic
          ? String(Math.round(state.headingDegMagnetic.value))
          : "--",
      unit: state?.headingDegTrue ? "°T" : state?.headingDegMagnetic ? "°M" : "",
      stale: hdgAge > STALE_MS.heading,
      missing: !state?.headingDegTrue && !state?.headingDegMagnetic,
    } satisfies DisplayMetric,
  };

  return {
    state,
    mode,
    metrics,
    position:
      state?.lat && state?.lon
        ? {
            lat: state.lat.value,
            lon: state.lon.value,
            stale: posAge > STALE_MS.position,
          }
        : null,
    msgPerSec: state?.msgPerSec ?? 0,
    udpPort: (state as { udpPort?: number } | null)?.udpPort ?? 10110,
  };
}
