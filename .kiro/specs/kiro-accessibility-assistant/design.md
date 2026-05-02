# Design Document: LLM Integration Layer

## Overview

This document covers the LLM integration layer for the senior accessibility assistant. The developer replacing the stubs owns three files: `llm.js`, `pipeline.js`, and `screenshot.js`. Everything else is a teammate's concern.

The integration replaces two stubs in `stubs.js`:
- `getAssistantResponse(msg, screenshot)` → OpenRouter API call
- `captureScreenshot()` → Electron `desktopCapturer`

The entry point for the main process is `pipeline.handleQuery(userMessage)`, which returns `{ action, params, reply }`.

**Privacy constraint**: OpenRouter is used with providers that have zero data retention. The `x-or-policy` header is set on every request to enforce this.
# Design Document

## Overview

A Windows desktop accessibility assistant for seniors, built as an Electron app. The user sees a persistent "Help" button on their desktop. Tapping it opens a chat window where they speak a problem in plain language. The app transcribes their speech, sends it to an AI brain, gets back a structured action decision, confirms with the user if needed, and executes one of 8 approved system actions — all while talking back in a warm voice.

Every design decision is evaluated against: **does this make the live demo more impressive and reliable?**

---

## Architecture

```
Renderer (renderer.js)
    │
    │  window.api.getResponse(text)   [IPC invoke]
    ▼
main.js  ipcMain.handle('getResponse', ...)
    │
    │  pipeline.handleQuery(userMessage)
    ▼
┌─────────────────────────────────────────────────────┐
│                    pipeline.js                      │
│                                                     │
│  1. Build prompt + call llm.textQuery(msg)          │
│                                                     │
│  2a. action !== 'needs_screenshot'                  │
│      └─ return { action, params, reply }            │
│                                                     │
│  2b. action === 'needs_screenshot'                  │
│      ├─ screenshot.capture() → base64 PNG           │
│      └─ llm.visionQuery(msg, base64) → parse        │
│          └─ return { action, params, reply }        │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌──────────────┐    ┌─────────────────┐
│    llm.js    │    │  screenshot.js  │
│              │    │                 │
│ textQuery()  │    │ capture()       │
│ visionQuery()│    │ desktopCapturer │
│              │    │ → base64 PNG    │
│ OpenRouter   │    └─────────────────┘
│ API calls    │
└──────────────┘
         │
         ▼
   OpenRouter API
   ├── anthropic/claude-3-haiku   (text-only)
   └── openai/gpt-4o-mini         (vision)
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

```
senior-assistant/
├── llm.js          OpenRouter API calls — textQuery() and visionQuery()
├── pipeline.js     Orchestration — decides text vs vision path, parses JSON, validates action
├── screenshot.js   Screen capture — desktopCapturer → base64 PNG
└── stubs.js        (existing) — getAssistantResponse and captureScreenshot bodies replaced here
```

`pipeline.js` is the only file that imports both `llm.js` and `screenshot.js`. `stubs.js` is updated to delegate to `pipeline.js` rather than containing logic itself.

---

## Components and Interfaces

### pipeline.js

```js
// Main entry point called from main.js IPC handler
async function handleQuery(userMessage)
// Returns: { action: string, params: object|null, reply: string }
// Throws: PipelineError with { code, message, reply } on unrecoverable failure
```

Internal flow:
1. Call `llm.textQuery(userMessage)` → parse JSON response
2. If `action === 'needs_screenshot'`: call `screenshot.capture()`, then `llm.visionQuery(userMessage, base64)`
3. Validate `action` is in the allowlist (hard-coded array — never trust the LLM)
4. Return `{ action, params, reply }`

### llm.js

```js
// Text-only call — uses claude-3-haiku
async function textQuery(userMessage)
// Returns: raw parsed JSON object from LLM response
// Throws on HTTP error or JSON parse failure

// Vision call — uses gpt-4o-mini, accepts base64 PNG
async function visionQuery(userMessage, screenshotBase64)
// Returns: raw parsed JSON object from LLM response
// Throws on HTTP error or JSON parse failure
```

### screenshot.js

```js
// Captures primary display, returns base64-encoded PNG string
async function capture()
// Returns: string (base64 PNG, no data URI prefix)
// Throws: ScreenshotError if desktopCapturer fails
```

### stubs.js integration

The stub bodies are replaced with thin delegations:

```js
// In stubs.js — replace the body only, keep the signature
const pipeline = require('./pipeline');
const screenshot = require('./screenshot');

async function getAssistantResponse(text, screenshotBase64) {
  return pipeline.handleQuery(text, screenshotBase64);
}

