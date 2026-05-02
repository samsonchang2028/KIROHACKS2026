---
inclusion: auto
---

# Project Setup Instructions

This is a hackathon project — an Electron desktop accessibility assistant for seniors.

## System Dependencies

Before running the app, these must be installed at the OS level. They cannot be installed via npm.

### Required

**ffmpeg** — Converts audio formats for Whisper speech-to-text.

- macOS: `brew install ffmpeg`
- Windows: `choco install ffmpeg -y` (requires Chocolatey) or download from https://ffmpeg.org/download.html

**C++ build tools** — Required to compile whisper.cpp during `npm install`.

- macOS: `xcode-select --install`
- Windows: `npm install --global windows-build-tools` or install Visual Studio Build Tools

### Recommended

**edge-tts** — Microsoft neural TTS voices (much better than OS default voices). Free, no API key.

- All platforms: `pip install edge-tts`
- If pip isn't available: `pip3 install edge-tts`
- The app falls back to OS native TTS if edge-tts is not installed, but the voice quality is significantly worse.

## Node Setup

```bash
cd senior-assistant
npm install
```

This automatically:

1. Installs all Node dependencies
2. Compiles whisper.cpp from source
3. Downloads the Whisper base model (~140MB) via the postinstall script

## Environment Variables

Copy `.env.example` to `.env` and fill in the keys:

```
OPENROUTER_API_KEY=<get from Person 3 or sign up at openrouter.ai>
```

The `.env` file is gitignored and must never be committed.

## Running the App

```bash
cd senior-assistant
npm start
```

## Troubleshooting

- **No sound from TTS**: Install edge-tts (`pip install edge-tts`) and restart the app
- **Transcription returns empty**: Check that ffmpeg is installed (`ffmpeg -version`) and the Whisper model exists at `node_modules/whisper-node/lib/whisper.cpp/models/ggml-base.bin`
- **npm install fails with C++ errors**: Install build tools (see above)
- **App crashes on startup with OPENROUTER_API_KEY error**: Add the key to `.env`

## Architecture Quick Reference

- `stubs.js` — Integration boundary. Frozen function signatures. Each teammate replaces function bodies.
- `main.js` — Electron main process, IPC handlers, window management
- `renderer.js` — Chat UI, mic recording, state machine
- `llm-integration/` — Person 3's AI brain (Claude via OpenRouter)
- Voice (Person 2): `transcribeAudio` uses local whisper.cpp, `speak` uses edge-tts with OS native fallback
