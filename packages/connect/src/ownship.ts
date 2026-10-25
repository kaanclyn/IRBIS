import type { ParsedOwnShipPatch } from "./parse0183";

export type DataMode = "simulation" | "live";

export interface ChannelStamp {
  value: number;
  receivedAtUtc: string;
  source: string;
}

export interface OwnShipState {
  mode: DataMode;
  lat?: ChannelStamp;
  lon?: ChannelStamp;
  sogKn?: ChannelStamp;
  cogDegTrue?: ChannelStamp;
  cogDegMagnetic?: ChannelStamp;
  headingDegTrue?: ChannelStamp;
  headingDegMagnetic?: ChannelStamp;
  depthM?: ChannelStamp;
  lastSentenceAtUtc?: string;
  msgPerSec: number;
  checksumErrors: number;
}

export function createEmptyOwnShip(mode: DataMode = "simulation"): OwnShipState {
  return { mode, msgPerSec: 0, checksumErrors: 0 };
}

function stamp(value: number, source: string, at: string): ChannelStamp {
  return { value, receivedAtUtc: at, source };
}

export function applyOwnShipPatch(
  state: OwnShipState,
  patch: ParsedOwnShipPatch,
  source: string,
  atUtc: string = new Date().toISOString(),
): OwnShipState {
  const next: OwnShipState = { ...state, lastSentenceAtUtc: atUtc };
  if (patch.lat !== undefined) next.lat = stamp(patch.lat, source, atUtc);
  if (patch.lon !== undefined) next.lon = stamp(patch.lon, source, atUtc);
  if (patch.sogKn !== undefined) next.sogKn = stamp(patch.sogKn, source, atUtc);
  if (patch.cogDegTrue !== undefined) next.cogDegTrue = stamp(patch.cogDegTrue, source, atUtc);
  if (patch.cogDegMagnetic !== undefined) next.cogDegMagnetic = stamp(patch.cogDegMagnetic, source, atUtc);
  if (patch.headingDegTrue !== undefined) next.headingDegTrue = stamp(patch.headingDegTrue, source, atUtc);
  if (patch.headingDegMagnetic !== undefined) next.headingDegMagnetic = stamp(patch.headingDegMagnetic, source, atUtc);
  if (patch.depthM !== undefined) next.depthM = stamp(patch.depthM, source, atUtc);
  return next;
}

export function channelAgeMs(ch: ChannelStamp | undefined, nowMs: number = Date.now()): number {
  if (!ch) return Number.POSITIVE_INFINITY;
  const t = Date.parse(ch.receivedAtUtc);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, nowMs - t);
}

export const STALE_MS = {
  position: 3000,
  sog: 3000,
  cog: 3000,
  heading: 2000,
  depth: 5000,
} as const;
