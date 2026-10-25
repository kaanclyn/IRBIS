export { DEFAULT_NMEA_UDP_PORT } from "./constants";
export type { NmeaEnvelope } from "./constants";
export { nmeaChecksumOk, stripNmea } from "./checksum";
export { parseNmea0183Line, sentenceType } from "./parse0183";
export type { ParsedOwnShipPatch } from "./parse0183";
export {
  applyOwnShipPatch,
  channelAgeMs,
  createEmptyOwnShip,
  STALE_MS,
} from "./ownship";
export type { ChannelStamp, DataMode, OwnShipState } from "./ownship";
export { createSimulatorOwnShipTick } from "./sim";
