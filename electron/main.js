const { spawn } = require("child_process");
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

let mainWindow;
const isDev = !app.isPackaged;   // ✅ detect dev vs prod

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

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");  // vite dev server
    mainWindow.webContents.openDevTools();        // optional
  } else {
    mainWindow.loadFile(path.join(__dirname, "../frontend/dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/* ✅ Ensure only one instance of Electron */
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.whenReady().then(() => {
  createWindow();
  startGoBackend();   // start Go process once
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/* --------- IPC handler for detectDrives --------- */
// Detect drives (ask Go backend)
ipcMain.handle("detect-drives", async () => {
  return new Promise((resolve, reject) => {
    if (!goProc) {
      return reject("Go backend not running");
    }

    // Send command to Go backend via stdin
    goProc.stdin.write(JSON.stringify({ action: "detect-drives" }) + "\n");

    // Listen for one-time response
    const handleData = (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "drive-list") {
          goProc.stdout.off("data", handleData);
          resolve(msg.drives);
        }
      } catch (e) {
        console.error("Failed to parse drive list:", e);
      }
    };

    goProc.stdout.on("data", handleData);
  });
});


/* --------- Spawn Go backend --------- */
function startGoBackend() {
  const goBinary = path.join(__dirname, "../go-backend/backend"); // compiled binary path

  const goProc = spawn(goBinary, [], { cwd: path.dirname(goBinary) });

  goProc.stdout.on("data", (data) => {
    const log = data.toString().trim();
    console.log("[Go Backend]", log);

    if (mainWindow) {
      mainWindow.webContents.send("backend-log", log);
    }
  });

  goProc.stderr.on("data", (data) => {
    console.error("[Go Backend Error]", data.toString());
  });

  goProc.on("close", (code) => {
    console.log(`Go backend exited with code ${code}`);
  });
}
