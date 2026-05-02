# Implementation Plan: LLM Integration Layer

## Overview

Build the three files that replace the two stubs owned by Person 3: `screenshot.js`, `llm.js`, and `pipeline.js`. Then wire `stubs.js` to delegate to them. Ordered for a hackathon: get the environment working first, build the simplest file, then layer up to the full pipeline.

## Tasks

- [x] 1. Set up the development environment
  - Create a `.env` file at `senior-assistant/.env` with `OPENROUTER_API_KEY=<your key>`
  - Sign up at https://openrouter.ai, generate an API key, and paste it into `.env`
  - Install `dotenv` as a dependency: `npm install dotenv` inside `senior-assistant/`
  - Download NirCmd from https://www.nirsoft.net/utils/nircmd.html and place the binary somewhere on PATH (needed by the executeAction teammate, but verify it runs: `nircmd.exe setvolume 0 65535 65535`)
  - Add `.env` to `.gitignore` if not already there
  - _Requirements: Environment setup, Privacy (API key must not be committed)_

- [x] 2. Implement `screenshot.js`
  - [x] 2.1 Create `senior-assistant/llm-integration/screenshot.js`
    - Export a single async `capture()` function
    - Call `desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } })`
    - Take `sources[0].thumbnail`, call `.toPNG()` to get a Buffer, then `.toString('base64')` — return the raw base64 string (no `data:image/png;base64,` prefix)
    - Wrap in try/catch — on failure, `console.error('[LLM ERROR] screenshot:', err)` and throw a `ScreenshotError`
    - Never write the buffer to disk
    - _Requirements: captureScreenshot() stub contract, Privacy (screenshot never written to disk)_

  - [x] 2.2 Manually verify `screenshot.js` returns a non-empty base64 string
    - Add a temporary `if (require.main === module)` block that calls `capture()` and logs `result.length` — remove after verification
    - _Requirements: Testing strategy — screenshot.js smoke test_

- [x] 3. Implement `llm.js`
  - [x] 3.1 Create `senior-assistant/llm-integration/llm.js`
    - Load `OPENROUTER_API_KEY` from `process.env` at module load time; throw a clear error if missing
    - Define the `SYSTEM_PROMPT` constant (copy verbatim from design doc)
    - Define shared request headers: `Authorization`, `Content-Type`, `HTTP-Referer`, `X-Title`, `x-or-policy: no-training`
    - _Requirements: Privacy (x-or-policy header on every request), API key from environment_

  - [x] 3.2 Implement `textQuery(userMessage)` in `llm.js`
    - POST to `https://openrouter.ai/api/v1/chat/completions`
    - Model: `anthropic/claude-3-haiku`
    - Messages: `[{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMessage }]`
    - Options: `max_tokens: 256`, `temperature: 0.1`, `response_format: { type: 'json_object' }`
    - Parse `response.choices[0].message.content` as JSON and return the parsed object
    - Throw on non-2xx HTTP status or JSON parse failure (pipeline.js catches these)
    - _Requirements: LLM pipeline design, OpenRouter API shape_

  - [x] 3.3 Implement `visionQuery(userMessage, screenshotBase64)` in `llm.js`
    - Same POST target and headers as `textQuery`
    - Model: `openai/gpt-4o-mini`
    - User message content is an array: `[{ type: 'text', text: userMessage }, { type: 'image_url', image_url: { url: \`data:image/png;base64,${screenshotBase64}\` } }]`
    - Same options and response parsing as `textQuery`
    - _Requirements: Vision path, OpenRouter vision request shape_

  - [x] 3.4 Write unit test for `llm.js` request shape
    - Add a temporary `if (require.main === module)` block that calls `textQuery('make my text bigger')`, logs the raw response, and verifies the returned object has `action`, `params`, and `reply` fields — remove after verification
    - _Requirements: Testing strategy — llm.js request body verification_

