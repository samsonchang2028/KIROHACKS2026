# Requirements Document


## What this project is

A Windows desktop accessibility assistant for seniors. The app lives as a floating button on the desktop. The user taps it, speaks a problem in plain language ("my text is too small," "I can't find Chrome," "there's a scary message I can't close"), and the app performs the right Windows action while talking back in a warm voice.

Built for a hackathon. The Human-Centered Design track. Demo-driven — every decision should be evaluated against "does this make the live demo more impressive and reliable."

## Who the user is

A real senior, 65+, possibly with vision issues, possibly with cognitive load issues, definitely with low tolerance for jargon or small targets. Design for the user who:

- Can't read 12pt text comfortably
- Can't find icons that aren't obvious
- Won't read instructions
- Gets scared by popups and weird windows
- Calls their adult child instead of figuring it out

The app's job is to be the patient, infinitely available assistant they don't have to feel embarrassed asking.

**Never build "for seniors" branding into the UI.** No big "SENIOR HELPER" logos, no patronizing copy. The product should look respectful and clean — like Apple would design it. The framing in copy is "Helper," not "Grandma's app."

## Architecture

Electron + Node.js + plain HTML/CSS/JS in the renderer. No React, no TypeScript, no build tools beyond what Electron requires. Simplicity is a feature — four people on the team need to read each other's code fast.

```
senior-assistant/
├── main.js              Electron main process, window management, IPC handlers
├── preload.js           Bridges main and renderer via contextBridge
├── floating.html        The always-on-top circular button window
├── floating.js          Click handlers for the floating button
├── renderer.html        The chat window UI
├── renderer.js          Chat UI logic, mic recording, message rendering
├── styles.css           Shared styles (large text, high contrast)
├── stubs.js             Placeholder functions for AI brain and system actions
└── package.json
```

Two windows:

1. **Floating button** — 80x80, frameless, transparent, always-on-top, draggable. Lives bottom-right by default.
2. **Chat window** — 480x600, opens when the floating button is tapped or Ctrl+Space is pressed. Shows conversation, mic button, status.

## Stub-first build

The shell is being built first with stubs. Other teammates will replace the stubs:

| Stub function | Lives in | Replaced by | Replaced when |
|---|---|---|---|
| `transcribeAudio(blob)` | stubs.js | Whisper API | Voice team is ready |
| `getAssistantResponse(msg, screenshot)` | stubs.js | Anthropic API with vision + function-calling | AI brain team is ready |
| `executeAction(action)` | stubs.js | nut.js / PowerShell wrappers | System actions team is ready |
| `speak(text)` | stubs.js | ElevenLabs or OpenAI TTS | Voice team is ready |
| `captureScreenshot()` | stubs.js | screenshot-desktop or Electron desktopCapturer | AI brain team is ready |

**Never call real LLMs, real TTS, or real system actions from inside this codebase yet.** Keep everything routed through the stubs in `stubs.js` so the integrations land cleanly later.

## UX rules (non-negotiable)

These are not style preferences. The product fails without them.

- **All body text is minimum 20pt.** No exceptions. Confirmation text should be larger.
- **All tap targets are minimum 80px tall.** The mic button is 120px.
- **High contrast.** Dark text on white, or white on dark. No light gray on white.
- **One thing on screen at a time.** Don't show multiple options or menus. The senior describes a problem, the app proposes one action, the senior says yes or no.
- **Always confirm before acting.** Every action gets a "I'll do X, okay?" prompt with big Yes/No buttons unless it's clearly trivial (like reading something aloud).
- **Voice everything.** Every message in the chat window is also spoken aloud. State changes ("Listening," "Thinking," "Done") are spoken too.
- **No nested menus.** If a feature can't be reached in one tap, it doesn't ship.
- **No icons without labels.** A microphone icon alone is not enough. Always pair with text.

## State machine for the mic button

The mic button has exactly 5 states, each visually distinct:

- **Idle** — solid blue (`#4A90E2`), label "Tap to talk"
- **Listening** — pulsing red, label "Listening..."
- **Thinking** — spinning, label "Thinking..."
- **Confirming** — replaced by two big buttons (Yes green, No red)
- **Doing** — solid green, label "Doing it now..."

Transitions:
```
Idle → Listening (on mic press)
Listening → Thinking (on mic release, audio sent for transcription)
Thinking → Confirming (assistant returns an action that requires confirmation)
Thinking → Doing (assistant returns an action that does NOT require confirmation, e.g. read aloud)
Confirming → Doing (user taps Yes)
Confirming → Idle (user taps No)
Doing → Idle (action completes)
```

