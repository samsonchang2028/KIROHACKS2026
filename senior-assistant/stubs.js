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
// speak — Person 2 (OS native TTS)
// ---------------------------------------------------------------------------

// Active TTS process — tracked so we can kill it to support interruption.
let _ttsProcess = null;

// Speaks text aloud using the OS native TTS engine.
// macOS: `say` command. Windows: PowerShell with System.Speech.
// Non-blocking — spawns a child process and returns immediately.
// Calling speak() again while speech is in progress cancels the previous one.
async function speak(text) {
  if (!text || typeof text !== "string") return;

  // Kill any in-progress speech so the new utterance takes priority.
  stopSpeaking();

  console.log("[speak]:", text);

  const platform = process.platform;

  if (platform === "darwin") {
    // macOS — use the `say` command with a calm voice and moderate rate.
    // Rate 175 ≈ 140-150 wpm spoken pace.
    _ttsProcess = spawn("say", ["-r", "175", text]);
  } else if (platform === "win32") {
    // Windows — use PowerShell with System.Speech.Synthesis.
    const psScript = `
      Add-Type -AssemblyName System.Speech;
      $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;
      $synth.Rate = -2;
      $synth.Speak('${text.replace(/'/g, "''")}');
    `;
    _ttsProcess = spawn("powershell", ["-NoProfile", "-Command", psScript]);
  } else {
    // Linux fallback — try espeak if available.
    _ttsProcess = spawn("espeak", ["-s", "140", text]);
  }

  // Log errors but don't throw — TTS failure should never crash the app.
  _ttsProcess.on("error", (err) => {
    console.error("[speak] TTS process error:", err.message);
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
  return null;
}

module.exports = {
  transcribeAudio,
  getAssistantResponse,
  executeAction,
  speak,
  stopSpeaking,
  captureScreenshot,
};
