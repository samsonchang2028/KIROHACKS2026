// renderer.js — Chat UI logic: renders transcript, drives mic state machine, calls window.api.

// Five valid states — the only values currentState may hold.
const IDLE = "idle";
const LISTENING = "listening";
const THINKING = "thinking";
const CONFIRMING = "confirming";
const DOING = "doing";
const VALID_STATES = [IDLE, LISTENING, THINKING, CONFIRMING, DOING];

// Status text shown only during active states — idle shows nothing (input row is enough).
const STATUS_TEXT = {
  [IDLE]: "",
  [LISTENING]: "Tap when you're done",
  [THINKING]: "",
  [CONFIRMING]: "",
  [DOING]: "Doing it now...",
};

let currentState = IDLE;

// --- Card kind tokens ---
const CARD_TOKENS = {
  default: { iconFg: '#2A6FBF', eyebrow: 'Done', cls: 'card-default', iconSvg: '<svg width="28" height="28" viewBox="0 0 24 24" fill="#2A6FBF" aria-hidden="true"><path d="M12 2l1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6z" opacity="0.9"/><circle cx="19" cy="5" r="1.2"/><circle cx="5" cy="19" r="1.2"/></svg>' },
  warn:    { iconFg: '#A86808', eyebrow: 'Heads up', cls: 'card-warn', iconSvg: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#A86808" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l9 16H3z"/><path d="M12 10v5M12 18.2v.1"/></svg>' },
  success: { iconFg: '#1E7E47', eyebrow: 'All set', cls: 'card-success', iconSvg: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1E7E47" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>' },
  ask:     { iconFg: '#5B41A8', eyebrow: 'Quick check', cls: 'card-ask', iconSvg: '<svg width="28" height="28" viewBox="0 0 24 24" fill="#5B41A8" aria-hidden="true"><path d="M12 2l1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6z" opacity="0.9"/><circle cx="19" cy="5" r="1.2"/><circle cx="5" cy="19" r="1.2"/></svg>' },
};

// --- Mic recording (teammate's implementation — do not modify signatures) ---
let mediaRecorder = null;
let audioChunks = [];
let micStream = null;

// --- Silence detection (auto-stop) ---
let audioContext = null;
let analyser = null;
let silenceTimer = null;
const SILENCE_THRESHOLD = 35;
const SILENCE_DURATION = 2000;
const MIN_RECORD_TIME = 1500;
let recordingStartTime = 0;
let silenceDetectionActive = false;

function startSilenceDetection() {
  if (!micStream) return;
  silenceDetectionActive = true;
  audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(micStream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.3;
  source.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);
  let silenceStart = null;

  function check() {
    if (!silenceDetectionActive) return;
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    const avg = sum / data.length;

    if (avg < SILENCE_THRESHOLD) {
      if (!silenceStart) silenceStart = Date.now();
      else if (Date.now() - silenceStart > SILENCE_DURATION && Date.now() - recordingStartTime > MIN_RECORD_TIME) {
        console.log("[VAD] Silence detected, auto-stopping");
        silenceDetectionActive = false;
        stopListening();
        return;
      }
    } else {
      silenceStart = null;
    }
    silenceTimer = requestAnimationFrame(check);
  }
  check();
}

function stopSilenceDetection() {
  silenceDetectionActive = false;
  if (silenceTimer) { cancelAnimationFrame(silenceTimer); silenceTimer = null; }
  if (audioContext) { audioContext.close().catch(() => { }); audioContext = null; }
}

async function initMic() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
  } catch (err) {
    console.error("[mic] Could not access microphone:", err.message);
    micStream = null;
  }
}

function startRecording() {
  if (!micStream) return;
  audioChunks = [];
  mediaRecorder = new MediaRecorder(micStream, {
    mimeType: "audio/webm;codecs=opus",
  });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) audioChunks.push(e.data);
  };
  mediaRecorder.start();
}

function stopRecording() {
  return new Promise((resolve) => {
    if (!mediaRecorder || mediaRecorder.state !== "recording") {
      resolve(null);
      return;
    }
    mediaRecorder.onstop = async () => {
      if (audioChunks.length === 0) {
        resolve(null);
        return;
      }
      const blob = new Blob(audioChunks, { type: "audio/webm" });
      resolve(await blob.arrayBuffer());
    };
    mediaRecorder.stop();
  });
}

