// main.js
const { app, BrowserWindow, Tray, Menu, ipcMain } = require("electron");
const path = require("path");
const startServer = require("./server");

let mainWindow = null;
let tray = null;
let isQuitting = false;


const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });

  app.whenReady().then(() => {
    startServer();
    createTray();   
    configureAutoStart();   
    const isHidden = process.argv.includes("--hidden");
    if (!isHidden) {
      createWindow();
    }
  });
}

function createWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    frame: false, // Make window frameless (hide default OS controls)
    icon: path.join(__dirname, "assets", "tray-icon.png"), // Set custom taskbar icon
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },   
    show: false,
  });

  mainWindow.loadFile("index.html");

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}


ipcMain.on("window-minimize", () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on("window-maximize", () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on("window-close", () => {
  if (mainWindow) mainWindow.close(); 
});

function createTray() {
  const iconPath = path.join(__dirname, "assets", "tray-icon.png");
  
  tray = new Tray(iconPath);
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show Printer App",
      click: () => {
        createWindow();
      },
    },
    { type: "separator" },
    {
      label: "Exit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip("Printer App (Running in Background)");
  tray.setContextMenu(contextMenu);
  
  tray.on("double-click", () => {
    createWindow();
  });
  tray.on("click", () => {
    createWindow();
  });
}

function configureAutoStart() {
  if (app.isPackaged) {
    // Use setLoginItemSettings with a name for proper NSIS installer support.
    // This writes to HKCU\Software\Microsoft\Windows\CurrentVersion\Run
    // so the app starts on login even if the installer.nsh shortcut fails.
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true,   // suppresses the window on startup (passes --hidden internally)
      path: process.execPath,
      args: ["--hidden"],
      name: "Xenia-Printer-App", // must match productName in package.json
    });
  }
}

app.on("window-all-closed", () => {
  // Keep active in background
});

app.on("before-quit", () => {
  isQuitting = true;
});
