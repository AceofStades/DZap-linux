const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fetch = require("node-fetch");
const WebSocket = require("ws");

let mainWindow;

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1200,
		height: 800,
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	mainWindow.loadURL("http://localhost:3000"); // Load Next.js dev server
	mainWindow.webContents.openDevTools();
}

function setupWebSocket() {
	const ws = new WebSocket("ws://localhost:8080/ws");
	ws.on("open", () => console.log("WebSocket connected to Go backend."));
	ws.on("message", (message) => {
		if (mainWindow) {
			mainWindow.webContents.send("backend-log", message.toString());
		}
	});
	ws.on("error", (err) => console.error("WebSocket error:", err));
}

app.whenReady().then(() => {
	createWindow();
	setTimeout(setupWebSocket, 2000);
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

// --- IPC Handlers ---

ipcMain.handle("get-devices", async () => {
	try {
		const response = await fetch("http://localhost:8080/api/devices");
		if (!response.ok) {
			const errData = await response.json();
			throw new Error(
				errData.error || `Server error: ${response.status}`,
			);
		}
		return await response.json();
	} catch (error) {
		console.error("IPC Error (get-devices):", error);
		return { storage: [], mobile: [] };
	}
});

ipcMain.handle("get-drive-health", async (event, driveName) => {
	try {
		const response = await fetch(
			`http://localhost:8080/api/drive/${driveName}/health`,
		);
		if (!response.ok) {
			const errData = await response.json();
			throw new Error(
				errData.error || `Server error: ${response.status}`,
			);
		}
		return await response.json();
	} catch (error) {
		console.error(`IPC Error (get-drive-health for ${driveName}):`, error);
		return null;
	}
});

ipcMain.handle("wipe-device", async (event, config) => {
	try {
		const response = await fetch("http://localhost:8080/api/wipe", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(config),
		});
		if (!response.ok) {
			const errData = await response.json();
			throw new Error(
				errData.error || `Server error: ${response.status}`,
			);
		}
		return await response.json();
	} catch (error) {
		console.error("IPC Error (wipe-device):", error);
		return { status: "error", message: error.message };
	}
});
