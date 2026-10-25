/** Canonical measurement envelope — ageMs is computed at read time, not stored frozen. */

export type Quality = "measured" | "estimated" | "simulated" | "stale" | "invalid";

export interface MeasurementEnvelope<T = number> {
  path: string;
  value: T;
  unit: string;
  source: string;
  receivedAtUtc: string;
  valid: boolean;
  quality: Quality;
}

export function ageMs(envelope: MeasurementEnvelope, nowMs: number = Date.now()): number {
  const received = Date.parse(envelope.receivedAtUtc);
  if (Number.isNaN(received)) return Number.POSITIVE_INFINITY;
  return Math.max(0, nowMs - received);
}

export function withFreshness<T>(
  envelope: MeasurementEnvelope<T>,
  staleAfterMs: number,
  nowMs: number = Date.now(),
): MeasurementEnvelope<T> & { ageMs: number } {
  const age = ageMs(envelope, nowMs);
  const stale = age > staleAfterMs;
  return {
    ...envelope,
    ageMs: age,
    valid: envelope.valid && !stale,
    quality: stale ? "stale" : envelope.quality,
  };
}

/** Paths — headingTrue / headingMagnetic / COG must never be aliased. */
export const Paths = {
  position: "navigation.position",
  sog: "navigation.speedOverGround",
  cogTrue: "navigation.courseOverGroundTrue",
  cogMagnetic: "navigation.courseOverGroundMagnetic",
  headingTrue: "navigation.headingTrue",
  headingMagnetic: "navigation.headingMagnetic",
  depth: "environment.depth.belowTransducer",
  time: "navigation.datetime",
} as const;

export type LatLon = { lat: number; lon: number };

export interface OwnShipSnapshot {
  position?: MeasurementEnvelope<LatLon>;
  sogKn?: MeasurementEnvelope<number>;
  cogDegMagnetic?: MeasurementEnvelope<number>;
  cogDegTrue?: MeasurementEnvelope<number>;
  headingDegMagnetic?: MeasurementEnvelope<number>;
  headingDegTrue?: MeasurementEnvelope<number>;
  depthM?: MeasurementEnvelope<number>;
  mode: "simulation" | "live";
}

export type SourceChannel =
  | "gps"
  | "sog"
  | "cog"
  | "heading"
  | "depth";

export interface SourcePriorityConfig {
  channel: SourceChannel;
  /** Higher index = lower priority. First match wins. */
  orderedSources: string[];
}

export const DEFAULT_STALE_MS: Record<SourceChannel, number> = {
  gps: 3000,
  sog: 3000,
  cog: 3000,
  heading: 2000,
  depth: 5000,
};
