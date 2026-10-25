const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("irbis", {
  getAppInfo: () => ipcRenderer.invoke("irbis:get-app-info"),
  getChartConfig: () => ipcRenderer.invoke("irbis:get-chart-config"),
  getChartLibrary: () => ipcRenderer.invoke("irbis:get-chart-library"),
  pickEncFolder: () => ipcRenderer.invoke("irbis:pick-enc-folder"),
  setActiveCell: (name) => ipcRenderer.invoke("irbis:set-active-cell", name),
  rescanCharts: () => ipcRenderer.invoke("irbis:rescan-charts"),
  getOwnShip: () => ipcRenderer.invoke("irbis:get-ownship"),
  getAis: () => ipcRenderer.invoke("irbis:get-ais"),
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
});
