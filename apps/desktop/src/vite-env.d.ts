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
}

interface Window {
  irbis?: IrbisApi;
}
