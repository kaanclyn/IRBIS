/// <reference types="vite/client" />

interface ChartConfig {
  baseUrl: string;
  pmtilesPath: string;
  stylePath: string;
  spritePath: string;
  center: [number, number];
  zoom: number;
  cellName: string;
  mode: string;
  bakeReady?: boolean;
  warning?: string;
  worldCenter?: [number, number];
  worldZoom?: number;
  s63Detected?: boolean;
  userPermitCount?: number;
  /** When true, skip external world basemap — solid void / ENC only (offline). */
  hideWorldBasemap?: boolean;
  mapMode?: "navionics" | "s57-lab" | string;
  navionics?: {
    tileUrl: string;
    sonarUrl?: string | null;
    cacheDir?: string;
    offlineOnly?: boolean;
    cache?: { count?: number; bytesMb?: number };
  } | null;
  readyCells?: Array<{
    name: string;
    pmtilesPath: string;
    center?: [number, number];
    zoom?: number;
    bbox?: [number, number, number, number] | null;
  }>;
}

interface ChartLibraryCell {
  name: string;
  band?: number;
  updateNo?: number;
  path: string;
  bakeStatus: string;
  permitStatus: string;
  pmtilesPath?: string;
  error?: string;
  encrypted?: boolean;
}

interface ChartLibrarySnapshot {
  encRoot: string;
  bakeRoot: string;
  permitRoot?: string;
  activeCell: string;
  cells: ChartLibraryCell[];
  stylePath: string;
  spritePath: string;
  s63Detected?: boolean;
  s63Reason?: string | null;
  userPermitCount?: number;
  cellCount?: number;
  trCellCount?: number;
}

interface CameraStreamInfo {
  profileToken: string;
  profileName?: string;
  playUrl: string | null;
  hasRtsp: boolean;
}

interface CameraDevicePublic {
  id: string;
  name: string;
  host: string;
  port: number;
  username?: string;
  manufacturer?: string | null;
  model?: string | null;
  streams: {
    visible: CameraStreamInfo | null;
    thermal: CameraStreamInfo | null;
  };
  capabilities: { ptz: boolean };
  status: string;
  lastSeenAt?: string | null;
  error?: string | null;
}

interface CameraSnapshot {
  activeId: string | null;
  activeStream: "visible" | "thermal";
  cameras: CameraDevicePublic[];
  count: number;
}

interface CameraDiscoverHit {
  hostname: string;
  port: number;
  name?: string;
  xaddrs?: unknown[];
}

interface IrbisApi {
  getAppInfo: () => Promise<{ name: string; version: string; platform: string; logPath?: string }>;
  getChartConfig: () => Promise<ChartConfig>;
  getChartLibrary: () => Promise<ChartLibrarySnapshot>;
  pickEncFolder: () => Promise<{ canceled: boolean; library: ChartLibrarySnapshot }>;
  setActiveCell: (name: string) => Promise<{ ok: boolean; error?: string; library: ChartLibrarySnapshot }>;
  rescanCharts: () => Promise<ChartLibrarySnapshot>;
  getOwnShip: () => Promise<unknown>;
  getAis: () => Promise<unknown>;
  windowMinimize: () => Promise<void>;
  windowMaximizeToggle: () => Promise<{ maximized: boolean }>;
  windowClose: () => Promise<void>;
  windowIsMaximized: () => Promise<{ maximized: boolean }>;
  onOwnShip: (handler: (payload: unknown) => void) => () => void;
  onAis: (handler: (payload: unknown) => void) => () => void;
  onChartChanged: (handler: (payload: unknown) => void) => () => void;
  onWindowState: (handler: (payload: unknown) => void) => () => void;
  cameraList: () => Promise<CameraSnapshot>;
  cameraDiscover: (opts?: { timeoutMs?: number }) => Promise<CameraDiscoverHit[]>;
  cameraAdd: (payload: {
    host: string;
    port?: number;
    username: string;
    password: string;
    name?: string;
  }) => Promise<CameraSnapshot>;
  cameraRemove: (id: string) => Promise<CameraSnapshot | undefined>;
  cameraSetActive: (id: string) => Promise<{ ok: boolean; error?: string } & Partial<CameraSnapshot>>;
  cameraSetStream: (kind: "visible" | "thermal") => Promise<CameraSnapshot | null>;
  cameraRefresh: (id: string) => Promise<CameraSnapshot | undefined>;
  cameraPtz: (payload: {
    id: string;
    action: "up" | "down" | "left" | "right" | "zoomin" | "zoomout" | "home" | "stop";
    speed?: number;
  }) => Promise<{ ok: boolean; error?: string }>;
  onCameras: (handler: (payload: CameraSnapshot) => void) => () => void;
}

interface Window {
  irbis?: IrbisApi;
}
