const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const fetch = require("node-fetch");
const WebSocket = require("ws");

let goBackend;
let mainWindow;

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1200,
		height: 800,
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			webSecurity: false, // For development with Vite
		},
	});

	const viteUrl = "http://localhost:5173";
	mainWindow.loadURL(viteUrl).catch((err) => {
		console.error(
			"Failed to load Vite URL. Is the frontend server running?",
			err,
		);
	});
	mainWindow.webContents.openDevTools();
}

function startGoBackend() {
	const binaryPath = path.join(__dirname, "../server/server"); // Path to the compiled Go binary

	// Important: Use 'sudo' to launch the Go backend with necessary permissions
	goBackend = spawn("sudo", [binaryPath]);

	goBackend.stdout.on("data", (data) => console.log(`[Go Backend]: ${data}`));
	goBackend.stderr.on("data", (data) =>
		console.error(`[Go Backend ERR]: ${data}`),
	);
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
	// We no longer start the backend here. The `npm start` script handles it.
	createWindow();
	setTimeout(setupWebSocket, 2000); // Give server a moment to start
});

app.on("window-all-closed", () => {
	if (goBackend) goBackend.kill();
	if (process.platform !== "darwin") app.quit();
});

// IPC Handlers
// ipcMain.handle("detect-drives", async () => {
// 	try {
// 		const response = await fetch("http://localhost:8080/api/drives");
// 		return await response.json();
// 	} catch (error) {
// 		console.error("IPC Error (detect-drives):", error);
// 		return [];
// 	}
// });

ipcMain.handle("detect-drives", async () => {
	try {
		const response = await fetch("http://localhost:8080/api/drives");

		// Check if the server responded with an error status code
		if (!response.ok) {
			const errorData = await response.json();
			// Throw an error with the specific message from the backend
			throw new Error(
				errorData.error || `Server responded with ${response.status}`,
			);
		}

		const drives = await response.json();
		return drives;
	} catch (error) {
		console.error("IPC Error (detect-drives):", error);
		// Re-throw the error so the frontend can catch it
		throw error;
	}
});

ipcMain.handle("get-drive-health", async (event, driveName) => {
	try {
		const response = await fetch(
			`http://localhost:8080/api/drive/${driveName}/health`,
		);
		return await response.json();
	} catch (error) {
		console.error(`IPC Error (get-drive-health for ${driveName}):`, error);
		return null;
	}
});

ipcMain.on("backend-command", (event, command) => {
	if (command.action === "wipe") {
		fetch("http://localhost:8080/api/wipe", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				devicePath: command.drive,
				method: command.method,
			}),
		}).catch((err) => console.error("IPC Error (wipe command):", err));
	}
});
