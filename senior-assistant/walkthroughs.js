// walkthroughs.js — Walkthrough sequences for the senior accessibility assistant.
// The LLM decides which walkthrough to start; this file decides what happens inside it.

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function estimateSpeechMs(text) {
  const words = text.split(/\s+/).length;
  return Math.max(2000, (words / 120) * 60000 + 800);
}

let _activeRun = null;

function resolveInput(text) {
  if (_activeRun && _activeRun.inputResolver) {
    _activeRun.inputResolver(text);
    _activeRun.inputResolver = null;
  }
}

function cancelActiveWalkthrough() {
  if (!_activeRun) return;
  _activeRun.cancelled = true;
  if (_activeRun.inputResolver) {
    _activeRun.inputResolver(null);
    _activeRun.inputResolver = null;
  }
}

function waitForInput(run) {
  return new Promise((resolve) => { run.inputResolver = resolve; });
}

const ZOOM_JOIN = [
  {
    type: "speak",
    text: "Okay, I'll help you join your Zoom meeting. First I'll open Zoom for you.",
  },
  {
    type: "launch_app",
    app: "zoom",
  },
  {
    type: "wait",
    durationMs: 3000,
  },
  {
    type: "speak",
    text: "Zoom is open now. Look for the Join a Meeting button near the center of the window and click it.",
  },
  {
    type: "wait_for_input",
    text: "Say 'done' or tap Send when you've clicked Join.",
  },
  {
    type: "speak",
    text: "Now type your meeting ID into the text field, then click the Join button.",
  },
  {
    type: "wait_for_input",
    text: "Say 'done' or tap Send once you've clicked Join.",
  },
  {
    type: "speak",
    text: "There you go — you're joining the meeting now. If anything looks confusing, tap the Help button and I'll be right here.",
  },
  {
    type: "done",
  },
];

const WALKTHROUGHS = {
  "zoom-join": ZOOM_JOIN,
};

async function handleStep(step, ctx) {
  switch (step.type) {
    case "speak":
      await ctx.speak(step.text);
      await delay(estimateSpeechMs(step.text));
      break;
    case "launch_app":
      await ctx.executeAction({ name: "openApp", params: { name: step.app } });
      break;
    case "wait":
      await delay(step.durationMs);
      break;
    case "wait_for_input":
      ctx.showChat();
      ctx.emit({ type: "wait-for-input", text: step.text });
      break;
    case "done":
      break;
  }
}

async function runWalkthrough(name, ctx) {
  const steps = WALKTHROUGHS[name];
  if (!steps) {
    console.error(`[walkthrough] Unknown walkthrough: ${name}`);
    ctx.emit({ type: "walkthrough-cancelled" });
    return;
  }

  if (_activeRun) cancelActiveWalkthrough();
  const run = { cancelled: false, inputResolver: null };
  _activeRun = run;

  for (let i = 0; i < steps.length; i++) {
    if (run.cancelled) break;
    const step = steps[i];
    ctx.emit({ type: "step-started", index: i, step: step.type, total: steps.length });

    if (step.type === "wait_for_input") {
      await handleStep(step, ctx);
      const raw = await waitForInput(run);
      if (run.cancelled) break;
      ctx.hideChat();
      ctx.emit({ type: "step-completed", index: i });
      continue;
    }

    await handleStep(step, ctx);
    if (run.cancelled) break;
    ctx.emit({ type: "step-completed", index: i });
  }

  if (_activeRun === run) _activeRun = null;

  if (!run.cancelled) {
    ctx.emit({ type: "walkthrough-finished" });
    ctx.destroyOverlay();
    ctx.showChat();
  }
}

module.exports = { runWalkthrough, cancelActiveWalkthrough, resolveInput };
