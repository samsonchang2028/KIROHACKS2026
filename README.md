# Pal: Senior Accessibility Assistant

A voice-first desktop assistant that helps seniors interact with their computer through natural speech. Built with Electron, Whisper, GPT-4o-mini, and Edge-TTS.

Seniors can ask things like "play some Frank Sinatra," "is this a scam?," "my computer is slow," or "help me join a Zoom call" and the assistant handles it.

## Features

- Voice input with automatic silence detection (stops recording when you stop talking)
- Smart intent mapping (e.g. "I want to watch cooking videos" opens YouTube with a search)
- Screenshot-based scam detection (takes a screenshot, analyzes it, tells you if it's safe)
- Proactive system monitoring (detects high memory usage, suggests closing apps)
- Guided walkthroughs with on-screen highlighting (e.g. walks you through joining a Zoom call)
- Cross-platform: runs on macOS and Windows from a single codebase

## Prerequisites

- **Node.js** 18 or later
- **ffmpeg** (required for audio conversion)
  - macOS: `brew install ffmpeg`
  - Windows: `choco install ffmpeg` or download from https://ffmpeg.org
- **OpenRouter API key** (required for the AI brain)
  - Sign up at https://openrouter.ai and add credits ($5 is plenty)
- **edge-tts** (optional, for higher quality neural voices)
  - `pip install edge-tts`
  - Falls back to OS native TTS if not installed

## Setup

```bash
# Clone the repo
git clone https://github.com/samsonchang2028/KIROHACKS2026.git
cd KIROHACKS2026/senior-assistant

# Install dependencies (also downloads the Whisper speech-to-text model)
npm install

# Create your environment file
cp .env.example .env
```

Open `.env` in a text editor and add your API key:

```
OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

Optionally add an OpenAI key for cloud Whisper fallback:

```
OPENAI_API_KEY=sk-your-key-here
```

## Running the App

```bash
npm start
```

This launches two windows:
1. A floating circular button in the bottom-right corner (click to open the assistant)
2. The assistant panel (appears when you click the button or press Cmd+Space / Ctrl+Space)

## How to Use

**Voice (primary):** Click the mic button, speak your request, and wait. Recording stops automatically when you stop talking.

**Text (secondary):** Type in the "or type here" input at the bottom and press Enter.

**Suggestion chips:** Click any of the preset suggestions on the home screen.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+Space (Mac) / Ctrl+Space (Win) | Open the assistant |
| Cmd+Shift+S / Ctrl+Shift+S | Trigger memory check (proactive suggestion) |
| Cmd+Shift+R / Ctrl+Shift+R | Trigger reboot suggestion |

## Demo Mode

For demos, you can fake system conditions by setting environment variables in `.env`:

```
DEMO_UPTIME_DAYS=5        # Pretend the computer has been on for 5 days
DEMO_RAM_USAGE_PCT=92     # Pretend 92% of RAM is in use
```

## Example Commands

- "Make my text bigger"
- "Turn up the volume"
- "Open YouTube"
- "Play some Frank Sinatra"
- "I want to watch cooking videos"
- "My computer is so slow"
- "There's a scary popup on my screen"
- "Am I looking at a scam?"
- "Help me join a Zoom meeting"

## Whisper Speech-to-Text

The app uses local Whisper (whisper.cpp) for offline speech recognition. The binary and model are downloaded automatically during `npm install`.

After install, verify these files exist:

```
node_modules/whisper-node/lib/whisper.cpp/main          (macOS binary)
node_modules/whisper-node/lib/whisper.cpp/main.exe       (Windows binary)
node_modules/whisper-node/lib/whisper.cpp/models/ggml-base.bin  (model)
```

If local Whisper is not available, the app falls back to the OpenAI Whisper cloud API (requires `OPENAI_API_KEY` in `.env`).

## Text-to-Speech

The app tries edge-tts first (Microsoft neural voices, requires internet). If edge-tts is not installed, it falls back to:
- macOS: `say` command
- Windows: `System.Speech.Synthesis`

To install edge-tts for better voice quality:

```bash
pip install edge-tts
```

## Architecture

```
renderer.html / renderer.js / styles.css    UI (Electron renderer process)
main.js                                      Electron main process, IPC, window management
stubs.js                                     System actions (volume, apps, TTS, STT)
llm-integration/
  llm.js                                     LLM API calls (text + vision)
  pipeline.js                                Intent validation, parameter clamping, orchestration
  screenshot.js                              Screen capture for vision analysis
system-monitor.js                            Proactive system health checks
walkthroughs.js                              Guided step-by-step walkthroughs
overlay.html                                 Transparent highlight overlay for walkthroughs
```

## Troubleshooting

- **"Payment Required" errors:** Your OpenRouter account is out of credits. Add funds at https://openrouter.ai/settings/credits
- **"Whisper warm-up failed":** The whisper.cpp binary or model is missing. Delete `node_modules` and run `npm install` again.
- **No sound:** Install edge-tts (`pip install edge-tts`) or verify your OS TTS works.
- **Transcription empty:** Check that ffmpeg is installed (`ffmpeg -version`).
- **Crash on startup:** Make sure `OPENROUTER_API_KEY` is set in `.env`.

## License

MIT
