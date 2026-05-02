#!/usr/bin/env node
// postinstall.js — Runs automatically after `npm install`.
// Downloads the Whisper base model if it's not already present.

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const MODEL_DIR = path.join(
  __dirname,
  "..",
  "node_modules",
  "whisper-node",
  "lib",
  "whisper.cpp",
  "models",
);
const MODEL_PATH = path.join(MODEL_DIR, "ggml-base.bin");
const MODEL_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";

if (fs.existsSync(MODEL_PATH)) {
  console.log(
    "[postinstall] Whisper base model already exists, skipping download.",
  );
  process.exit(0);
}

// whisper-node might not be installed yet on first run
if (!fs.existsSync(MODEL_DIR)) {
  console.log(
    "[postinstall] whisper-node not yet installed, model will be downloaded on next npm install.",
  );
  process.exit(0);
}

console.log("[postinstall] Downloading Whisper base model (~140MB)...");

try {
  execSync(`curl -L -o "${MODEL_PATH}" "${MODEL_URL}"`, {
    stdio: "inherit",
    timeout: 300000, // 5 min timeout
  });
  console.log("[postinstall] Whisper model downloaded successfully.");
} catch (err) {
  console.error("[postinstall] Failed to download Whisper model:", err.message);
  console.error("[postinstall] You can download it manually:");
  console.error(`  curl -L -o "${MODEL_PATH}" "${MODEL_URL}"`);
  // Don't fail the install — the app will still work without STT
  process.exit(0);
}
