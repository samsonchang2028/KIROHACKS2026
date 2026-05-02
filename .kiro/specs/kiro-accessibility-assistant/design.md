# Design Document

## Overview

A Windows desktop accessibility assistant for seniors, built as an Electron app. The user sees a persistent "Help" button on their desktop. Tapping it opens a chat window where they speak a problem in plain language. The app transcribes their speech, sends it to an AI brain, gets back a structured action decision, confirms with the user if needed, and executes one of 8 approved system actions — all while talking back in a warm voice.

Every design decision is evaluated against: **does this make the live demo more impressive and reliable?**

---

## Architecture

### Process model

Electron multi-process architecture. The main process owns all Node.js and system access. The two renderer processes (floating Help button, chat window) are sandboxed — they have no direct Node access. All renderer↔main communication flows exclusively through the locked `window.api` IPC bridge defined in `preload.js`.

```
┌─────────────────────────────────────────────────────┐
│                    Main Process                      │
│  main.js — IPC handlers, window management,         │
│            stub calls, undo stack, event log         │
│  stubs.js — integration boundary (frozen signatures) │
└────────────────┬────────────────┬───────────────────┘
                 │ contextBridge  │ contextBridge
        ┌────────┴──────┐  ┌──────┴────────────┐
        │ floating.html │  │  renderer.html     │
        │ floating.js   │  │  renderer.js       │
        │ Help button   │  │  Chat window       │
        └───────────────┘  └────────────────────┘
```

### File responsibilities

| File | Responsibility |
|---|---|
| `main.js` | Electron main process: creates windows, registers `ipcMain` handlers, owns app lifecycle, enforces action allowlist, manages undo stack, writes event log |
| `preload.js` | Exposes `window.api` to renderers via `contextBridge`. Frozen — do not modify without team coordination |
| `floating.html` | Always-on-top Help button window markup |
| `floating.js` | Click handler for the Help button — calls `window.api.openChatWindow()` |
| `renderer.html` | Chat window markup — transcript, status label, mic/confirm controls |
| `renderer.js` | All chat UI logic: state machine, mic recording, message rendering, IPC calls |
| `styles.css` | Shared design tokens and component styles — all sizing and color lives here |
| `stubs.js` | Frozen integration boundary — teammates replace function bodies, never signatures |

---

## IPC Contract

The `window.api` surface is frozen. All renderer→main communication goes through these methods only:

| Method | Direction | Purpose |
|---|---|---|
| `transcribe(blob)` | renderer → main | Send recorded audio blob for transcription |
| `getResponse(text)` | renderer → main | Send transcribed text + screenshot for AI response |
| `executeAction(action)` | renderer → main | Execute a validated action from the catalog |
| `speak(text)` | renderer → main | Speak text aloud via TTS |
| `captureScreenshot()` | renderer → main | Capture current screen state |
| `openChatWindow()` | renderer → main | Show the chat window |
| `closeChatWindow()` | renderer → main | Hide the chat window |
| `logEvent(event)` | renderer → main | Append an event to the local log |
| `undoLast()` | renderer → main | Undo the most recent reversible action |

Each `ipcMain.handle` in `main.js` is a thin wrapper — it calls the corresponding stub and returns the result. No business logic inside the handlers.

---

## Stub Integration Boundary

All AI, voice, and system automation calls route through `stubs.js`. Teammates replace function bodies only — signatures are frozen.

| Stub function | Signature | Owner | Returns |
|---|---|---|---|
| `transcribeAudio(blob)` | `async (blob) => string` | Voice team | Transcription string |
| `getAssistantResponse(text, screenshot)` | `async (text, screenshot) => { speak, action, requiresConfirmation }` | AI brain team | Structured response |
| `executeAction(action)` | `async (action) => { success }` | System actions team | Success/failure |
| `speak(text)` | `async (text) => void` | Voice team | void |
| `captureScreenshot()` | `async () => Buffer \| null` | AI brain team | Screenshot buffer or null |

The `getAssistantResponse` return shape is the core contract:

```js
{
  speak: "I can make your text bigger. Should I do that?",  // string — spoken and shown
  action: { name: 'setTextSize', params: { scale: 150 } }, // object or null
  requiresConfirmation: true                                // boolean
}
```

`action` is `null` when no system change is needed (e.g. a clarifying question or read-aloud response).

---

## Action Catalog

The LLM picks from this fixed allowlist. `main.js` enforces it in code — any `action.name` not on this list is rejected before the stub is called.

| # | Action name | Parameters | Reversible | Confirmation required |
|---|---|---|---|---|
| 1 | `setTextSize` | `scale: 100 \| 125 \| 150 \| 175 \| 200` | Yes | Yes |
| 2 | `setBrightness` | `level: 0–100` | Yes | No |
| 3 | `setVolume` | `level: 0–100` | Yes | No |
| 4 | `openApp` | `name: string` | Yes | No |
| 5 | `closeActiveWindow` | none | Yes | Yes |
| 6 | `closeScamPopup` | none | No | Yes |
| 7 | `readScreenAloud` | none | No | No |
| 8 | `sendHelpToFamily` | `summary: string` | No | Yes |

**The catalog is locked at 8 actions.** Any addition must be documented here before being added to the code.

---

## State Machine

Managed as a single `state` variable in `renderer.js`. Every transition updates the UI and calls `window.api.speak()` to announce the change.

