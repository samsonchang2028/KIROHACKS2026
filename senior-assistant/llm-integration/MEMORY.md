# LLM Integration — Memory File

This file is the source of truth for the LLM integration module. Update it after every meaningful change.

---

## Owner
Person 3 — LLM integration (OpenRouter + screenshot capture)

## Branch
`llm-integration`

## What this module does
Replaces two stubs in `stubs.js`:
- `getAssistantResponse(text, screenshot)` → OpenRouter API call
- `captureScreenshot()` → Electron `desktopCapturer`

The entry point for the main process is `pipeline.handleQuery(userMessage)`.

---

## Stub contract (DO NOT CHANGE SIGNATURES)

```js
// getAssistantResponse — return shape is frozen
{
  speak: string,              // warm sentence spoken aloud to the user
  action: { name, params } | null,  // null if no system action needed
  requiresConfirmation: boolean
}

// captureScreenshot — return shape is frozen
string | null  // base64 PNG string, or null on failure
```

---

## Files in this module

| File | Status | Purpose |
|------|--------|---------|
| `llm.js` | ✅ Complete | OpenRouter API calls — textQuery() and visionQuery() |
| `pipeline.js` | ✅ Complete | Orchestrates query → maybe screenshot → action response, action validation, parameter clamping, 6 property tests |
| `screenshot.js` | ✅ Complete | desktopCapturer → base64 PNG |
| `smoke-test.js` | ✅ Complete | 3 mocked smoke tests (text path, screenshot path, error resilience) |
| `mock-setup.js` | ✅ Complete | Lives at `senior-assistant/mock-setup.js` — mocks Electron for plain Node.js test execution |
| `MEMORY.md` | ✅ Created | This file |

---

## Architecture

```
Renderer (renderer.js)
    │  window.api.getResponse(text)   [IPC invoke]
    ▼
main.js  ipcMain.handle('getResponse', ...)
    │  pipeline.handleQuery(userMessage)
    ▼
pipeline.js
    ├── llm.textQuery(msg)  →  { action: 'needs_screenshot' }
    │       └── screenshot.capture() → base64
    │           └── llm.visionQuery(msg, base64) → { action, params, reply }
    └── llm.textQuery(msg)  →  { action, params, reply }  (direct path)
    │
    ▼
Returns { speak, action: { name, params }, requiresConfirmation }
to stubs.js → main.js → renderer
```

---

## Models

| Call type | Model | Why |
|-----------|-------|-----|
| Text-only | `anthropic/claude-3-haiku` | Fast, cheap, strong instruction following |
| Vision (screenshot) | `openai/gpt-4o-mini` | Supports images, good privacy policy |

---

## LLM Response JSON shapes

The LLM always returns one of these four shapes (enforced by `response_format: { type: 'json_object' }`):

```json
// Direct action
{ "action": "setVolume", "params": { "level": 80 }, "reply": "I'll turn the volume up to 80%." }

// Needs screenshot for context
{ "action": "needs_screenshot", "params": null, "reply": "Let me take a look at your screen first." }

// Can't help
{ "action": "no_match", "params": null, "reply": "I can only help with volume, brightness, text size, and opening apps." }

// Needs clarification
{ "action": "clarify", "params": { "question": "Which app?" }, "reply": "Which app would you like me to open?" }
```

---

## Action allowlist (8 actions)

```
setTextSize(scale)       scale: 100 | 125 | 150 | 175 | 200
setBrightness(level)     level: 0–100
setVolume(level)         level: 0–100
openApp(name)            name: string
closeActiveWindow()      no params
closeScamPopup()         no params
readScreenAloud()        no params
sendHelpToFamily(summary) summary: string
```

Any action not in this list → treated as `no_match` by pipeline.js.

---

## Actions that require confirmation

```js
const REQUIRES_CONFIRMATION = [
  'setTextSize',
  'openApp',
  'closeActiveWindow',
  'closeScamPopup',
  'sendHelpToFamily',
];
// setBrightness, setVolume, readScreenAloud do NOT require confirmation
```

---

## Privacy

- `x-or-policy: no-training` header on every OpenRouter request
- Screenshots never written to disk — base64 lives in memory only for the duration of the pipeline call
- No conversation history stored between sessions

