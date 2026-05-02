// stubs.js — Integration boundary for teammates building voice, AI brain, and system actions.
//
// CONTRACT: These five function signatures are frozen. Each teammate replaces the BODY of their
// function(s) without changing the name, parameters, or return shape. The shell depends on these
// shapes throughout — mismatched return values will break the UI, not just the stub.
//
// Owner map:
//   transcribeAudio     → Person 2 (Whisper + TTS)
//   getAssistantResponse → Person 3 (Anthropic vision + function-calling)
//   executeAction       → Person 4 (Windows automation)
//   speak               → Person 2 (TTS)
//   captureScreenshot   → Person 3 (screenshot capture)

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Converts a recorded audio Blob to a transcription string.
// Replace body with Whisper API call; keep the (blob) signature.
async function transcribeAudio(blob) {
  await delay(500);
  return 'my text is too small';
}

// Sends user text + optional screenshot to the AI and returns a structured action decision.
// Return shape is the contract: { speak, action, requiresConfirmation }.
// action is either null (no system change needed) or { name, params } from the locked 8-action catalog.
async function getAssistantResponse(text, screenshot) {
  await delay(800);
  return {
    speak: "I can make your text bigger. Should I do that?",
    action: { name: 'setTextSize', params: { scale: 150 } },
    requiresConfirmation: true,
  };
}

// Executes a system action from the 8-action catalog.
// Replace body with real Windows automation; { name, params } shape must stay identical.
async function executeAction(action) {
  await delay(600);
  console.log('[ACTION]', action);
  return { success: true };
}

// Speaks text aloud via TTS. Replace body with real speech synthesis.
async function speak(text) {
  console.log('[SPEAK]:', text);
}

// Captures a screenshot of the current screen for AI vision context.
// Returns null until Person 3 wires it up — callers must handle null gracefully.
async function captureScreenshot() {
  return null;
}

module.exports = { transcribeAudio, getAssistantResponse, executeAction, speak, captureScreenshot };
