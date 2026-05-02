#!/usr/bin/env node
// postinstall.js — Runs automatically after `npm install`.
// Downloads the Whisper base model if it's not already present.
// Checks multiple locations so it works with both whisper-node and pre-built binaries.

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const MODEL_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";

// All possible model locations — download to the first directory that exists.
const MODEL_DIRS = [
  path.join(
    __dirname,
    "..",
    "node_modules",
    "whisper-node",
    "lib",
    "whisper.cpp",
    "models",
  ),
  path.join(__dirname, "..", "whisper-bin-win", "models"),
];

// Check if model already exists in any location.
for (const dir of MODEL_DIRS) {
  const modelPath = path.join(dir, "ggml-base.bin");
  if (fs.existsSync(modelPath)) {
    console.log(
      "[postinstall] Whisper base model already exists at",
      modelPath,
    );
    process.exit(0);
  }
}

// Find the first directory that exists (or can be created).
let targetDir = MODEL_DIRS.find((d) => fs.existsSync(d));

if (!targetDir) {
  // If whisper-node isn't installed, try creating the whisper-bin-win/models dir
  // (for Windows users with pre-built binaries).
  const winModelsDir = MODEL_DIRS[1];
  const winBinDir = path.dirname(winModelsDir);
  if (fs.existsSync(winBinDir)) {
    fs.mkdirSync(winModelsDir, { recursive: true });
    targetDir = winModelsDir;
  } else {
    console.log(
      "[postinstall] No whisper directory found, skipping model download.",
    );
    console.log(
      "[postinstall] Run npm install again after dependencies are set up.",
    );
    process.exit(0);
  }
}

const targetPath = path.join(targetDir, "ggml-base.bin");
console.log(
  "[postinstall] Downloading Whisper base model (~140MB) to",
  targetPath,
);

try {
  execSync(`curl -L -o "${targetPath}" "${MODEL_URL}"`, {
    stdio: "inherit",
    timeout: 300000, // 5 min timeout
  });
  console.log("[postinstall] Whisper model downloaded successfully.");
} catch (err) {
  console.error("[postinstall] Failed to download Whisper model:", err.message);
  console.error("[postinstall] You can download it manually:");
  console.error(`  curl -L -o "${targetPath}" "${MODEL_URL}"`);
  process.exit(0);
}