// --- DOM refs ---
const statusEl = document.getElementById("status-text");
const micArea = document.getElementById("mic-area");
const messagesEl = document.getElementById("messages");
const hintEl = document.getElementById("hint");
const textInput = document.getElementById("text-input");
const sendBtn = document.getElementById("send-btn");
const voiceBtn = document.getElementById("voice-btn");
const voiceIcon = document.getElementById("voice-icon");
const voiceLabel = document.getElementById("voice-label");
const idleHero = document.getElementById("idle-hero");

// SVG icon strings
const SVG_MIC_BLUE = '<svg width="53" height="53" viewBox="0 0 24 24" fill="none" stroke="#2A6FBF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>';
const SVG_MIC_COMPACT = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2A6FBF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>';

// --- Detect card kind from text ---
function detectCardKind(text) {
  const t = text.toLowerCase();
  if (t.includes('warning') || t.includes('⚠') || t.includes('memory') || t.includes('slowing') || t.includes('running low') || t.includes('heavy load'))
    return 'warn';
  if (t.includes('done') || t.includes('closed') || t.includes('success') || t.includes('started') || t.includes('all set') || t.includes('starting'))
    return 'success';
  if (t.includes('confirm') || t.includes('would you like') || t.includes('do you want') || t.includes('shall i') || t.includes('close the'))
    return 'ask';
  return 'default';
}

// --- Extract a short title from text ---
function extractTitle(text) {
  // Use first sentence or first 60 chars
  const firstSentence = text.split(/[.!?\n]/)[0].trim();
  return firstSentence.length > 60 ? firstSentence.substring(0, 57) + '…' : firstSentence;
}

// --- Build a BigResultCard DOM element ---
function buildCard(kind, title, body, opts = {}) {
  const t = CARD_TOKENS[kind];
  const card = document.createElement('div');
  card.className = `big-result-card ${t.cls} msg-animate`;

  let actionsHtml = '';
  if (opts.primaryLabel || opts.secondaryLabel) {
    actionsHtml = '<div class="card-actions">';
    if (opts.primaryLabel) actionsHtml += `<button class="card-btn-primary" data-action="primary">${opts.primaryLabel}</button>`;
    if (opts.secondaryLabel) actionsHtml += `<button class="card-btn-secondary" data-action="secondary">${opts.secondaryLabel}</button>`;
    actionsHtml += '</div>';
  }

  card.innerHTML = `<div class="big-result-card-inner">
    <div class="card-header">
      <div class="card-icon-tile">${t.iconSvg}</div>
      <div>
        <div class="card-eyebrow">${opts.eyebrow || t.eyebrow}</div>
        <div class="card-title">${title}</div>
      </div>
    </div>
    <div class="card-body">${body}</div>
    ${opts.extraHtml || ''}
    ${actionsHtml}
  </div>`;

  return card;
}

// --- Switch to result view (hide idle hero, show scrollable cards) ---
function ensureResultView() {
  if (idleHero) idleHero.classList.add('hidden');
  messagesEl.classList.add('result-scroll-mode');
  const compactRow = document.getElementById('compact-mic-row');
  if (compactRow) compactRow.classList.remove('hidden');
}

