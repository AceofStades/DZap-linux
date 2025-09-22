const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  detectDrives: () => ipcRenderer.invoke("detect-drives"),
  quickWipe: (drive) => ipcRenderer.invoke("quick-wipe", drive),
  onBackendLog: (callback) => ipcRenderer.on("backend-log", (_, log) => callback(log)),
  advancedWipe: (drive) => ipcRenderer.invoke("advanced-wipe", drive),
  onLog: (callback) => ipcRenderer.on("log", (_, msg) => callback(msg)),
});