async function captureScreenshot() {
  return screenshot.capture();
}
```

The return shape from `pipeline.handleQuery` maps to the stub contract:

| pipeline returns | stub contract |
|---|---|
| `reply` | `speak` |
| `action` + `params` | `action: { name, params }` |
| (derived) | `requiresConfirmation` |

`requiresConfirmation` is determined in `pipeline.js` based on a hard-coded set of actions that always require confirmation (all except `readScreenAloud` and `setVolume`/`setBrightness` adjustments).

---

## Data Models

### LLM response JSON schema

Every LLM call returns one of four shapes. The system prompt instructs the model to return only valid JSON with no markdown fences.

**Action response:**
```json
{
  "action": "setVolume",
  "params": { "level": 80 },
  "reply": "I'll turn the volume up to 80%."
}
```

**Needs screenshot:**
```json
{
  "action": "needs_screenshot",
  "params": null,
  "reply": "Let me take a look at your screen first."
}
```

**No match:**
```json
{
  "action": "no_match",
  "params": null,
  "reply": "I can only help with volume, brightness, text size, and opening apps."
}
```

**Clarification needed:**
```json
{
  "action": "clarify",
  "params": { "question": "Which app would you like me to open?" },
  "reply": "Which app would you like me to open?"
}
```

### Action allowlist (enforced in pipeline.js)

```js
const ALLOWED_ACTIONS = [
  'setTextSize',
  'setBrightness',
  'setVolume',
  'openApp',
  'closeActiveWindow',
  'closeScamPopup',
  'readScreenAloud',
  'sendHelpToFamily',
  // control actions (not executed as system actions)
  'needs_screenshot',
  'no_match',
  'clarify',
];
```

Any `action` value not in this list is treated as `no_match` and logged as a security event.

### Action parameter schemas

```js
// setTextSize
{ scale: 100 | 125 | 150 | 175 | 200 }

// setBrightness
{ level: number }  // 0–100, clamped in pipeline

// setVolume
{ level: number }  // 0–100, clamped in pipeline

// openApp
{ name: string }   // app name, passed to executeAction as-is

// closeActiveWindow, closeScamPopup, readScreenAloud
{}  // no params

// sendHelpToFamily
{ summary: string }

// clarify
{ question: string }
```

### OpenRouter request shape

```js
// Text-only (claude-3-haiku)
{
  model: 'anthropic/claude-3-haiku',
  messages: [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: userMessage }
  ],
  max_tokens: 256,
  temperature: 0.1,
  response_format: { type: 'json_object' }
}

// Vision (gpt-4o-mini)
{
  model: 'openai/gpt-4o-mini',
  messages: [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: userMessage },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } }
      ]
    }
  ],
  max_tokens: 256,
  temperature: 0.1,
  response_format: { type: 'json_object' }
}
```

HTTP headers on every request:
```
Authorization: Bearer <OPENROUTER_API_KEY>
Content-Type: application/json
HTTP-Referer: https://github.com/hackathon/senior-assistant
X-Title: Senior Accessibility Assistant
x-or-policy: no-training
```

The `x-or-policy: no-training` header instructs OpenRouter to route only to providers with zero data retention. This is the primary privacy control.

---

## System Prompt Design

The system prompt is a constant in `llm.js`. It is short and instruction-dense — no narrative, no examples beyond the JSON schema.

```
You are an accessibility assistant for seniors. You help with exactly 8 actions.

Respond ONLY with valid JSON. No markdown. No explanation outside the JSON.

ALLOWED ACTIONS:
- setTextSize(scale)     scale must be one of: 100, 125, 150, 175, 200
- setBrightness(level)   level 0–100
- setVolume(level)       level 0–100
- openApp(name)          name is a string like "chrome" or "notepad"
- closeActiveWindow()    no params
- closeScamPopup()       no params
- readScreenAloud()      no params
- sendHelpToFamily(summary)  summary is a short string

RESPONSE FORMAT:
{"action": "<action_name>", "params": <params_or_null>, "reply": "<warm short sentence for the user>"}

SPECIAL ACTIONS (not system actions):
- If you need to see the screen to answer: {"action": "needs_screenshot", "params": null, "reply": "Let me take a look at your screen first."}
- If the request doesn't match any action: {"action": "no_match", "params": null, "reply": "I can only help with volume, brightness, text size, and opening apps."}
- If the request is ambiguous: {"action": "clarify", "params": {"question": "..."}, "reply": "..."}

RULES:
- Never suggest actions outside the list above.
- Never include code, commands, or URLs in your response.
- The reply field must be warm, short (under 15 words), and spoken aloud to the user.
- If the user mentions a popup, virus warning, or scary message, use closeScamPopup.
- If the user mentions text being small or hard to read, use setTextSize with scale 150 as a safe default.
```

**Design rationale:**
- `temperature: 0.1` keeps responses deterministic — critical for a demo
- `max_tokens: 256` is generous for the JSON shape but prevents runaway responses
- `response_format: { type: 'json_object' }` is supported by both haiku and gpt-4o-mini and eliminates markdown fence stripping
- The system prompt never changes between text and vision calls — the only difference is whether a screenshot is attached

---

## Screenshot Capture Flow

```
screenshot.capture()
    │
    ├─ desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } })
    │
    ├─ sources[0].thumbnail  (NativeImage)
    │
    ├─ .toPNG()              (Buffer)
    │
    └─ .toString('base64')   (string, no data URI prefix)
