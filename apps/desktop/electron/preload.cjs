const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("irbis", {
  getAppInfo: () => ipcRenderer.invoke("irbis:get-app-info"),
  getChartConfig: () => ipcRenderer.invoke("irbis:get-chart-config"),
  getChartLibrary: () => ipcRenderer.invoke("irbis:get-chart-library"),
  getMapCatalog: () => ipcRenderer.invoke("irbis:get-map-catalog"),
  setMapEngine: (engine) => ipcRenderer.invoke("irbis:set-map-engine", engine),
  setNautilusCell: (cellId) => ipcRenderer.invoke("irbis:set-nautilus-cell", cellId),
  nautilusRender: (payload) => ipcRenderer.invoke("irbis:nautilus-render", payload),
  nautilusSetViewport: (payload) => ipcRenderer.invoke("irbis:nautilus-set-viewport", payload),
  nautilusCacheLookup: (payload) => ipcRenderer.invoke("irbis:nautilus-cache-lookup", payload),
  nautilusEnsureTile: (payload) => ipcRenderer.invoke("irbis:nautilus-ensure-tile", payload),
  nautilusPick: (payload) => ipcRenderer.invoke("irbis:nautilus-pick", payload),
  nautilusRescan: () => ipcRenderer.invoke("irbis:nautilus-rescan"),
  pickEncFolder: () => ipcRenderer.invoke("irbis:pick-enc-folder"),
  setActiveCell: (name) => ipcRenderer.invoke("irbis:set-active-cell", name),
  rescanCharts: () => ipcRenderer.invoke("irbis:rescan-charts"),
  onMapEngineChanged: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("irbis:map-engine-changed", listener);
    return () => ipcRenderer.removeListener("irbis:map-engine-changed", listener);
  },
  getOwnShip: () => ipcRenderer.invoke("irbis:get-ownship"),
  getAis: () => ipcRenderer.invoke("irbis:get-ais"),
  simControl: (cmd) => ipcRenderer.invoke("irbis:sim-control", cmd),
  simStatus: () => ipcRenderer.invoke("irbis:sim-status"),
  windowMinimize: () => ipcRenderer.invoke("irbis:window-minimize"),
  windowMaximizeToggle: () => ipcRenderer.invoke("irbis:window-maximize-toggle"),
  windowClose: () => ipcRenderer.invoke("irbis:window-close"),
  windowIsMaximized: () => ipcRenderer.invoke("irbis:window-is-maximized"),
  onOwnShip: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("irbis:ownship", listener);
    return () => ipcRenderer.removeListener("irbis:ownship", listener);
  },
  onAis: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("irbis:ais", listener);
    return () => ipcRenderer.removeListener("irbis:ais", listener);
  },
  onChartChanged: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("irbis:chart-changed", listener);
    return () => ipcRenderer.removeListener("irbis:chart-changed", listener);
  },
  onWindowState: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("irbis:window-state", listener);
    return () => ipcRenderer.removeListener("irbis:window-state", listener);
  },
  cameraList: () => ipcRenderer.invoke("irbis:camera-list"),
  cameraDiscover: (opts) => ipcRenderer.invoke("irbis:camera-discover", opts),
  cameraAdd: (payload) => ipcRenderer.invoke("irbis:camera-add", payload),
  cameraRemove: (id) => ipcRenderer.invoke("irbis:camera-remove", id),
  cameraSetActive: (id) => ipcRenderer.invoke("irbis:camera-set-active", id),
  cameraSetStream: (kind) => ipcRenderer.invoke("irbis:camera-set-stream", kind),
  cameraRefresh: (id) => ipcRenderer.invoke("irbis:camera-refresh", id),
  cameraPtz: (payload) => ipcRenderer.invoke("irbis:camera-ptz", payload),
  onCameras: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("irbis:cameras", listener);
    return () => ipcRenderer.removeListener("irbis:cameras", listener);
  },
});
