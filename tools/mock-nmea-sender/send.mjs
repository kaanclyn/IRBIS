/**
 * Minimal UDP NMEA 0183 mock → 127.0.0.1:10110 (SEAPIR-compatible port).
 * Usage: npm start -w @irbis/mock-nmea-sender
 */
import dgram from "node:dgram";

const PORT = Number(process.env.NMEA_PORT ?? 10110);
const HOST = process.env.NMEA_HOST ?? "127.0.0.1";

const socket = dgram.createSocket("udp4");

function checksum(body) {
  let cs = 0;
  for (let i = 0; i < body.length; i += 1) cs ^= body.charCodeAt(i);
  return cs.toString(16).toUpperCase().padStart(2, "0");
}

function sentence(body) {
  return `$${body}*${checksum(body)}\r\n`;
}

let sog = 7.2;
let hdg = 181;
let t = 0;

function toNmeaDm(deg, isLat) {
  const hemi = isLat ? (deg >= 0 ? "N" : "S") : deg >= 0 ? "E" : "W";
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const m = (abs - d) * 60;
  const width = isLat ? 2 : 3;
  return {
    dm: `${String(d).padStart(width, "0")}${m.toFixed(3).padStart(6, "0")}`,
    hemi,
  };
}

setInterval(() => {
  t += 1;
  sog = 7 + Math.sin(Date.now() / 5000) * 0.4;
  hdg = (hdg + 0.2) % 360;
  const lat = 39.241 + Math.sin(t / 40) * 0.002;
  const lon = -76.549 + Math.cos(t / 55) * 0.003;
  const la = toNmeaDm(lat, true);
  const lo = toNmeaDm(lon, false);
  const depth = (11.6 + Math.sin(t / 12) * 0.8).toFixed(1);

  const rmcBody = `GPRMC,123519,A,${la.dm},${la.hemi},${lo.dm},${lo.hemi},${sog.toFixed(1)},179.0,230526,,,A`;
  const hdtBody = `GPHDT,${hdg.toFixed(1)},T`;
  const dptBody = `SDDPT,${depth},`;

  for (const body of [rmcBody, hdtBody, dptBody]) {
    const msg = Buffer.from(sentence(body), "ascii");
    socket.send(msg, PORT, HOST);
  }
}, 1000);

console.log(`Mock NMEA → udp://${HOST}:${PORT}`);
