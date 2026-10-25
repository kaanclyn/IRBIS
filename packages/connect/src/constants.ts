export const DEFAULT_NMEA_UDP_PORT = 10110;

export interface NmeaEnvelope {
  sourceIp: string;
  port: number;
  payload: string;
  timestamp: string;
}