### States

| State | Visual | Label | Color |
|---|---|---|---|
| `idle` | Solid circle | "Tap to talk" | `#4A90E2` (blue) |
| `listening` | Pulsing circle | "Listening..." | `#E24A4A` (red) |
| `thinking` | Spinning indicator | "Thinking..." | `#4A90E2` (blue) |
| `confirming` | Two buttons (Yes / No) | — | Green / Red |
| `doing` | Solid circle | "Doing it now..." | `#4AE27A` (green) |

### Transitions

```
idle        → listening   (mic button pressed)
listening   → thinking    (mic button released, audio sent)
thinking    → confirming  (response has requiresConfirmation: true)
thinking    → doing       (response has requiresConfirmation: false)
confirming  → doing       (user taps Yes)
confirming  → idle        (user taps No)
doing       → idle        (action completes)
```

---

## Conversation Flow

Step-by-step sequence for a full interaction:

1. User taps mic button → state: `listening` → `speak("I'm listening")`
2. `MediaRecorder` captures audio until mic released
3. Mic released → state: `thinking` → `speak("Let me check that")`
4. `window.api.transcribe(blob)` → transcription string displayed in transcript
5. `window.api.captureScreenshot()` → screenshot buffer (may be null)
6. `window.api.getResponse(text)` → `{ speak, action, requiresConfirmation }`
7. `window.api.speak(response.speak)` → assistant message appended to transcript
8. **If `requiresConfirmation: true`** → state: `confirming`, show Yes/No buttons
   - Yes → state: `doing` → `window.api.executeAction(action)` → state: `idle`
   - No → state: `idle` → `speak("Okay, no problem")`
9. **If `requiresConfirmation: false`** → state: `doing` → `window.api.executeAction(action)` → state: `idle`
10. `window.api.logEvent({ type: 'action', name: action.name, success: true })`

---

## Window Specifications

### Help button window (`floating.html`)

- Size: fits content — single 120px tall "Help" button
- Always-on-top: yes
- Frameless: yes
- Transparent background: yes
- Position: bottom-right corner of primary display work area
- No taskbar entry
- Single button labeled **"Help"**, 120px tall, minimum width 160px
- Click → `window.api.openChatWindow()`

### Chat window (`renderer.html`)

- Size: 480×600px
- Always-on-top: no
- Opens when Help button is clicked or `Ctrl+Space` is pressed
- Three vertical zones:

```
┌─────────────────────────────┐
│                             │
│   Transcript (scrollable)   │  flex-grow: 1
│   20pt text, chat bubbles   │
│                             │
├─────────────────────────────┤
│   Status label              │  fixed height
│   "Listening..." etc. 24pt  │
├─────────────────────────────┤
│   Controls (120px tall)     │  fixed height
│   Mic button OR Yes+No      │
└─────────────────────────────┘
```

---

## Undo Stack

Managed in `main.js` as an in-memory array (max 10 entries). Cleared on app quit — no persistence.

Before executing any reversible action, main pushes a snapshot `{ action, previousState }` onto the stack. `undoLast` pops the top entry and executes the inverse.

**Reversible actions:** `setTextSize`, `setBrightness`, `setVolume`, `openApp`, `closeActiveWindow`

**Non-reversible actions:** `closeScamPopup`, `readScreenAloud`, `sendHelpToFamily`

---

## Event Logging

Every significant event is logged by calling `window.api.logEvent(event)` from the renderer. Main appends a newline-delimited JSON entry to `log.txt` in the app's user data directory.

Log entry shape:
```js
{ timestamp: "2026-05-02T14:23:01Z", type: "action", name: "setTextSize", success: true }
```

No personal content in the log — no transcription text, no screenshot data. Action names and outcomes only.

---

## CSS Design Tokens

All sizing and color is defined as CSS variables in `styles.css`. No hardcoded values anywhere else.

```css
:root {
  --color-primary:    #4A90E2;  /* blue — idle, thinking */
  --color-listening:  #E24A4A;  /* red — listening state */
  --color-doing:      #4AE27A;  /* green — doing, yes button */
  --color-cancel:     #E24A4A;  /* red — no/cancel button */
  --color-bg:         #FFFFFF;
  --color-text:       #1A1A1A;
  --font-size-body:   20pt;
  --font-size-status: 24pt;
  --btn-height:       120px;
}
```

---

## Safety Constraints

Enforced in `main.js`, not by prompt:

- Action allowlist checked before any stub call — unknown action names are rejected
- `executeAction` never constructs shell commands from user input — stub uses parameterized calls only
- Safety rules for the AI brain (enforced by prompt + response validation):
  - Never click Buy, Pay, Send, Confirm, Accept, or Subscribe
  - Never interact with password or payment fields
  - Always confirm before irreversible actions

---

## Performance Targets

| Milestone | Target |
|---|---|
| Help button click → chat window visible | < 200ms |
| Mic release → transcription shown | < 1.5s |
| Transcription → assistant response shown | < 2s |
| Confirmation tap → action complete | < 1s |
| Full flow end-to-end | < 6s |

---

## Out of Scope

Do not build:
- Real LLM, TTS, Whisper, or Windows automation (all stubbed)
- Family loop email service
- Settings panel
- Persistent conversation history
- macOS / Linux support
- Telemetry or analytics
- Internationalization