// --- Message rendering ---
function renderMessage(role, text) {
  ensureResultView();
  hintEl.classList.add("hidden");
  const chipsEl = document.getElementById("chips");
  if (chipsEl) chipsEl.classList.add("hidden");

  if (role === "assistant") {
    const kind = detectCardKind(text);
    const t = CARD_TOKENS[kind];
    // Short messages: use text as title, no body. Long messages: extract title, rest is body.
    const sentences = text.split(/(?<=[.!?])\s+/);
    const title = sentences[0] || text;
    const body = sentences.length > 1 ? sentences.slice(1).join(' ') : '';
    const card = buildCard(kind, title, body);
    messagesEl.appendChild(card);
  } else {
    // User transcript label
    const label = document.createElement("div");
    label.className = "transcript-label msg-animate";
    label.innerHTML = `<span class="transcript-label-prefix">You said</span><span class="transcript-label-text">"${text}"</span>`;
    messagesEl.appendChild(label);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// --- Confirmation buttons (injected into mic-area during confirming state) ---
function renderConfirmButtons(question, action) {
  // In result view, put confirm buttons inside the last card if possible
  micArea.replaceChildren();
  const yes = document.createElement("button");
  yes.className = "confirm-btn confirm-yes";
  yes.textContent = "Yes";
  yes.addEventListener("click", () => handleConfirm(true, action));

  const no = document.createElement("button");
  no.className = "confirm-btn confirm-no";
  no.textContent = "No";
  no.addEventListener("click", () => handleConfirm(false, action));

  micArea.style.flexDirection = 'row';
  micArea.style.justifyContent = 'center';
  micArea.style.gap = '12px';
  micArea.style.padding = '12px 18px';
  micArea.appendChild(yes);
  micArea.appendChild(no);
}

function clearConfirmButtons() {
  // Only clear the mic-area if it's being used for confirm buttons
  // Don't touch the voice button — it lives in idle-hero or compact-mic-row
}

// --- Voice button visual state ---
function setVoiceButtonState(state) {
  // Reset classes
  voiceBtn.className = '';
  const cBtn = document.getElementById('compact-mic-btn');
  const cLabel = document.getElementById('compact-mic-label');

  if (state === LISTENING) {
    voiceBtn.classList.add('mic-listening');
    voiceIcon.innerHTML = '<div class="wave-bars"><div class="wave-bar"></div><div class="wave-bar"></div><div class="wave-bar"></div><div class="wave-bar"></div><div class="wave-bar"></div></div>';
    voiceLabel.textContent = '';
    voiceBtn.setAttribute('aria-label', 'Listening…');
    if (cBtn) { cBtn.className = 'compact-mic-listening'; }
    if (cLabel) { cLabel.textContent = 'Listening… tap when done'; cLabel.style.color = '#D63B28'; }

    if (idleHero && !idleHero.classList.contains('hidden')) {
      idleHero.className = 'listening-bg';
      idleHero.id = 'idle-hero';
      hintEl.className = 'listening-label';
      hintEl.innerHTML = '<span class="rec-dot"></span> Listening';
      statusEl.textContent = STATUS_TEXT[LISTENING];
    }
  } else if (state === THINKING) {
    voiceBtn.classList.add('mic-thinking');
    voiceIcon.innerHTML = '<div class="think-dots"><div class="think-dot"></div><div class="think-dot"></div><div class="think-dot"></div></div>';
    voiceLabel.textContent = '';
    voiceBtn.setAttribute('aria-label', 'Thinking…');
    if (cBtn) { cBtn.className = 'compact-mic-thinking'; }
    if (cLabel) { cLabel.textContent = 'Thinking…'; cLabel.style.color = '#D88B0E'; }

    if (idleHero && !idleHero.classList.contains('hidden')) {
      idleHero.className = 'thinking-bg';
      idleHero.id = 'idle-hero';
      hintEl.className = 'thinking-label';
      hintEl.innerHTML = '<span class="rec-dot" style="background:var(--amber-deep)"></span> Thinking';
      statusEl.textContent = '';
    }
  } else if (state === DOING) {
    voiceBtn.classList.add('mic-doing');
    voiceIcon.innerHTML = '<div class="think-dots"><div class="think-dot" style="background:var(--green-deep)"></div><div class="think-dot" style="background:var(--green-deep)"></div><div class="think-dot" style="background:var(--green-deep)"></div></div>';
    voiceLabel.textContent = '';
    voiceBtn.setAttribute('aria-label', 'Working…');
    if (cBtn) { cBtn.className = 'compact-mic-doing'; }
    if (cLabel) { cLabel.textContent = 'Working…'; cLabel.style.color = '#1E7E47'; }
  } else {
    voiceIcon.innerHTML = SVG_MIC_BLUE;
    voiceLabel.textContent = 'Tap to talk';
    voiceBtn.setAttribute('aria-label', 'Tap to talk');
    if (cBtn) { cBtn.className = ''; cBtn.id = 'compact-mic-btn'; }
    if (cLabel) { cLabel.textContent = 'Tap to ask another question'; cLabel.style.color = ''; }

    if (idleHero && !idleHero.classList.contains('hidden')) {
      idleHero.className = '';
      idleHero.id = 'idle-hero';
      hintEl.className = '';
      hintEl.innerHTML = "Hi there.<br/>I'm here when you need me.";
      statusEl.textContent = '';
    }
  }
}

// --- Core state function — the only place state ever changes ---
function setMicState(state, context) {
  if (!VALID_STATES.includes(state))
    throw new Error(`Invalid mic state: ${state}`);

  currentState = state;
  statusEl.textContent = STATUS_TEXT[state];

  if (state === CONFIRMING) {
    renderConfirmButtons(context.question, context.action);
  } else {
    clearConfirmButtons();
  }

  setVoiceButtonState(state);

  const busy = state !== IDLE && state !== CONFIRMING;
  textInput.disabled = busy;
  sendBtn.disabled = busy;
  voiceBtn.disabled = state === THINKING || state === DOING;
  const cBtn = document.getElementById('compact-mic-btn');
  if (cBtn) cBtn.disabled = state === THINKING || state === DOING;

  if (state === LISTENING) window.api.speak("Listening");
  else if (state === THINKING) window.api.speak("Thinking");
  else if (state === DOING) window.api.speak("Doing it now");
  else if (state === CONFIRMING && context?.question)
    window.api.speak(context.question);
  else if (state === IDLE && context === "completed") window.api.speak("Done");
}

// --- Shared response handler (text and voice both funnel here) ---
async function handleUserInput(userText) {
  if (!userText || !userText.trim()) return;

  console.log('[pipeline] handleUserInput:', userText);
  renderMessage("user", userText);
  setMicState(THINKING);

  try {
    console.log('[pipeline] calling getResponse...');
    const response = await window.api.getResponse(userText);
    console.log('[pipeline] agent response:', JSON.stringify(response));

    if (response.requiresConfirmation && response.walkthrough) {
      renderInlineConfirm(
        response.speak,
        "Yes",
        "No",
        async () => {
          setMicState(IDLE);
          window.api.startWalkthrough(response.walkthrough);
        },
        response.speak
      );
    } else if (response.requiresConfirmation && response.action) {
      renderInlineConfirm(
        response.speak,
        "Yes, go ahead",
        "No, cancel",
        async () => {
          await executeAndFinish(response.action);
        },
        response.speak
      );
    } else if (response.action) {
      renderMessage("assistant", response.speak);
      window.api.speak(response.speak);
      setMicState(DOING);
      await executeAndFinish(response.action);
    } else {
      renderMessage("assistant", response.speak);
      window.api.speak(response.speak);
      if (response.suggestions && response.suggestions.length > 0) {
        await showSuggestions(response.suggestions);
      } else {
        setMicState(IDLE);
      }
    }
  } catch (err) {
    renderMessage(
      "assistant",
      "Sorry, something went wrong. Want me to try again?",
    );
    window.api.speak("Sorry, something went wrong.");
    setMicState(IDLE);
  }
}

// --- Suggestions + heavy process flow ---
async function showSuggestions(suggestions) {
  const memSuggestion = suggestions.find(s => s.includes("memory"));
  const cpuSuggestion = suggestions.find(s => s.includes("processor") || s.includes("busy"));
  const rebootSuggestion = suggestions.find(s => s.includes("been on for"));

  if (memSuggestion) {
    try {
      const procs = await window.api.getHeavyProcesses();
      if (procs.length > 0) {
        const allPids = procs.flatMap(p => p.pids || [p.pid]);
        const lines = memSuggestion
          + "\n\nThese apps are using the most memory:\n"
          + procs.map(p => `• ${p.friendlyName}: ${p.memPct}% memory`).join("\n")
          + "\n\nWould you like me to close them?";

        renderInlineConfirm(lines, "Yes, close them", "No, leave them",
          () => executeAndFinish({ name: "_killProcesses", params: { pids: allPids } }),
          `I found ${procs.length} apps using a lot of memory. Want me to close them?`
        );
        return;
      }
    } catch (err) {
      console.error("[suggestions] getHeavyProcesses failed:", err.message);
    }
    offerRestart(memSuggestion);
    return;
  }

  if (cpuSuggestion) {
    offerRestart(cpuSuggestion);
    return;
  }

  if (rebootSuggestion) {
    offerRestart(rebootSuggestion);
    return;
  }

  if (!memSuggestion && !cpuSuggestion) {
    for (const s of suggestions) {
      renderMessage("assistant", s);
    }
    setMicState(IDLE);
  }
}

function offerRestart(contextMessage) {
  const fullMessage = contextMessage
    + "\n\nIf things are still slow, I can restart your computer for you. It only takes a minute and usually helps a lot.\n\nDo you want me to restart it?";

  renderInlineConfirm(
    fullMessage,
    "Yes, restart",
    "No, not now",
    async () => {
      renderMessage("assistant", "Restarting now… See you in a moment!");
      window.api.speak("Restarting now. See you in a moment!");
      await new Promise(resolve => setTimeout(resolve, 5000));
      await window.api.reboot();
    },
    "Your computer is under heavy load. Would you like me to restart it?"
  );
}

function renderInlineConfirm(text, yesLabel, noLabel, onYes, speakText) {
  ensureResultView();
  const kind = detectCardKind(text);
  const sentences = text.split(/(?<=[.!?])\s+/);
  const title = sentences[0] || text;
  const body = sentences.length > 1 ? sentences.slice(1).join(' ') : '';
  const card = buildCard(kind, title, body, {
    primaryLabel: yesLabel,
    secondaryLabel: noLabel,
  });

  // Wire up button handlers
  const primaryBtn = card.querySelector('[data-action="primary"]');
  const secondaryBtn = card.querySelector('[data-action="secondary"]');

  if (primaryBtn) {
    primaryBtn.addEventListener('click', async () => {
      card.querySelector('.card-actions')?.remove();
      setMicState(DOING);
      try {
        await onYes();
      } finally {
        if (currentState !== IDLE) setMicState(IDLE);
      }
    });
  }
  if (secondaryBtn) {
    secondaryBtn.addEventListener('click', () => {
      card.querySelector('.card-actions')?.remove();
      renderMessage("assistant", "Okay, no problem.");
      window.api.speak("Okay, no problem.");
      setMicState(IDLE);
    });
  }

  hintEl.classList.add("hidden");
  messagesEl.appendChild(card);
  // Ensure buttons are visible — scroll after a brief delay for render
  requestAnimationFrame(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });

  if (speakText) window.api.speak(speakText);
  currentState = CONFIRMING;
  statusEl.textContent = "";
  setVoiceButtonState(CONFIRMING);
  textInput.disabled = true;
  sendBtn.disabled = true;
}

// --- Text input: Enter submits, Shift+Enter inserts newline ---
textInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    submitTextInput();
  }
});