Always announce state transitions via `speak()` so users who can't see the screen still know what's happening.

## Action catalog (the only things the app can do)

The LLM agent is allowed to pick from this fixed allowlist. **Never let the LLM execute free-form code or commands.** The LLM picks an action name from this list and provides parameters; the action is executed by a hand-written function in the codebase.

The 8 actions for v1:

1. `setTextSize(scale: number)` — adjust Windows display scaling (100, 125, 150, 175, 200)
2. `setBrightness(level: number)` — 0 to 100
3. `setVolume(level: number)` — 0 to 100
4. `openApp(name: string)` — fuzzy-match against installed apps and launch
5. `closeActiveWindow()` — close the foreground window
6. `closeScamPopup()` — identify and close a popup matching scam patterns
7. `readScreenAloud()` — OCR or accessibility-tree extraction, then TTS
8. `sendHelpToFamily(summary: string)` — email a screenshot + recent context to a designated address

If a 9th action is being considered, push back. The catalog is locked at 8. More actions = more failure modes = worse demo.

## Safety rules

- **Never click "Buy," "Pay," "Send," "Confirm," "Accept," or "Subscribe"** in any window. Even if the LLM thinks it should.
- **Never type into password fields, payment fields, or anything resembling sensitive input.**
- **Never take an action without confirmation** unless it's reversible and trivial (like reading text aloud or adjusting volume).
- **Always log every action** so the family loop and undo features can show what happened.
- **Always be able to undo.** Text size changes, app launches, and window closes should all be reversible.

If a request is ambiguous, the LLM should ask a clarifying question, not guess.

## Demo script (build toward this)

The live demo is 2:30 minutes. The senior (played by a teammate) is on a messy desktop with:
- Tiny system text
- A scam popup open in the corner
- Chrome unpinned and buried in the start menu

The demo:

1. Senior taps floating button: *"I can't see anything and there's a scary message I can't close."*
2. App: *"I see the message — that's a scam, not a real virus. I'll close it."* → closes popup → *"I also noticed your text is small. Should I make it bigger?"*
3. Senior: *"Yes please."*
4. App: scales text → *"Done. Looks better?"*
5. Senior: *"I want to check my email but I can't find Chrome."*
6. App: *"I'll open Chrome for you and put a shortcut on your desktop so it's easy to find next time."* → opens Chrome → places shortcut → *"There you go."*

Every commit should make this script smoother, faster, or more reliable. If a change doesn't help the demo, postpone it.

## Code style

- Plain JavaScript, no TypeScript
- Async/await, not promise chains
- Comments explain *why*, not *what*
- Functions over classes
- One concern per file
- No global state — pass things explicitly
- Console-log generously while building; clean up before final demo

## Performance targets

- Floating button click → chat window visible: under 200ms
- Mic release → transcription shown: under 1.5s (with real Whisper streaming)
- Transcription → assistant response shown: under 2s (with real LLM)
- Confirmation tap → action complete: under 1s
- Total flow (tap mic, speak, get response, confirm, see action): under 6 seconds

If the demo flow takes longer than 6 seconds end to end, the magic dies. Optimize for latency over feature count.

## What's out of scope

Don't build these. Other teammates may add them later, or they're explicitly cut.

- Real LLM integration (stubbed for this codebase)
- Real Windows automation (stubbed for this codebase)
- Real TTS / Whisper (stubbed for this codebase)
- Family loop email service (separate teammate's work)
- Multi-user accounts
- Settings / preferences panel beyond first-run welcome
- macOS or Linux support
- Persistent conversation history across sessions
- Telemetry, analytics, error reporting
- Internationalization

## Common pitfalls to avoid

- **Don't add features without asking.** This is hackathon code. Scope creep is the enemy.
- **Don't replace stubs with real implementations.** That's another teammate's job.
- **Don't refactor for elegance.** Working code beats clean code at hour 11.
- **Don't add TypeScript, build tools, or frameworks.** Plain JS only.
- **Don't put logic in HTML.** Renderer JS handles all behavior.
- **Don't break the contextBridge pattern.** All renderer→main communication goes through `window.api`.
- **Don't trust the LLM to format actions correctly.** The action allowlist is enforced in code, not by prompt.

## When in doubt

Optimize for the demo. Optimize for the senior. Cut features rather than ship flaky ones. Ask before adding scope
