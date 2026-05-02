// preload.js — Preload script: exposes window.api to the renderer via contextBridge, no other Node access.
//
// IPC contract. Frozen at hour 1. Do not modify without coordinating with the team.
//
// All renderer↔main communication flows through window.api. ipcRenderer is never exposed directly
// so the renderer cannot reach Node APIs it shouldn't have.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  transcribe: (blob) => ipcRenderer.invoke("transcribe", blob),
  getResponse: (text) => ipcRenderer.invoke("getResponse", text),
  executeAction: (action) => ipcRenderer.invoke("executeAction", action),
  speak: (text) => ipcRenderer.invoke("speak", text),
  stopSpeaking: () => ipcRenderer.invoke("stopSpeaking"),
  captureScreenshot: () => ipcRenderer.invoke("captureScreenshot"),
  openChatWindow: () => ipcRenderer.invoke("openChatWindow"),
  closeChatWindow: () => ipcRenderer.invoke("closeChatWindow"),
  logEvent: (event) => ipcRenderer.invoke("logEvent", event),
  undoLast: () => ipcRenderer.invoke("undoLast"),
});