sendBtn.addEventListener("click", submitTextInput);

// Send button styling: toggle has-text class
textInput.addEventListener("input", () => {
  sendBtn.classList.toggle("has-text", textInput.value.trim().length > 0);
});

function submitTextInput() {
  const text = textInput.value.trim();
  console.log('[input] submitTextInput called, text:', text, 'state:', currentState, 'walkthrough:', walkthroughInputMode);
  if (!text) return;
  if (walkthroughInputMode) {
    textInput.value = "";
    sendBtn.classList.remove("has-text");
    submitWalkthroughInput(text);
    return;
  }
  if (currentState !== IDLE) return;
  window.api.stopSpeaking();
  textInput.value = "";
  sendBtn.classList.remove("has-text");
  handleUserInput(text);
}

// --- Voice button: click once to start, click again to stop ---
voiceBtn.addEventListener("click", async () => {
  if (currentState === IDLE) await startListening();
  else if (currentState === LISTENING) await stopListening();
});

async function startListening() {
  if (!micStream) {
    renderMessage(
      "assistant",
      "I couldn't access your microphone. You can still type your question below.",
    );
    window.api.speak("I couldn't access your microphone.");
    return;
  }
  window.api.stopSpeaking();
  startRecording();
  recordingStartTime = Date.now();
  startSilenceDetection();
  setMicState(LISTENING);
}