- [x] 4. Implement `pipeline.js`
  - [x] 4.1 Create `senior-assistant/llm-integration/pipeline.js` with the action allowlist and confirmation set
    - Define `ALLOWED_ACTIONS` array (all 8 actions plus `needs_screenshot`, `no_match`, `clarify`)
    - Define `REQUIRES_CONFIRMATION` set: `['setTextSize', 'openApp', 'closeActiveWindow', 'closeScamPopup', 'sendHelpToFamily']`
    - _Requirements: Action catalog, Safety rules (never trust LLM output)_

  - [x] 4.2 Implement parameter clamping and scale validation helpers in `pipeline.js`
    - `clampLevel(value)` — clamps any number to [0, 100]; returns 50 as default for non-numbers
    - `nearestScale(value)` — snaps to nearest value in `[100, 125, 150, 175, 200]`; returns 150 as default for invalid input
    - Apply `clampLevel` to `setBrightness` and `setVolume` params; apply `nearestScale` to `setTextSize` params
    - _Requirements: setBrightness(level), setVolume(level), setTextSize(scale) action catalog entries_

  - [x] 4.3 Write property test for action allowlist enforcement (Property 1)
    - **Property 1: Action allowlist enforcement**
    - **Validates: Requirements — Action catalog, Safety rules**
    - For a set of arbitrary strings (valid actions, invalid strings, empty string, SQL injection, long strings), assert that `validateAction(str)` returns either the original string (if in allowlist) or `'no_match'` — never anything else

  - [x] 4.4 Write property test for numeric parameter clamping (Property 3)
    - **Property 3: Numeric parameter clamping**
    - **Validates: Requirements — setBrightness(level), setVolume(level)**
    - For a range of numeric inputs including negatives, values over 100, floats, and NaN, assert that `clampLevel(value)` always returns a number in [0, 100]

  - [x] 4.5 Write property test for setTextSize scale validation (Property 4)
    - **Property 4: setTextSize scale validation**
    - **Validates: Requirements — setTextSize(scale)**
    - For arbitrary numeric inputs, assert that `nearestScale(value)` always returns one of `[100, 125, 150, 175, 200]`

  - [x] 4.6 Implement `handleQuery(userMessage)` in `pipeline.js`
    - Call `llm.textQuery(userMessage)` and parse the result
    - If `action === 'needs_screenshot'`: call `screenshot.capture()` (catch failure — proceed without screenshot on error, log `[LLM ERROR]`), then call `llm.visionQuery(userMessage, base64)`
    - Validate `action` against `ALLOWED_ACTIONS`; if not in list, log `[LLM ERROR] security: unexpected action` and replace with `no_match`
    - Apply parameter clamping/validation for `setBrightness`, `setVolume`, `setTextSize`
    - Map pipeline result to stub contract shape: `{ speak: reply, action: (action is executable ? { name: action, params } : null), requiresConfirmation: REQUIRES_CONFIRMATION.includes(action) }`
    - Wrap entire function body in try/catch — on any uncaught error, return `{ speak: '<safe message>', action: null, requiresConfirmation: false }`
    - _Requirements: LLM pipeline design, Error handling strategy, Stub contract_

  - [x] 4.7 Write property test for pipeline never throws (Property 2)
    - **Property 2: Pipeline never throws to caller**
    - **Validates: Requirements — Error handling strategy**
    - Mock `llm.textQuery` to throw various errors (network error, JSON parse error, HTTP 500), then assert that `handleQuery` always resolves (never rejects) and always returns an object with `speak`, `action`, and `requiresConfirmation` fields

  - [x] 4.8 Write property test for reply field always present (Property 6)
    - **Property 6: Reply field always present and non-empty**
    - **Validates: Requirements — UX rules (voice everything)**
    - For all error paths and all valid LLM response shapes, assert that the returned object's `speak` field is a non-empty string

  - [x] 4.9 Write property test for vision path only triggered by needs_screenshot (Property 5)
    - **Property 5: Vision path only triggered by needs_screenshot**
    - **Validates: Requirements — LLM pipeline design**
    - Mock `llm.textQuery` to return each possible action value; assert that `screenshot.capture` is called if and only if `action === 'needs_screenshot'`

- [x] 5. Checkpoint — verify pipeline works end-to-end before wiring stubs
  - Run `node -e "require('dotenv').config(); const p = require('./llm-integration/pipeline'); p.handleQuery('make my text bigger').then(console.log)"` from `senior-assistant/`
  - Confirm the returned object has `speak` (non-empty string), `action` (`{ name: 'setTextSize', params: { scale: 150 } }`), and `requiresConfirmation: true`
  - If the response shape is wrong, fix `pipeline.js` before proceeding
  - _Requirements: Testing strategy — demo smoke test_

- [x] 6. Wire `stubs.js` to delegate to `pipeline.js` and `screenshot.js`
  - [x] 6.1 Update `senior-assistant/stubs.js` — replace `getAssistantResponse` body
    - Add `require('dotenv').config()` at the top of `stubs.js` (or confirm it's loaded in `main.js` before stubs are required)
    - Add `const pipeline = require('./llm-integration/pipeline')` at the top
    - Replace the body of `getAssistantResponse(text, screenshot)` with `return pipeline.handleQuery(text, screenshot)`
    - Keep the function signature `(text, screenshot)` unchanged
    - _Requirements: Stub contract (frozen signatures), getAssistantResponse return shape_

  - [x] 6.2 Update `senior-assistant/stubs.js` — replace `captureScreenshot` body
    - Add `const screenshot = require('./llm-integration/screenshot')` at the top
    - Replace the body of `captureScreenshot()` with `return screenshot.capture().catch(() => null)`
    - Keep the function signature unchanged; callers already handle `null`
    - _Requirements: Stub contract (frozen signatures), captureScreenshot return shape_

- [x] 7. Write and run the smoke test script
  - Create `senior-assistant/llm-integration/smoke-test.js`
  - Test 1 — text path: call `pipeline.handleQuery('make my text bigger')`, assert `action.name === 'setTextSize'`
  - Test 2 — screenshot path: call `pipeline.handleQuery('what is on my screen')`, assert `screenshot.capture()` was invoked (log the base64 length)
  - Test 3 — error resilience: call `pipeline.handleQuery('')`, assert the result has a non-empty `speak` field and does not throw
  - Log `[PASS]` or `[FAIL]` for each test with the actual result
  - Run with: `node llm-integration/smoke-test.js` from `senior-assistant/`
  - _Requirements: Testing strategy — demo smoke test, full IPC round-trip_

- [x] 8. Final checkpoint — full IPC round-trip
  - Start the Electron app (`npm start` from `senior-assistant/`)
  - Open the chat window and type "make my text bigger" (or use the mic)
  - Confirm the UI transitions: Thinking → Confirming, with the spoken reply and Yes/No buttons
  - Confirm the browser devtools console shows no `[LLM ERROR]` entries
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- The stub signatures in `stubs.js` are frozen — only replace the function bodies
- `desktopCapturer` only works in the Electron main process; `screenshot.js` must be required from `main.js` or the IPC handler, never from the renderer
- The `x-or-policy: no-training` header is the primary privacy control — it must appear on every OpenRouter request
- Property tests (4.3–4.9) can be written as simple assertion scripts with `console.assert` if no test framework is set up — no Jest required for a hackathon
- Screenshots never touch disk; the base64 string lives only in memory for the duration of one `handleQuery` call
