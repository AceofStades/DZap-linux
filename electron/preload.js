const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
	getDevices: () => ipcRenderer.invoke("get-devices"),
	getDriveHealth: (driveName) =>
		ipcRenderer.invoke("get-drive-health", driveName),
	wipeDevice: (config) => ipcRenderer.invoke("wipe-device", config),
	onBackendLog: (callback) => {
		const listener = (event, ...args) => callback(...args);
		ipcRenderer.on("backend-log", listener);
		return () => ipcRenderer.removeListener("backend-log", listener);
	},
});
