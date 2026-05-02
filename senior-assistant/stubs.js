// stubs.js — Integration boundary for teammates building voice, AI brain, and system actions.
//
// CONTRACT: These five function signatures are frozen. Each teammate replaces the BODY of their
// function(s) without changing the name, parameters, or return shape. The shell depends on these
// shapes throughout — mismatched return values will break the UI, not just the stub.
//
// Owner map:
//   transcribeAudio     → Person 2 (Whisper + TTS)       ✅ IMPLEMENTED (local whisper.cpp)
//   getAssistantResponse → Person 3 (Anthropic vision + function-calling)
//   executeAction       → Person 4 (Windows automation)
//   speak               → Person 2 (TTS)                 ✅ IMPLEMENTED (OS native TTS)
//   captureScreenshot   → Person 3 (screenshot capture)

require('dotenv').config();
const pipeline = require('./llm-integration/pipeline');
const screenshotModule = require('./llm-integration/screenshot');
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn, execSync } = require("child_process");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Paths to the whisper.cpp binary and model bundled inside whisper-node.
const WHISPER_BIN = path.join(
  __dirname,
  "node_modules/whisper-node/lib/whisper.cpp/main",
);
const WHISPER_MODEL = path.join(
  __dirname,
  "node_modules/whisper-node/lib/whisper.cpp/models/ggml-base.bin",
);

// ---------------------------------------------------------------------------
// transcribeAudio — Person 2 (local Whisper STT via whisper.cpp)
// ---------------------------------------------------------------------------

