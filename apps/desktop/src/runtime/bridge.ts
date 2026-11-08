import type { ChartConfig } from "../chart/ChartMap";

/** True when Electron preload exposed `window.irbis`. */
export function hasElectronBridge(): boolean {
  return typeof window !== "undefined" && typeof window.irbis?.getChartConfig === "function";
}

/** Electron webBridgeServer (CORS *). Prefer direct URL over Vite proxy for SSE. */
const WEB_API = "http://127.0.0.1:18769";

/** Tuzla / Marmara demo center used by Navionics offline cache. */
const WEB_CENTER: [number, number] = [29.2768, 40.82281];

/**
 * Browser preview config. Works when `npm run dev` also started Electron
 * (Navionics tile server on :18765). Vite proxies `/navionics` → that port.
 */
export function webPreviewChartConfig(): ChartConfig {
  const tileUrl = "/navionics/{z}/{x}/{y}.png";
  const sonarUrl = "/sonar/{z}/{x}/{y}.png";
  return {
    baseUrl: "",
    pmtilesPath: "",
    stylePath: "style.json",
    spritePath: "sprites/sprites",
    center: WEB_CENTER,
    zoom: 12.2,
    worldCenter: WEB_CENTER,
    worldZoom: 11.5,
    cellName: "NAVIONICS",
    mode: "web-preview",
    bakeReady: true,
    mapMode: "navionics",
    hideWorldBasemap: true,
    readyCells: [],
    navionics: {
      tileUrl,
      sonarUrl,
      offlineOnly: true,
    },
    warning: "Web önizleme · Navionics (Electron tile server gerekir)",
    displayLabel: "Web · Navionics",
  };
}

export async function resolveChartConfig(): Promise<ChartConfig> {
  if (hasElectronBridge()) {
    const cfg = await window.irbis!.getChartConfig();
    if (!cfg) throw new Error("Chart config IPC boş");
    return cfg as ChartConfig;
  }
  return webPreviewChartConfig();
}

type LiveHandlers = {
  onOwnShip?: (payload: unknown) => void;
  onAis?: (payload: unknown) => void;
  onMap?: (payload: unknown) => void;
};

type WebBus = {
  ownShipHandlers: Set<(payload: unknown) => void>;
  aisHandlers: Set<(payload: unknown) => void>;
  mapHandlers: Set<(payload: unknown) => void>;
  es: EventSource | null;
  pollTimer: number | undefined;
  refCount: number;
};

