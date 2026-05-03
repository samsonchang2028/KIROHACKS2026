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

  // Show only when content is ready — this is what keeps click→visible under 200ms.
  chatWindow.once("ready-to-show", () => chatWindow.show());

  // Hide instead of destroy so the next open is instant (no re-parse of renderer.html).
  chatWindow.on("close", (event) => {
    event.preventDefault();
    chatWindow.hide();
  });
}

// --- Show/hide helpers (shared by IPC handler and global shortcut) ---

function showChatWindow() {
  if (!chatWindow) { createChatWindow(); }
  else { chatWindow.show(); }
}

function hideChatWindow() {
  if (chatWindow) { chatWindow.hide(); }
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

  // Ctrl+Shift+S — trigger proactive system check (for demo)
  globalShortcut.register("CommandOrControl+Shift+S", () => {
    showChatWindow();
    const suggestions = checkSystem();
    if (chatWindow && suggestions.length > 0) {
      chatWindow.webContents.send("system-check", suggestions);
    }
  });

  // Ctrl+Shift+R — trigger reboot suggestion only (for demo)
  globalShortcut.register("CommandOrControl+Shift+R", () => {
    showChatWindow();
    const { checkUptime } = require("./system-monitor");
    const up = checkUptime();
    if (chatWindow && up) {
      chatWindow.webContents.send("system-check", [up]);
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
