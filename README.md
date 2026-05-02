# KIROHACKS2026

AI-powered desktop accessibility assistant for seniors.

## Quick Setup

```bash
# 1. Install Node dependencies (also downloads whisper.cpp binary + model)
cd senior-assistant
npm install

# 2. Add your API key
cp .env.example .env
# Edit .env and add OPENROUTER_API_KEY

# 3. Run
npm start
```

## System Dependencies

| Dependency | Required | Install                                                    |
| ---------- | -------- | ---------------------------------------------------------- |
| ffmpeg     | Yes      | `brew install ffmpeg` (Mac) / `choco install ffmpeg` (Win) |

## Whisper.cpp (Speech-to-Text)

The whisper.cpp binary (`main.exe`) and model (`ggml-base.en.bin`) are **bundled
automatically** by the `whisper-node` npm package during `npm install`. No manual
compilation or C++ build tools are needed.

After install, verify the files exist:

```text
senior-assistant/node_modules/whisper-node/lib/whisper.cpp/main.exe      (binary)
senior-assistant/node_modules/whisper-node/lib/whisper.cpp/models/ggml-base.en.bin  (model)
```

If either file is missing, try deleting `node_modules` and running `npm install` again.

**Cloud fallback:** If local whisper.cpp isn't available, the app falls back to the
OpenAI Whisper API. Set `OPENAI_API_KEY` in your `.env` file to use it.

## Text-to-Speech (TTS)

The app uses **Windows native TTS** (`System.Speech.Synthesis`) by default. This
works out of the box with no extra setup.

**Optional: edge-tts** for higher-quality neural voices:

```bash
pip install edge-tts
```

The app auto-detects edge-tts at startup. If found, it uses Microsoft neural voices
(requires internet). If not found, it falls back to the offline OS native voice.
edge-tts is entirely optional.

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

- **"Whisper warm-up failed"**: The whisper.cpp binary or model is missing. Delete `node_modules` and run `npm install` again.
- **No sound**: Windows native TTS should work by default. For better voices, install `pip install edge-tts`.
- **Transcription empty**: Check that `ffmpeg` is installed and on your PATH (`ffmpeg -version`).
- **Crash on startup**: Make sure `OPENROUTER_API_KEY` is set in `.env`.
- **GPU cache errors on startup**: Harmless Electron warnings, safe to ignore.