```

`desktopCapturer` runs in the **main process** only. The renderer cannot call it directly. The IPC handler for `captureScreenshot` in `main.js` calls `screenshot.capture()` and returns the base64 string.

The screenshot is taken at 1920×1080 max. For the vision call, this is passed directly as a base64 data URI. OpenRouter/gpt-4o-mini accepts images up to 20MB; a 1080p PNG is typically 1–3MB.

The screenshot is **never written to disk** and **never logged**. It exists only in memory for the duration of the pipeline call.

---

## Error Handling Strategy

All errors are caught in `pipeline.handleQuery` and converted to a safe user-facing reply. The renderer never sees a raw exception.

```
Error type              → Behavior
─────────────────────────────────────────────────────────────────
OpenRouter HTTP 4xx     → reply: "I had trouble understanding that. Try again?"
OpenRouter HTTP 5xx     → reply: "The assistant is unavailable right now."
JSON parse failure      → reply: "I got a confusing response. Try again?"
Action not in allowlist → reply: "I can only help with the actions I know." + log security event
Screenshot failure      → proceed without screenshot, reply: "I couldn't see your screen, but..."
Network timeout (>4s)   → reply: "That took too long. Check your internet connection."
```

Error shape returned to main.js:
```js
// On any error, pipeline returns this shape (never throws to the IPC handler)
{ action: 'no_match', params: null, reply: '<user-safe message>' }
```

Logging: every error is `console.error`'d with a structured prefix `[LLM ERROR]` so it's easy to grep during the demo.

---

## Testing Strategy

This is a hackathon. The testing strategy is focused on what can go wrong during the demo.

**Unit tests** (manual verification during development):
- `pipeline.js`: feed known LLM response strings through the JSON parser and action validator — verify correct `{ action, params, reply }` output
- `llm.js`: verify the request body shape before sending (log and inspect)
- `screenshot.js`: verify `capture()` returns a non-empty base64 string on the demo machine

**Property tests** (see Correctness Properties below):
- Action validation: for any string the LLM might return as `action`, the pipeline either maps it to a known action or falls back to `no_match`
- JSON parsing: for any string returned by the LLM, the parser either succeeds or returns a safe fallback — never throws to the caller
- Parameter clamping: for any numeric level value, `setBrightness` and `setVolume` params are clamped to [0, 100]

**Demo smoke test** (run before every demo):
1. Set `OPENROUTER_API_KEY` in environment
2. Run `node pipeline.js` with a hardcoded test message — verify JSON response shape
3. Run `node screenshot.js` — verify base64 PNG is returned and non-empty
4. Full IPC round-trip: send "make my text bigger" from renderer, verify `setTextSize` action arrives

**What is NOT tested** (out of scope for hackathon):
- OpenRouter uptime / rate limits
- Model accuracy / hallucination rate
- Screenshot quality on different display configurations

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Action allowlist enforcement

*For any* string value returned by the LLM as the `action` field, `pipeline.handleQuery` SHALL either return that action (if it is in the allowlist) or return `{ action: 'no_match', ... }` — it SHALL never return an action not in the allowlist.

**Validates: Requirements — Action catalog (the only things the app can do), Safety rules**

### Property 2: Pipeline never throws to caller

*For any* input to `pipeline.handleQuery` — including malformed LLM responses, network errors, screenshot failures, and invalid JSON — the function SHALL return a valid `{ action, params, reply }` object and SHALL never propagate an exception to the IPC handler.

**Validates: Requirements — Error handling strategy, UX rules (one thing on screen at a time)**

### Property 3: Numeric parameter clamping

*For any* numeric `level` value returned by the LLM for `setBrightness` or `setVolume`, the `params.level` in the returned object SHALL be clamped to the range [0, 100].

**Validates: Requirements — setBrightness(level), setVolume(level) action catalog entries**

### Property 4: setTextSize scale validation

*For any* `scale` value returned by the LLM for `setTextSize`, the `params.scale` in the returned object SHALL be one of `[100, 125, 150, 175, 200]`. If the LLM returns an out-of-range value, the pipeline SHALL substitute the nearest valid scale.

**Validates: Requirements — setTextSize(scale) action catalog entry**

### Property 5: Vision path only triggered by needs_screenshot

*For any* user message, `screenshot.capture()` SHALL be called if and only if the first LLM call returns `action === 'needs_screenshot'`. It SHALL never be called on the text-only path.

**Validates: Requirements — LLM pipeline design (screenshot only when needed)**

### Property 6: Reply field always present and non-empty

*For any* response returned by `pipeline.handleQuery`, the `reply` field SHALL be a non-empty string. The pipeline SHALL never return a response with a missing or empty `reply`.

**Validates: Requirements — UX rules (voice everything), state machine (Thinking → Confirming/Doing)**
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