---

## Environment variables

```
OPENROUTER_API_KEY=<your key>   # required — set in .env or Electron main process env
```

---

## Error handling

Every error in pipeline.js is caught and returns a safe fallback — never throws to the IPC handler:

| Error | User sees |
|-------|-----------|
| OpenRouter 4xx | "I had trouble understanding that. Try again?" |
| OpenRouter 5xx | "The assistant is unavailable right now." |
| JSON parse failure | "I got a confusing response. Try again?" |
| Action not in allowlist | "I can only help with the actions I know." |
| Screenshot failure | Proceeds without screenshot |
| Network timeout >4s | "That took too long. Check your internet connection." |

---

## Progress log

### Session 1
- Created `llm-integration/` folder and `MEMORY.md`
- Confirmed stub contract from `stubs.js`
- Design doc at `.kiro/specs/kiro-accessibility-assistant/design.md`
- Requirements at `.kiro/specs/kiro-accessibility-assistant/requirements.md`

### Session 2
- Installed `dotenv` dependency (`17.4.2`) in `senior-assistant/package.json`
- Created `.env` placeholder at `senior-assistant/llm-integration/.env`
- Created `screenshot.js` — async `capture()` using Electron `desktopCapturer`, returns raw base64 PNG, throws `ScreenshotError` on failure, never writes to disk
- Created `llm.js` — `textQuery()` (claude-3-haiku) and `visionQuery()` (gpt-4o-mini), system prompt from design doc, `x-or-policy: no-training` header on every request, uses built-in `fetch` (no node-fetch)
- Created `pipeline.js` — full orchestration layer:
  - `ALLOWED_ACTIONS` array (11 entries including control actions)
  - `REQUIRES_CONFIRMATION` set (5 actions)
  - `validateAction()` — allowlist enforcement
  - `clampLevel()` — clamps to [0, 100], defaults to 50
  - `nearestScale()` — snaps to nearest of [100, 125, 150, 175, 200], defaults to 150
  - `handleQuery()` — text query → optional screenshot → action validation → parameter clamping → stub contract mapping, full try/catch
  - 6 property tests (all pass):
    - Property 1: Action allowlist enforcement
    - Property 2: Pipeline never throws
    - Property 3: Numeric parameter clamping
    - Property 4: setTextSize scale validation
    - Property 5: Vision path only triggered by needs_screenshot
    - Property 6: Reply field always present
- Created `mock-setup.js` at `senior-assistant/` — mocks `electron` module and sets placeholder API key for running tests in plain Node.js
- Added `test:pipeline` script to `package.json`: `node --require ./mock-setup.js llm-integration/pipeline.js`
- Wired `stubs.js` — replaced bodies of `getAssistantResponse` (delegates to `pipeline.handleQuery`) and `captureScreenshot` (delegates to `screenshotModule.capture().catch(() => null)`). Other stubs untouched.
- Created `smoke-test.js` — 3 mocked tests (all pass):
  - Test 1: text path → `action.name === 'setTextSize'`
  - Test 2: screenshot path → `screenshot.capture()` invoked
  - Test 3: error resilience → non-empty `speak`, no throw

---

## How to run tests

```bash
# Property tests (6 tests, no API key needed)
cd senior-assistant
npm run test:pipeline

# Smoke tests (3 tests, no API key needed)
node --require ./mock-setup.js llm-integration/smoke-test.js

# Live API test (requires real OPENROUTER_API_KEY in .env)
node -e "require('dotenv').config({ path: './llm-integration/.env' }); const llm = require('./llm-integration/llm'); llm.textQuery('make my text bigger').then(r => console.log(JSON.stringify(r, null, 2)))"
```

---

## Next steps
1. ~~Create `screenshot.js`~~ ✅
2. ~~Create `llm.js`~~ ✅
3. ~~Create `pipeline.js`~~ ✅
4. ~~Update `stubs.js` to delegate to pipeline.js~~ ✅
5. ~~Smoke test~~ ✅
6. Final checkpoint — full IPC round-trip (manual: `npm start`, type "make my text bigger", verify UI transitions)
7. Remove temporary `if (require.main === module)` verification blocks from `screenshot.js` and `llm.js` before final demo
