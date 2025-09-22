const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
	invoke: (channel, data) => ipcRenderer.invoke(channel, data),
	send: (channel, data) => ipcRenderer.send(channel, data),
	onBackendLog: (callback) => {
		const listener = (event, ...args) => callback(...args);
		ipcRenderer.on("backend-log", listener);
		// Return a function to remove the listener
		return () => ipcRenderer.removeListener("backend-log", listener);
	},
});
