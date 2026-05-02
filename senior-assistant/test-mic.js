// test-mic.js — Records 5 seconds from your mic, then transcribes with your transcribeAudio function.
// Run: node test-mic.js

const { execSync } = require("child_process");
const fs = require("fs");
const stubs = require("./stubs");

const DURATION = 5; // seconds
const TMP_RAW = "/tmp/test-mic-raw.wav";
const TMP_WAV = "/tmp/test-mic-16k.wav";

async function main() {
  console.log(`\n🎤 Recording for ${DURATION} seconds... SPEAK NOW!\n`);

  // Record with sox (any sample rate is fine — we convert after)
  try {
    execSync(`rec -q "${TMP_RAW}" trim 0 ${DURATION}`, {
      stdio: "inherit",
      timeout: (DURATION + 3) * 1000,
    });
  } catch (_) {
    // Fall back to ffmpeg
    try {
      execSync(
        `ffmpeg -y -f avfoundation -i ":default" -t ${DURATION} "${TMP_RAW}" 2>/dev/null`,
        { stdio: "inherit", timeout: (DURATION + 3) * 1000 },
      );
    } catch (__) {
      console.error(
        "❌ Could not record. Install sox (brew install sox) or use ffmpeg.",
      );
      process.exit(1);
    }
  }

  // Convert to 16kHz mono WAV — whisper.cpp requires this exact format
  console.log("\n🔄 Converting to 16kHz mono WAV...");
  try {
    execSync(
      `ffmpeg -y -i "${TMP_RAW}" -ar 16000 -ac 1 -c:a pcm_s16le "${TMP_WAV}" 2>/dev/null`,
    );
  } catch (e) {
    console.error("❌ ffmpeg conversion failed:", e.message);
    process.exit(1);
  }

  const stat = fs.statSync(TMP_WAV);
  console.log(`📁 WAV file: ${(stat.size / 1024).toFixed(1)} KB\n`);
  console.log("⏳ Transcribing...\n");

  // Pass the properly formatted WAV directly to transcribeAudio
  const audioBuffer = fs.readFileSync(TMP_WAV);
  const start = Date.now();
  const text = await stubs.transcribeAudio(audioBuffer);
  const elapsed = Date.now() - start;

  console.log(`\n✅ Transcription (${elapsed}ms): "${text}"\n`);

  if (text) {
    stubs.speak("You said: " + text);
  } else {
    stubs.speak("I did not hear anything. Try again.");
  }

  // Wait for speech to finish before exiting
  setTimeout(() => {
    try {
      fs.unlinkSync(TMP_RAW);
    } catch (_) {}
    try {
      fs.unlinkSync(TMP_WAV);
    } catch (_) {}
    process.exit(0);
  }, 8000);
}

main();
