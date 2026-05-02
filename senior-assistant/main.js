// main.js — Electron main process: creates windows, registers ipcMain handlers, owns app lifecycle.
const { app, BrowserWindow } = require('electron');
const path = require('path');

// Module-level reference prevents GC from collecting the window object and closing it immediately.
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadURL('about:blank');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