async function webPost(path: string, body: unknown = {}) {
  const res = await fetch(`${WEB_API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string })?.error || `HTTP ${res.status}`);
  return data;
}

export async function getMapCatalog() {
  if (hasElectronBridge()) return window.irbis!.getMapCatalog();
  const res = await fetch(`${WEB_API}/api/map-catalog`);
  if (!res.ok) throw new Error(`map-catalog HTTP ${res.status}`);
  return res.json();
}

export async function setMapEngine(engine: string) {
  if (hasElectronBridge()) return window.irbis!.setMapEngine(engine);
  return webPost("/api/map-engine", { engine });
}

export async function setNautilusCell(cellId: string) {
  if (hasElectronBridge()) return window.irbis!.setNautilusCell(cellId);
  return webPost("/api/nautilus-cell", { cellId });
}

export async function nautilusRescan() {
  if (hasElectronBridge()) return window.irbis!.nautilusRescan();
  const r = (await webPost("/api/nautilus-rescan", {})) as { cells?: unknown };
  return r.cells ?? [];
}

export async function nautilusSetViewport(payload: Record<string, unknown>) {
  if (hasElectronBridge()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return window.irbis!.nautilusSetViewport(payload as any);
  }
  return webPost("/api/nautilus-set-viewport", payload);
}

export async function nautilusPick(payload: Record<string, unknown>) {
  if (hasElectronBridge()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return window.irbis!.nautilusPick(payload as any);
  }
  return webPost("/api/nautilus-pick", payload);
}

let webBus: WebBus | null = null;

async function pullWebOnce(bus: WebBus) {
  try {
    const [ownRes, aisRes] = await Promise.all([
      fetch(`${WEB_API}/api/ownship`),
      fetch(`${WEB_API}/api/ais`),
    ]);
    if (ownRes.ok) {
      const body = await ownRes.json();
      for (const h of bus.ownShipHandlers) h(body);
    }
    if (aisRes.ok) {
      const body = await aisRes.json();
      for (const h of bus.aisHandlers) h(body);
    }
  } catch {
    /* Electron not up yet */
  }
}

function ensureWebBus(): WebBus {
  if (webBus) return webBus;
  const bus: WebBus = {
    ownShipHandlers: new Set(),
    aisHandlers: new Set(),
    mapHandlers: new Set(),
    es: null,
    pollTimer: undefined,
    refCount: 0,
  };
  webBus = bus;

  void pullWebOnce(bus);

  try {
    const es = new EventSource(`${WEB_API}/api/events`);
    bus.es = es;
    es.addEventListener("ownship", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        for (const h of bus.ownShipHandlers) h(data);
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("ais", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        for (const h of bus.aisHandlers) h(data);
      } catch {
        /* ignore */
      }
    });
    es.addEventListener("map", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        for (const h of bus.mapHandlers) h(data);
      } catch {
        /* ignore */
      }
    });
    es.onerror = () => {
      if (bus.pollTimer != null) return;
      bus.pollTimer = window.setInterval(() => void pullWebOnce(bus), 1000);
    };
    es.onopen = () => {
      if (bus.pollTimer != null) {
        window.clearInterval(bus.pollTimer);
        bus.pollTimer = undefined;
      }
    };
  } catch {
    bus.pollTimer = window.setInterval(() => void pullWebOnce(bus), 1000);
  }

  return bus;
}

function releaseWebBus() {
  if (!webBus) return;
  webBus.refCount -= 1;
  if (webBus.refCount > 0) return;
  webBus.es?.close();
  if (webBus.pollTimer != null) window.clearInterval(webBus.pollTimer);
  webBus = null;
}

/**
 * Subscribe to ownship + AIS. Electron IPC when available; else SSE on :18769.
 */
export function subscribeLiveNav(handlers: LiveHandlers): () => void {
  if (hasElectronBridge()) {
    const unsubs: Array<() => void> = [];
    if (handlers.onOwnShip && window.irbis?.onOwnShip) {
      unsubs.push(window.irbis.onOwnShip(handlers.onOwnShip));
    }
    if (handlers.onAis && window.irbis?.onAis) {
      unsubs.push(window.irbis.onAis(handlers.onAis));
    }
    if (handlers.onMap && window.irbis?.onMapEngineChanged) {
      unsubs.push(
        window.irbis.onMapEngineChanged(() => {
          void getMapCatalog().then((c) => handlers.onMap?.(c));
        }),
      );
    }
    void window.irbis?.getOwnShip?.().then((s) => {
      if (s) handlers.onOwnShip?.(s);
    });
    void window.irbis?.getAis?.().then((s) => {
      if (s) handlers.onAis?.(s);
    });
    if (handlers.onMap) void getMapCatalog().then((c) => handlers.onMap?.(c));
    return () => unsubs.forEach((u) => u());
  }

  const bus = ensureWebBus();
  bus.refCount += 1;
  if (handlers.onOwnShip) bus.ownShipHandlers.add(handlers.onOwnShip);
  if (handlers.onAis) bus.aisHandlers.add(handlers.onAis);
  if (handlers.onMap) bus.mapHandlers.add(handlers.onMap);
  if (handlers.onMap) void getMapCatalog().then((c) => handlers.onMap?.(c)).catch(() => undefined);

  return () => {
    if (handlers.onOwnShip) bus.ownShipHandlers.delete(handlers.onOwnShip);
    if (handlers.onAis) bus.aisHandlers.delete(handlers.onAis);
    if (handlers.onMap) bus.mapHandlers.delete(handlers.onMap);
    releaseWebBus();
  };
}
