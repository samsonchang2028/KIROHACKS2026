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

require("dotenv").config();
const pipeline = require("./llm-integration/pipeline");
const screenshotModule = require("./llm-integration/screenshot");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn, execSync } = require("child_process");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Paths to the whisper.cpp binary and model bundled inside whisper-node.
// On Windows the binary is main.exe; on other platforms it's just main.
const WHISPER_BIN = path.join(
  __dirname,
  "node_modules/whisper-node/lib/whisper.cpp",
  process.platform === "win32" ? "main.exe" : "main",
);
const WHISPER_MODEL = path.join(
  __dirname,
  "node_modules/whisper-node/lib/whisper.cpp/models/ggml-base.bin",
);

// Check if local whisper.cpp is available — if not, we'll use the cloud API.
const _hasLocalWhisper =
  fs.existsSync(WHISPER_BIN) && fs.existsSync(WHISPER_MODEL);

// ---------------------------------------------------------------------------
// Filler word stripping — cleans up natural speech before displaying
// ---------------------------------------------------------------------------

const FILLER_WORDS = [
  "you know",
  "sort of",
  "kind of",
  "i mean",
  "i guess",
  "actually",
  "basically",
  "literally",
  "honestly",
  "um",
  "uh",
  "hmm",
  "ah",
  "oh",
  "like",
];

// Build a single regex matching any filler as a whole word (case-insensitive).
// Longer phrases listed first so "you know" matches before "you".
const _FILLER_RE = new RegExp(
  "\\b(?:" +
    FILLER_WORDS.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(
      "|",
    ) +
    ")\\b",
  "gi",
);

function stripFillers(text) {
  return text
    .replace(_FILLER_RE, "")
    .replace(/\s{2,}/g, " ") // collapse double spaces left by removed fillers
    .replace(/^\s*,\s*/, "") // strip leading comma residue
    .replace(/\s*,\s*$/, "") // strip trailing comma residue
    .trim();
}

// ---------------------------------------------------------------------------
// Whisper model warm-up — pre-loads the model so first transcription is fast
// ---------------------------------------------------------------------------

function warmUpWhisper() {
  if (!fs.existsSync(WHISPER_BIN) || !fs.existsSync(WHISPER_MODEL)) {
    console.warn(
      "[warmup] Whisper binary or model not found, skipping warm-up.",
    );
    return;
  }

  // Generate a tiny 0.5s silent WAV and run whisper on it.
  // This forces the model into memory so the first real call is fast.
  const tmpWav = path.join(os.tmpdir(), "whisper-warmup.wav");
  const sr = 16000,
    ns = sr / 2,
    ds = ns * 2;
  const buf = Buffer.alloc(44 + ds);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + ds, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(ds, 40);
  fs.writeFileSync(tmpWav, buf);

  try {
    console.log("[warmup] Pre-loading Whisper model...");
    execSync(
      `"${WHISPER_BIN}" -m "${WHISPER_MODEL}" -f "${tmpWav}" -l en --no-timestamps -t 4`,
      { timeout: 30000, stdio: ["ignore", "pipe", "ignore"] },
    );
    console.log("[warmup] Whisper model loaded.");
  } catch (_) {
    console.warn("[warmup] Whisper warm-up failed (non-critical).");
  } finally {
    try {
      fs.unlinkSync(tmpWav);
    } catch (_) {
      /* ignore */
    }
  }
}

// Kick off warm-up in the background — only if local whisper is available.
if (_hasLocalWhisper) setTimeout(warmUpWhisper, 1000);

// ---------------------------------------------------------------------------
// transcribeAudio — Person 2 (local Whisper STT via whisper.cpp)
// ---------------------------------------------------------------------------

// Converts a recorded audio Blob (or Buffer) to a transcription string.
// Uses whisper.cpp locally if available (free, offline). Falls back to
// OpenAI Whisper API if the local binary isn't compiled (needs OPENAI_API_KEY).
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

  if (_hasLocalWhisper) {
    return _transcribeLocal(buffer);
  } else {
    console.log(
      "[transcribeAudio] Local whisper.cpp not found, using OpenAI API",
    );
    return _transcribeCloud(buffer);
  }
}

// --- Local whisper.cpp transcription ---

