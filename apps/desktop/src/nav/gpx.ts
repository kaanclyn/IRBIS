import type { Waypoint } from "./types";

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Build a minimal GPX 1.1 route document from waypoints. */
export function waypointsToGpx(waypoints: Waypoint[], routeName = "IRBIS Rota"): string {
  const wpts = waypoints
    .map(
      (w) =>
        `  <wpt lat="${w.lat.toFixed(7)}" lon="${w.lon.toFixed(7)}">\n` +
        `    <name>${escXml(w.name)}</name>\n` +
        `  </wpt>`,
    )
    .join("\n");

  const rtePts = waypoints
    .map(
      (w) =>
        `    <rtept lat="${w.lat.toFixed(7)}" lon="${w.lon.toFixed(7)}">\n` +
        `      <name>${escXml(w.name)}</name>\n` +
        `    </rtept>`,
    )
    .join("\n");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="IRBIS" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    `  <metadata><name>${escXml(routeName)}</name></metadata>\n` +
    `${wpts}\n` +
    `  <rte>\n` +
    `    <name>${escXml(routeName)}</name>\n` +
    `${rtePts}\n` +
    `  </rte>\n` +
    `</gpx>\n`
  );
}

function parseLatLon(el: Element): { lat: number; lon: number } | null {
  const lat = Number(el.getAttribute("lat"));
  const lon = Number(el.getAttribute("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

function nameOf(el: Element, fallback: string): string {
  const n = el.getElementsByTagName("name")[0]?.textContent?.trim();
  return n || fallback;
}

/** Parse wpt / rtept / trkpt from a GPX string into waypoints (skeleton). */
export function gpxToWaypoints(xml: string): Waypoint[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("GPX ayrıştırılamadı");
  }

  const out: Waypoint[] = [];
  const seen = new Set<string>();

  const push = (lat: number, lon: number, name: string) => {
    const key = `${lat.toFixed(6)},${lon.toFixed(6)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      id: `wp-${Date.now()}-${out.length}`,
      lat,
      lon,
      name,
    });
  };

  const rtepts = Array.from(doc.getElementsByTagName("rtept"));
  if (rtepts.length > 0) {
    rtepts.forEach((el, i) => {
      const ll = parseLatLon(el);
      if (ll) push(ll.lat, ll.lon, nameOf(el, `WP ${i + 1}`));
    });
    return out;
  }

  const trkpts = Array.from(doc.getElementsByTagName("trkpt"));
  if (trkpts.length > 0) {
    trkpts.forEach((el, i) => {
      const ll = parseLatLon(el);
      if (ll) push(ll.lat, ll.lon, nameOf(el, `WP ${i + 1}`));
    });
    return out;
  }

  Array.from(doc.getElementsByTagName("wpt")).forEach((el, i) => {
    const ll = parseLatLon(el);
    if (ll) push(ll.lat, ll.lon, nameOf(el, `WP ${i + 1}`));
  });

  return out;
}

export function downloadGpx(waypoints: Waypoint[], filename = "irbis-rota.gpx"): void {
  const body = waypointsToGpx(waypoints);
  const blob = new Blob([body], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function pickGpxFile(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".gpx,application/gpx+xml,text/xml";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error("Dosya seçilmedi"));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("GPX okunamadı"));
      reader.readAsText(file);
    };
    input.click();
  });
}
