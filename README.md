# KIROHACKS2026

AI-powered desktop accessibility assistant for seniors.

## Quick Setup

```bash
# 1. Install system dependencies
# macOS:
brew install ffmpeg
pip install edge-tts

# Windows:
choco install ffmpeg -y
pip install edge-tts

# 2. Install Node dependencies + Whisper model (automatic)
cd senior-assistant
npm install

# 3. Add your API key
cp .env.example .env
# Edit .env and add OPENROUTER_API_KEY

# 4. Run
npm start
```

## System Dependencies

| Dependency      | Required    | Install                                                               |
| --------------- | ----------- | --------------------------------------------------------------------- |
| ffmpeg          | Yes         | `brew install ffmpeg` (Mac) / `choco install ffmpeg` (Win)            |
| edge-tts        | Recommended | `pip install edge-tts` (all platforms)                                |
| C++ build tools | Yes         | `xcode-select --install` (Mac) / `npm i -g windows-build-tools` (Win) |

## Architecture

See `.kiro/specs/kiro-accessibility-assistant/requirements.md` for the full spec.

Stub functions in `stubs.js` are the integration boundary:

| Function                                 | Owner    | Status                                 |
| ---------------------------------------- | -------- | -------------------------------------- |
| `transcribeAudio(blob)`                  | Person 2 | ✅ Local Whisper (whisper.cpp)         |
| `speak(text)`                            | Person 2 | ✅ edge-tts neural voice + OS fallback |
| `getAssistantResponse(text, screenshot)` | Person 3 | ✅ Claude via OpenRouter               |
| `captureScreenshot()`                    | Person 3 | ✅ Electron desktopCapturer            |
| `executeAction(action)`                  | Person 4 | Stub                                   |

## Troubleshooting

- **No sound**: `pip install edge-tts` and restart
- **Transcription empty**: Check `ffmpeg -version` works
- **npm install fails**: Install C++ build tools (see above)
- **Crash on startup**: Add `OPENROUTER_API_KEY` to `.env`