let _stopListeningLock = false;
async function stopListening() {
  if (_stopListeningLock || currentState !== LISTENING) return;
  _stopListeningLock = true;
  stopSilenceDetection();
  setMicState(THINKING);

  const audioBuffer = await stopRecording();

  if (!audioBuffer || audioBuffer.byteLength === 0) {
    renderMessage("assistant", "I didn't hear anything. Could you try again?");
    window.api.speak("I didn't hear anything. Could you try again?");
    setMicState(IDLE);
    _stopListeningLock = false;
    return;
  }

  try {
    const userText = await window.api.transcribe(audioBuffer);
    if (!userText || !userText.trim()) {
      renderMessage(
        "assistant",
        "I didn't catch that. Could you say it again?",
      );
      window.api.speak("I didn't catch that. Could you say it again?");
      setMicState(IDLE);
      _stopListeningLock = false;
      return;
    }
    await handleUserInput(userText);
  } catch (err) {
    renderMessage(
      "assistant",
      "Sorry, something went wrong. Want me to try again?",
    );
    window.api.speak("Sorry, something went wrong.");
    setMicState(IDLE);
  }
  _stopListeningLock = false;
}

// --- Confirm / cancel ---
async function handleConfirm(confirmed, action) {
  if (confirmed && action?.__walkthrough) {
    setMicState(IDLE);
    window.api.startWalkthrough(action.__walkthrough);
  } else if (confirmed) {
    setMicState(DOING);
    await executeAndFinish(action);
  } else {
    renderMessage("assistant", "Okay, never mind.");
    window.api.speak("Okay, never mind.");
    setMicState(IDLE);
  }
}

