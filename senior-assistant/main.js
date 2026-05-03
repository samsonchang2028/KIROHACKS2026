const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  screen,
  session,
} = require("electron");
const path = require("path");
const stubs = require("./stubs");
const { getHeavyProcesses, killProcesses, checkSystem } = require("./system-monitor");

// Named sizes make position math readable and keep the two window configs in sync.
// FLOATING.width/height is the Electron window — larger than the button (100px) to give
// breathing room for the drop shadow and the hover scale(1.07) without clipping.
const FLOATING = { width: 120, height: 120, margin: 20 };
const CHAT = { width: 480, height: 600 };

// Both windows share identical security settings; one definition prevents drift.
const webPreferences = {
  preload: path.join(__dirname, "preload.js"),
  contextIsolation: true,
  nodeIntegration: false,
};

let floatingWindow = null;
let chatWindow = null;
let toastWindow = null;

// --- Window factories ---

function createFloatingWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  floatingWindow = new BrowserWindow({
    width: FLOATING.width,
    height: FLOATING.height,
    x: width - FLOATING.width - FLOATING.margin,
    y: height - FLOATING.height - FLOATING.margin,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    webPreferences,
  });

  // 'screen-saver' level keeps the button above fullscreen apps; must be set after construction.
  floatingWindow.setAlwaysOnTop(true, "screen-saver");
  floatingWindow.loadFile("floating.html");

  // Only quit the app when the floating button itself is destroyed, not when chat closes.
  floatingWindow.on("closed", () => {
    floatingWindow = null;
    app.quit();
  });
}

function createChatWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  chatWindow = new BrowserWindow({
    width: CHAT.width,
    height: CHAT.height,
    x: Math.round((width - CHAT.width) / 2),
    y: Math.round((height - CHAT.height) / 2),
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    webPreferences,
  });

  chatWindow.loadFile("renderer.html");

  // Show only when explicitly requested via showChatWindow()
  chatWindow.once("ready-to-show", () => {});

  // Hide instead of destroy so the next open is instant (no re-parse of renderer.html).
  chatWindow.on("close", (event) => {
    event.preventDefault();
    chatWindow.hide();
  });
}

// --- Show/hide helpers (shared by IPC handler and global shortcut) ---

function showChatWindow() {
  if (!chatWindow) { createChatWindow(); chatWindow.show(); }
  else { chatWindow.show(); }
}

function hideChatWindow() {
  if (chatWindow) { chatWindow.hide(); }
}

function showToast(message, suggestions) {
  if (toastWindow) { toastWindow.close(); toastWindow = null; }

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const toastW = 300, toastH = 60;

  toastWindow = new BrowserWindow({
    width: toastW,
    height: toastH,
    x: width - toastW - FLOATING.margin,
    y: height - FLOATING.height - FLOATING.margin - toastH - 10,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: false,
      nodeIntegration: true,
    },
  });

  toastWindow.setAlwaysOnTop(true, "screen-saver");
  toastWindow.loadFile("toast.html");

  toastWindow.webContents.once("did-finish-load", () => {
    toastWindow.webContents.send("show-toast", message);
  });

  // Click Fix kills heavy processes directly
  ipcMain.handleOnce("toast-clicked", async () => {
    const procs = getHeavyProcesses();
    const allPids = procs.flatMap(p => p.pids || [p.pid]);
    const killed = killProcesses(allPids);
    if (toastWindow) { toastWindow.close(); toastWindow = null; }
    // Show a brief "done" toast
    showToast(`Closed ${killed} app${killed !== 1 ? 's' : ''} to free up memory`, []);
  });

  // Auto-dismiss after 8 seconds
  setTimeout(() => {
    if (toastWindow) { toastWindow.close(); toastWindow = null; }
  }, 8000);
}

// --- IPC: window management ---

ipcMain.handle("openChatWindow", () => showChatWindow());
ipcMain.handle("closeChatWindow", () => hideChatWindow());

// --- IPC: title bar window controls ---

ipcMain.handle("win-minimize", () => { if (chatWindow) chatWindow.minimize(); });
ipcMain.handle("win-maximize", () => {
  if (!chatWindow) return;
  chatWindow.isMaximized() ? chatWindow.unmaximize() : chatWindow.maximize();
});
ipcMain.handle("win-close", () => { if (chatWindow) chatWindow.hide(); });

// --- IPC: stub pass-throughs (teammates replace stub bodies, not these handlers) ---

ipcMain.handle("transcribe", (_e, blob) => stubs.transcribeAudio(blob));
ipcMain.handle("getResponse", (_e, text) =>
  stubs.getAssistantResponse(text, null),
);
ipcMain.handle("executeAction", (_e, action) => stubs.executeAction(action));
ipcMain.handle("speak", (_e, text) => stubs.speak(text));
ipcMain.handle("stopSpeaking", () => stubs.stopSpeaking());
ipcMain.handle("captureScreenshot", () => stubs.captureScreenshot());

// --- IPC: system monitor ---
ipcMain.handle("getHeavyProcesses", () => getHeavyProcesses());
ipcMain.handle("killProcesses", (_e, pids) => killProcesses(pids));
ipcMain.handle("checkSystem", () => checkSystem());
ipcMain.handle("reboot", () => {
  const { execSync } = require("child_process");
  if (process.platform === "darwin") {
    execSync('osascript -e \'tell app "System Events" to restart\'', { stdio: "ignore" });
  } else {
    execSync("shutdown /r /t 5", { stdio: "ignore" });
  }
});

// logEvent and undoLast have no stub yet; Person 3 will implement the real undo log.
ipcMain.handle("logEvent", (_e, event) => {
  console.log("[EVENT]", event);
  return { ok: true };
});
ipcMain.handle("undoLast", () => {
  console.log("[UNDO]");
  return { ok: true };
});

// --- App lifecycle ---

app.whenReady().then(() => {
  // Grant microphone permission automatically — Electron blocks it by default.
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      if (permission === "media") {
        callback(true);
      } else {
        callback(false);
      }
    },
  );

  createFloatingWindow();

  // Ctrl+Space may conflict with some CJK input method editors (IMEs).
  // If the demo machine uses a CJK IME, disable this shortcut before presenting.
  globalShortcut.register("CommandOrControl+Space", () => showChatWindow());

  // Ctrl+Shift+S — trigger memory check (toast + chat in background)
  globalShortcut.register("CommandOrControl+Shift+S", () => {
    const suggestions = checkSystem();
    if (suggestions.length > 0) {
      showToast("Apps are slowing down your computer", suggestions);
      if (!chatWindow) createChatWindow();
      setTimeout(() => {
        if (chatWindow) chatWindow.webContents.send("system-check", suggestions);
      }, 300);
    }
  });

  // Ctrl+Shift+R — trigger reboot suggestion (chat only)
  globalShortcut.register("CommandOrControl+Shift+R", () => {
    const { checkUptime } = require("./system-monitor");
    const up = checkUptime();
    if (up) {
      showChatWindow();
      setTimeout(() => {
        if (chatWindow) chatWindow.webContents.send("system-check", [up]);
      }, 300);
    }
  });

  app.on("activate", () => {
    if (!floatingWindow) createFloatingWindow();
  });
});

app.on("window-all-closed", () => {
  // Intentionally empty: quit lifecycle is managed via floatingWindow 'closed' above.
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