async function _transcribeLocal(buffer) {
  const tmpInput = path.join(os.tmpdir(), `whisper-in-${Date.now()}.webm`);
  const tmpWav = path.join(os.tmpdir(), `whisper-${Date.now()}.wav`);

  fs.writeFileSync(tmpInput, buffer);

  try {
    try {
      execSync(
        `ffmpeg -y -i "${tmpInput}" -ar 16000 -ac 1 -c:a pcm_s16le "${tmpWav}"`,
        { timeout: 10000, stdio: ["ignore", "pipe", "ignore"] },
      );
    } catch (convErr) {
      console.warn(
        "[transcribeAudio] ffmpeg conversion failed, trying raw file:",
        convErr.message,
      );
      fs.copyFileSync(tmpInput, tmpWav);
    }

    try {
      const raw = execSync(
        `"${WHISPER_BIN}" -m "${WHISPER_MODEL}" -f "${tmpWav}" -l en --no-timestamps -t 4`,
        { timeout: 30000, stdio: ["ignore", "pipe", "ignore"] },
      ).toString();

      const rawText = raw
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("[BLANK_AUDIO]"))
        .join(" ")
        .trim();

      const text = stripFillers(rawText);

      console.log("[transcribeAudio] Raw:", rawText);
      console.log("[transcribeAudio] Cleaned:", text);
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

// --- Cloud OpenAI Whisper API fallback ---

async function _transcribeCloud(buffer) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error(
      "[transcribeAudio] No local Whisper and no OPENAI_API_KEY — cannot transcribe.",
    );
    return "";
  }

  // Write buffer to a temp file for the multipart upload.
  const tmpFile = path.join(os.tmpdir(), `whisper-cloud-${Date.now()}.webm`);
  fs.writeFileSync(tmpFile, buffer);

  try {
    // Use curl for the multipart form upload — simpler than pulling in a full HTTP library.
    const raw = execSync(
      `curl -s -X POST "https://api.openai.com/v1/audio/transcriptions" ` +
        `-H "Authorization: Bearer ${apiKey}" ` +
        `-F "model=whisper-1" ` +
        `-F "language=en" ` +
        `-F "file=@${tmpFile}"`,
      { timeout: 30000 },
    ).toString();

    const result = JSON.parse(raw);
    const rawText = (result.text || "").trim();
    const text = stripFillers(rawText);

    console.log("[transcribeAudio] Cloud raw:", rawText);
    console.log("[transcribeAudio] Cloud cleaned:", text);
    return text;
  } catch (err) {
    console.error("[transcribeAudio] Cloud Whisper error:", err.message);
    return "";
  } finally {
    try {
      fs.unlinkSync(tmpFile);
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
  let shellBin, shellArg, cleanupCmd;
  if (platform === "darwin") {
    playCmd = `afplay "${tmpMp3}"`;
    shellBin = "sh";
    shellArg = "-c";
    cleanupCmd = `rm -f "${tmpMp3}"`;
  } else if (platform === "win32") {
    // PowerShell can play audio via .NET.
    playCmd = `powershell -NoProfile -Command "(New-Object Media.SoundPlayer '${tmpMp3}').PlaySync()"`;
    shellBin = "cmd";
    shellArg = "/c";
    cleanupCmd = `del /q "${tmpMp3}"`;
  } else {
    playCmd = `aplay "${tmpMp3}" 2>/dev/null || mpv --no-video "${tmpMp3}" 2>/dev/null`;
    shellBin = "sh";
    shellArg = "-c";
    cleanupCmd = `rm -f "${tmpMp3}"`;
  }

  // Spawn a shell that generates then plays the audio.
  const separator = platform === "win32" ? "&" : "&&";
  const terminator = platform === "win32" ? "&" : ";";
  const devnull = platform === "win32" ? "NUL" : "/dev/null";
  const shellCmd = `"${_edgeTtsCmd}" --text "${text.replace(/"/g, '\\"')}" --voice ${EDGE_TTS_VOICE} --write-media "${tmpMp3}" 2>${devnull} ${separator} ${playCmd}${terminator} ${cleanupCmd}`;

  _ttsProcess = spawn(shellBin, [shellArg, shellCmd], { stdio: "ignore" });

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
    _ttsProcess = spawn("say", ["-r", "175", text], { stdio: "ignore" });
  } else if (platform === "win32") {
    const psScript = `
      Add-Type -AssemblyName System.Speech;
      $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;
      $synth.Rate = -2;
      $synth.Speak('${text.replace(/'/g, "''")}');
    `;
    _ttsProcess = spawn("powershell", ["-NoProfile", "-Command", psScript], { stdio: "ignore" });
  } else {
    _ttsProcess = spawn("espeak", ["-s", "140", text], { stdio: "ignore" });
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
}

// Executes a system action from the 8-action catalog using NirCmd for Windows automation.
const NIRCMD = path.join(__dirname, "nircmd.exe");

// ---------------------------------------------------------------------------
// findInstalledApp — searches Windows Start Menu for a fuzzy match
// ---------------------------------------------------------------------------

function findInstalledApp(query) {
  const searchDirs = [
    path.join(
      os.homedir(),
      "AppData",
      "Roaming",
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
    ),
    "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs",
  ];

  const shortcuts = [];

  // Recursively collect all .lnk files from Start Menu
  function walk(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".lnk")) {
          shortcuts.push({ name: entry.name.replace(".lnk", ""), path: full });
        }
      }
    } catch (_) {
      /* skip inaccessible dirs */
    }
  }

  for (const dir of searchDirs) walk(dir);

  // Also search for Microsoft Store / UWP apps via PowerShell
  try {
    const psCmd = `powershell -NoProfile -Command "Get-StartApps | Where-Object { $_.Name -like '*${query.replace(/'/g, "''")}*' } | Select-Object -First 1 -ExpandProperty AppID"`;
    const appId = execSync(psCmd, { encoding: "utf8", timeout: 5000 }).trim();
    if (appId) {
      console.log(`[ACTION] Found UWP app: "${appId}" for query "${query}"`);
      return `shell:AppsFolder\\${appId}`;
    }
  } catch (_) {
    /* Get-StartApps not available or no match */
  }

  if (shortcuts.length === 0) return null;

  const q = query.toLowerCase();

  // Exact match first
  const exact = shortcuts.find((s) => s.name.toLowerCase() === q);
  if (exact) return exact.path;

  // Contains match
  const contains = shortcuts.find((s) => s.name.toLowerCase().includes(q));
  if (contains) return contains.path;

  // Fuzzy: query chars appear in order in the shortcut name
  const fuzzy = shortcuts.find((s) => {
    const sLower = s.name.toLowerCase();
    let qi = 0;
    for (let si = 0; si < sLower.length && qi < q.length; si++) {
      if (sLower[si] === q[qi]) qi++;
    }
    return qi === q.length;
  });
  if (fuzzy) return fuzzy.path;

  return null;
}