async function executeAndFinish(action) {
  try {
    if (action.name === "_killProcesses") {
      const killed = await window.api.killProcesses(action.params.pids);
      renderMessage("assistant", `Done! I closed ${killed} app${killed !== 1 ? 's' : ''}. Your computer should feel faster now.`);
      window.api.speak(`Done! I closed ${killed} apps. Your computer should feel faster now.`);
    } else if (action.name === "_reboot") {
      renderMessage("assistant", "Restarting your computer now. See you soon!");
      window.api.speak("Restarting your computer now. See you soon!");
      await window.api.reboot();
    } else {
      await window.api.executeAction(action);
      console.log('[pipeline] executeAction completed:', action.name);
      renderMessage("assistant", "Done.");
    }
    setMicState(IDLE, "completed");
  } catch (err) {
    renderMessage(
      "assistant",
      "Sorry, I couldn't do that. Want me to try something else?",
    );
    window.api.speak("Sorry, I couldn't do that.");
    setMicState(IDLE);
  }
}

// --- Title bar controls ---
document.getElementById("tb-close").addEventListener("click", () => window.api.winClose());

// --- Chip click handlers ---
document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    if (currentState !== IDLE) return;
    const text = chip.textContent.trim();
    handleUserInput(text);
  });
});

// --- Walkthrough event handling ---
let walkthroughInputMode = false;

window.api.walkthroughEvent((data) => {
  switch (data.type) {
    case "wait-for-input":
      walkthroughInputMode = true;
      renderMessage("assistant", data.text);
      window.api.speak(data.text);
      break;
    case "walkthrough-finished":
      walkthroughInputMode = false;
      renderMessage("assistant", "All done! I'm here if you need anything else.");
      setMicState(IDLE);
      break;
    case "walkthrough-cancelled":
      walkthroughInputMode = false;
      renderMessage("assistant", "Okay, stopped.");
      window.api.speak("Okay, stopped.");
      setMicState(IDLE);
      break;
  }
});

function submitWalkthroughInput(text) {
  if (!text) return;
  renderMessage("user", text);
  walkthroughInputMode = false;
  window.api.submitWalkthroughInput(text);
}

// --- Init ---
initMic();
setMicState(IDLE);

// Compact mic button — same as main voice button
const compactMicBtn = document.getElementById('compact-mic-btn');
if (compactMicBtn) {
  compactMicBtn.addEventListener('click', async () => {
    if (currentState === IDLE) await startListening();
    else if (currentState === LISTENING) await stopListening();
  });
}

// Listen for proactive system check trigger from main process
window.api.onSystemCheck(async (suggestions) => {
  if (suggestions.length > 0) {
    await showSuggestions(suggestions);
  }
});

// Listen for long-press voice trigger from the floating button.
if (window.api.onStartVoice) {
  window.api.onStartVoice(() => {
    if (currentState === IDLE) startListening();
  });
}

// Listen for pre-filled query from floating button hold-to-record flow.
if (window.api.onSubmitQuery) {
  window.api.onSubmitQuery((query) => {
    console.log('[pipeline] submit-query received:', query);
    if (currentState === IDLE && query && query.trim()) {
      console.log('[pipeline] submitting to handleUserInput');
      handleUserInput(query.trim());
    } else {
      console.warn('[pipeline] submit-query ignored — state:', currentState, 'query:', query);
    }
  });
}
