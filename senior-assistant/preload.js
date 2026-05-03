// preload.js — Preload script: exposes window.api to the renderer via contextBridge, no other Node access.
//
// IPC contract. Frozen at hour 1. Do not modify without coordinating with the team.
//
// All renderer↔main communication flows through window.api. ipcRenderer is never exposed directly
// so the renderer cannot reach Node APIs it shouldn't have.
//
// --- Walkthrough additions (added with team awareness) ---
// startWalkthrough, cancelWalkthrough, walkthroughEvent, submitWalkthroughInput
// are deliberate extensions to the frozen contract for walk-me-through-it mode.
// Existing methods are untouched.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  transcribe: (blob) => ipcRenderer.invoke("transcribe", blob),
  getResponse: (text) => ipcRenderer.invoke("getResponse", text),
  executeAction: (action) => ipcRenderer.invoke("executeAction", action),
  speak: (text) => ipcRenderer.invoke("speak", text),
  stopSpeaking: () => ipcRenderer.invoke("stopSpeaking"),
  captureScreenshot: () => ipcRenderer.invoke("captureScreenshot"),
  openChatWindow: () => ipcRenderer.invoke("openChatWindow"),
  openChatWindowVoice: () => ipcRenderer.invoke("openChatWindowVoice"),
  openChatWindowWithQuery: (query) => ipcRenderer.invoke("openChatWindowWithQuery", query),
  closeChatWindow: () => ipcRenderer.invoke("closeChatWindow"),
  requestMicFocus: () => ipcRenderer.invoke("requestMicFocus"),
  logEvent: (event) => ipcRenderer.invoke("logEvent", event),
  undoLast: () => ipcRenderer.invoke("undoLast"),
  // Title bar window controls
  winMinimize: () => ipcRenderer.invoke("win-minimize"),
  winMaximize: () => ipcRenderer.invoke("win-maximize"),
  winClose: () => ipcRenderer.invoke("win-close"),
  // Main → renderer push signals
  onStartVoice:   (cb) => ipcRenderer.on("start-voice",   ()         => cb()),
  onSubmitQuery:  (cb) => ipcRenderer.on("submit-query",  (_e, q)    => cb(q)),
  onSystemCheck:  (cb) => ipcRenderer.on("system-check",  (_e, data) => cb(data)),

  // --- Walkthrough IPC surface ---
  startWalkthrough: (name) => ipcRenderer.invoke("startWalkthrough", name),
  cancelWalkthrough: () => ipcRenderer.invoke("cancelWalkthrough"),
  submitWalkthroughInput: (text) => ipcRenderer.invoke("submitWalkthroughInput", text),
  walkthroughEvent: (callback) => {
    // Wraps ipcRenderer.on so the renderer can subscribe to lifecycle events
    // (step-started, step-completed, walkthrough-finished, walkthrough-cancelled,
    //  wait-for-input) without direct access to ipcRenderer.
    ipcRenderer.on("walkthrough-event", (_event, data) => callback(data));
  },

  // Lets the overlay toggle click-through on/off for interactive regions (cancel button).
  setIgnoreMouseEvents: (ignore, opts) => ipcRenderer.invoke("setIgnoreMouseEvents", ignore, opts),
});