// Converts a recorded audio Blob (or Buffer) to a transcription string.
// Uses whisper.cpp locally — no API key, no internet, completely free.
// The blob comes from the renderer's MediaRecorder via IPC.
async function transcribeAudio(blob) {
  // Convert whatever we receive into a Node Buffer.
  let buffer;
  if (Buffer.isBuffer(blob)) {
    buffer = blob;
  } else if (blob instanceof ArrayBuffer || ArrayBuffer.isView(blob)) {
    buffer = Buffer.from(blob);
  } else if (blob && typeof blob === "object" && blob.type) {
    const ab = await blob.arrayBuffer();
    buffer = Buffer.from(ab);
  } else {
    console.error("[transcribeAudio] Unexpected input type:", typeof blob);
    return "";
  }

  if (buffer.length === 0) {
    console.warn("[transcribeAudio] Empty audio buffer received.");
    return "";
  }

  // whisper.cpp requires a 16kHz mono WAV file.
  // The renderer's MediaRecorder typically produces webm/opus.
  // Write to temp file, convert to WAV with ffmpeg if needed, then transcribe.
  const tmpInput = path.join(os.tmpdir(), `whisper-in-${Date.now()}.webm`);
  const tmpWav = path.join(os.tmpdir(), `whisper-${Date.now()}.wav`);

  fs.writeFileSync(tmpInput, buffer);

  try {
    // Convert to 16kHz mono WAV using ffmpeg (available on most systems).
    // If the input is already WAV, ffmpeg handles it fine.
    try {
      execSync(
        `ffmpeg -y -i "${tmpInput}" -ar 16000 -ac 1 -c:a pcm_s16le "${tmpWav}" 2>/dev/null`,
        { timeout: 10000 },
      );
    } catch (convErr) {
      // If ffmpeg isn't available or conversion fails, try using the file directly.
      // This works if the input is already a compatible WAV.
      console.warn(
        "[transcribeAudio] ffmpeg conversion failed, trying raw file:",
        convErr.message,
      );
      fs.copyFileSync(tmpInput, tmpWav);
    }

    // Run local Whisper transcription by calling the whisper.cpp binary directly.
    // The whisper-node JS wrapper has a parsing bug, so we bypass it.
    try {
      const raw = execSync(
        `"${WHISPER_BIN}" -m "${WHISPER_MODEL}" -f "${tmpWav}" -l en --no-timestamps -t 4 2>/dev/null`,
        { timeout: 30000 },
      ).toString();

      // The transcript is everything after the model loading output.
      // With --no-timestamps, whisper.cpp prints plain text lines.
      const text = raw
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("[BLANK_AUDIO]"))
        .join(" ")
        .trim();

      console.log("[transcribeAudio] Result:", text);
      return text;
    } catch (whisperErr) {
      console.error(
        "[transcribeAudio] Whisper binary error:",
        whisperErr.message,
      );
      return "";
    }
  } catch (err) {
    console.error("[transcribeAudio] Whisper error:", err.message);
    return "";
  } finally {
    try {
      fs.unlinkSync(tmpInput);
    } catch (_) {
      /* ignore */
    }
    try {
      fs.unlinkSync(tmpWav);
    } catch (_) {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// speak — Person 2 (edge-tts neural voices with OS native fallback)
// ---------------------------------------------------------------------------

// Active TTS process — tracked so we can kill it to support interruption.
let _ttsProcess = null;

// edge-tts voice — warm, friendly, natural-sounding neural voice from Microsoft.
const EDGE_TTS_VOICE = "en-US-JennyNeural";

// Detect edge-tts availability once at startup.
let _edgeTtsCmd = null;

function findEdgeTts() {
  // Try common locations for the edge-tts CLI.
  const candidates = [
    path.join(__dirname, "..", ".venv", "bin", "edge-tts"),
    path.join(__dirname, "..", ".venv", "Scripts", "edge-tts.exe"),
    "edge-tts",
  ];
  for (const cmd of candidates) {
    try {
      // Check if the file exists (for absolute paths) or if the command runs.
      if (cmd.includes(path.sep) && fs.existsSync(cmd)) {
        return cmd;
      }
      execSync(`"${cmd}" --version`, { timeout: 3000, stdio: "ignore" });
      return cmd;
    } catch (_) {
      // not found, try next
    }
  }
  return null;
}

// Speaks text aloud using Microsoft neural voices via edge-tts.
// Falls back to OS native TTS (macOS `say`, Windows System.Speech) if edge-tts
// is unavailable or fails. Non-blocking — spawns a child process and returns
// immediately. Calling speak() again cancels any in-progress speech.
async function speak(text) {
  if (!text || typeof text !== "string") return;

  // Kill any in-progress speech so the new utterance takes priority.
  stopSpeaking();

  console.log("[speak]:", text);

  // Lazy-detect edge-tts on first call.
  if (_edgeTtsCmd === null) {
    _edgeTtsCmd = findEdgeTts() || false;
    if (_edgeTtsCmd) console.log("[speak] Using edge-tts:", _edgeTtsCmd);
    else console.log("[speak] edge-tts not found, using OS native TTS");
  }

  if (_edgeTtsCmd) {
    _speakWithEdgeTts(text);
  } else {
    _speakWithNativeTts(text);
  }
}

function _speakWithEdgeTts(text) {
  const tmpMp3 = path.join(os.tmpdir(), `tts-${Date.now()}.mp3`);
  const platform = process.platform;

  // edge-tts generates an mp3, then we play it with the OS audio player.
  // Run as a single shell command: generate → play → cleanup.
  let playCmd;
  if (platform === "darwin") {
    playCmd = `afplay "${tmpMp3}"`;
  } else if (platform === "win32") {
    // PowerShell can play audio via .NET.
    playCmd = `powershell -NoProfile -Command "(New-Object Media.SoundPlayer '${tmpMp3}').PlaySync()"`;
  } else {
    playCmd = `aplay "${tmpMp3}" 2>/dev/null || mpv --no-video "${tmpMp3}" 2>/dev/null`;
  }

  // Spawn a shell that generates then plays the audio.
  const shellCmd = `"${_edgeTtsCmd}" --text "${text.replace(/"/g, '\\"')}" --voice ${EDGE_TTS_VOICE} --write-media "${tmpMp3}" 2>/dev/null && ${playCmd}; rm -f "${tmpMp3}"`;

  _ttsProcess = spawn("sh", ["-c", shellCmd]);

  _ttsProcess.on("error", (err) => {
    console.error(
      "[speak] edge-tts error, falling back to native:",
      err.message,
    );
    _speakWithNativeTts(text);
  });

  _ttsProcess.on("close", (code) => {
    _ttsProcess = null;
    // If edge-tts failed (no internet, etc.), fall back to native.
    if (code !== 0 && code !== null) {
      console.warn("[speak] edge-tts exited with code", code, "— falling back");
      _speakWithNativeTts(text);
    }
  });
}

function _speakWithNativeTts(text) {
  const platform = process.platform;

  if (platform === "darwin") {
    _ttsProcess = spawn("say", ["-r", "175", text]);
  } else if (platform === "win32") {
    const psScript = `
      Add-Type -AssemblyName System.Speech;
      $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;
      $synth.Rate = -2;
      $synth.Speak('${text.replace(/'/g, "''")}');
    `;
    _ttsProcess = spawn("powershell", ["-NoProfile", "-Command", psScript]);
  } else {
    _ttsProcess = spawn("espeak", ["-s", "140", text]);
  }

  _ttsProcess.on("error", (err) => {
    console.error("[speak] Native TTS error:", err.message);
  });

  _ttsProcess.on("close", () => {
    _ttsProcess = null;
  });
}

// Stops any in-progress speech. Called internally when new speech starts,
// and can be called externally when the user says "stop" or "quiet".
function stopSpeaking() {
  if (_ttsProcess && !_ttsProcess.killed) {
    _ttsProcess.kill();
    _ttsProcess = null;
  }
}

// ---------------------------------------------------------------------------
// Stubs — other teammates' functions (unchanged)
// ---------------------------------------------------------------------------

// Sends user text + optional screenshot to the AI and returns a structured action decision.
// Return shape is the contract: { speak, action, requiresConfirmation }.
// action is either null (no system change needed) or { name, params } from the locked 8-action catalog.
async function getAssistantResponse(text, screenshot) {
  return pipeline.handleQuery(text, screenshot);
  await delay(800);
  return {
    speak: "I can make your text bigger. Should I do that?",
    action: { name: "setTextSize", params: { scale: 150 } },
    requiresConfirmation: true,
  };
}

// Executes a system action from the 8-action catalog.
// Replace body with real Windows automation; { name, params } shape must stay identical.
async function executeAction(action) {
  await delay(600);
  console.log("[ACTION]", action);
  return { success: true };
}

// Captures a screenshot of the current screen for AI vision context.
// Returns null until Person 3 wires it up — callers must handle null gracefully.
async function captureScreenshot() {
  return screenshotModule.capture().catch(() => null);
}

module.exports = {
  transcribeAudio,
  getAssistantResponse,
  executeAction,
  speak,
  stopSpeaking,
  captureScreenshot,
};
