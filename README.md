# KIROHACKS2026

AI-powered desktop accessibility assistant for seniors.

## Setup

```bash
cd senior-assistant
npm install
```

### System dependencies

**ffmpeg** (required) — used to convert audio formats for Whisper transcription:

```bash
# macOS
brew install ffmpeg

# Windows (via chocolatey)
choco install ffmpeg
```

**sox** (optional) — only needed if you want to test speech-to-text from the command line:

```bash
# macOS
brew install sox

# Then run the mic test:
node test-mic.js
```

## Run the app

```bash
cd senior-assistant
npm start
```

## Architecture

See `.kiro/specs/kiro-accessibility-assistant/requirements.md` for the full spec.

Stub functions in `stubs.js` are the integration boundary:

| Function                                 | Owner    | Status                         |
| ---------------------------------------- | -------- | ------------------------------ |
| `transcribeAudio(blob)`                  | Person 2 | ✅ Local Whisper (whisper.cpp) |
| `speak(text)`                            | Person 2 | ✅ OS native TTS               |
| `getAssistantResponse(text, screenshot)` | Person 3 | Stub                           |
| `executeAction(action)`                  | Person 4 | Stub                           |
| `captureScreenshot()`                    | Person 3 | Stub                           |