async function executeAction(action) {
  if (!action || !action.name) return { success: false };

  console.log("[ACTION]", action);
  const platform = process.platform;

  try {
    switch (action.name) {
      case "setVolume": {
        const rawLevel =
          typeof action.params === "number"
            ? action.params
            : (action.params?.level ?? 0);

        if (platform === "darwin") {
          const vol = Math.max(0, Math.min(100, Math.round(rawLevel)));
          execSync(`osascript -e "set volume output volume ${vol}"`, {
            stdio: "ignore",
          });
        } else {
          const level = Math.round((rawLevel / 100) * 65535);
          const cmd = `"${NIRCMD}" setvolume 0 ${level} ${level}`;
          console.log("[ACTION] running:", cmd);
          const output = execSync(cmd, { encoding: "utf8", stdio: "pipe" });
          console.log(
            "[ACTION] nircmd output:",
            output || "(no output — success)",
          );
        }
        break;
      }
      case "setBrightness": {
        const rawBrightness =
          typeof action.params === "number"
            ? action.params
            : (action.params?.level ?? 50);

        if (platform === "darwin") {
          console.log(
            `[ACTION] setBrightness(${rawBrightness}) — not supported on macOS (demo is Windows)`,
          );
        } else {
          execSync(`"${NIRCMD}" setbrightness ${rawBrightness}`, {
            stdio: "ignore",
          });
        }
        break;
      }
      case "setTextSize": {
        const scale = action.params?.scale ?? 150;

        if (platform === "darwin") {
          // macOS: can't set display scaling programmatically. Open the settings pane.
          try {
            execSync(
              `osascript -e 'tell application "System Settings" to activate'`,
              { stdio: "ignore", timeout: 3000 },
            );
          } catch (_) {
            /* ignore */
          }
          console.log(
            `[ACTION] setTextSize(${scale}) — opened System Settings (macOS can't set scale directly)`,
          );
        } else {
          const dpiMap = { 100: 96, 125: 120, 150: 144, 175: 168, 200: 192 };
          const dpi = dpiMap[scale] ?? 144;
          execSync(
            `reg add "HKCU\\Control Panel\\Desktop" /v LogPixels /t REG_DWORD /d ${dpi} /f && ` +
              `rundll32.exe user32.dll,UpdatePerUserSystemParameters`,
          );
        }
        break;
      }
      case "openApp": {
        const rawName =
          typeof action.params === "string"
            ? action.params
            : (action.params?.name ?? "");
        const name = rawName.toLowerCase().trim();

        if (!name) {
          return { success: false, error: "No app name provided" };
        }

        if (platform === "darwin") {
          // macOS app name map — friendly names to actual .app names
          const macAppMap = {
            chrome: "Google Chrome",
            "google chrome": "Google Chrome",
            firefox: "Firefox",
            safari: "Safari",
            calculator: "Calculator",
            calc: "Calculator",
            notes: "Notes",
            notepad: "Notes",
            "text edit": "TextEdit",
            textedit: "TextEdit",
            terminal: "Terminal",
            settings: "System Settings",
            "system settings": "System Settings",
            mail: "Mail",
            email: "Mail",
            outlook: "Microsoft Outlook",
            word: "Microsoft Word",
            excel: "Microsoft Excel",
            powerpoint: "Microsoft PowerPoint",
            spotify: "Spotify",
            finder: "Finder",
            "file explorer": "Finder",
            explorer: "Finder",
            messages: "Messages",
            photos: "Photos",
            music: "Music",
          };

          const appName = macAppMap[name] || rawName;
          console.log(`[ACTION] openApp: "${name}" -> "${appName}" (macOS)`);
          execSync(`open -a "${appName}"`, { stdio: "ignore", timeout: 5000 });
        } else {
          // Windows app map
          const appMap = {
            chrome: "chrome",
            "google chrome": "chrome",
            firefox: "firefox",
            edge: "msedge",
            "microsoft edge": "msedge",
            notepad: "notepad",
            calculator: "calc",
            calc: "calc",
            paint: "mspaint",
            word: "winword",
            excel: "excel",
            powerpoint: "powerpnt",
            outlook: "outlook",
            "file explorer": "explorer",
            explorer: "explorer",
            settings: "ms-settings:",
            "task manager": "taskmgr",
            cmd: "cmd",
            terminal: "wt",
            spotify: "spotify:",
            netflix: "netflix:",
          };

          if (appMap[name]) {
            try {
              console.log(
                `[ACTION] openApp: "${name}" -> "${appMap[name]}" (known app)`,
              );
              execSync(`start "" "${appMap[name]}"`, {
                shell: true,
                timeout: 5000,
              });
              break;
            } catch (_) {
              console.log(
                `[ACTION] known app "${appMap[name]}" failed, trying Start Menu search...`,
              );
            }
          }

          const match = findInstalledApp(name);
          if (match) {
            console.log(
              `[ACTION] openApp: "${name}" -> "${match}" (Start Menu)`,
            );
            execSync(`start "" "${match}"`, { shell: true, timeout: 5000 });
          } else {
            console.log(`[ACTION] openApp: "${name}" -> trying raw name`);
            execSync(`start "" "${name}"`, { shell: true, timeout: 5000 });
          }
        }
        break;
      }
      case "openWebsite": {
        const url = action.params?.url || "";
        if (!url) return { success: false, error: "No URL provided" };
        console.log(`[ACTION] openWebsite: "${url}"`);
        if (platform === "darwin") {
          execSync(`open "${url}"`, { stdio: "ignore", timeout: 5000 });
        } else {
          execSync(`start "" "${url}"`, { shell: true, timeout: 5000 });
        }
        break;
      }
      case "closeActiveWindow": {
        if (platform === "darwin") {
          // Close the frontmost window of the active app (no accessibility permission needed).
          execSync(
            `osascript -e 'tell application (path to frontmost application as text) to close the front window'`,
            { stdio: "ignore", timeout: 10000 },
          );
        } else {
          execSync(`"${NIRCMD}" win hide title "senior-assistant""`);
          await new Promise((r) => setTimeout(r, 500));
          execSync(`"${NIRCMD}" sendkeypress 0x73+alt`);
          await new Promise((r) => setTimeout(r, 300));
          execSync(`"${NIRCMD}" win show title "senior-assistant""`);
        }
        break;
      }
      case "closeScamPopup": {
        if (platform === "darwin") {
          execSync(
            `osascript -e 'tell application (path to frontmost application as text) to close the front window'`,
            { stdio: "ignore", timeout: 10000 },
          );
        } else {
          execSync(`"${NIRCMD}" win hide title "senior-assistant""`);
          await new Promise((r) => setTimeout(r, 500));
          execSync(`"${NIRCMD}" sendkeypress 0x73+alt`);
          await new Promise((r) => setTimeout(r, 300));
          execSync(`"${NIRCMD}" win show title "senior-assistant""`);
        }
        break;
      }
      case "readScreenAloud":
      case "sendHelpToFamily":
      case null:
      default:
        // No system action needed or not yet implemented
        break;
    }
    return { success: true };
  } catch (err) {
    console.error("[ACTION] executeAction failed:", err.message);
    return { success: false, error: err.message };
  }
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
