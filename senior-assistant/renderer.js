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
  [LISTENING]: "Listening...",
  [THINKING]: "Thinking...",
  [CONFIRMING]: "",
  [DOING]: "Doing it now...",
};

let currentState = IDLE;

// --- Mic recording (teammate's implementation — do not modify signatures) ---
// initMic requests access upfront so first recording starts instantly.
// startRecording / stopRecording wrap MediaRecorder with clean ArrayBuffer output.

let mediaRecorder = null;
let audioChunks = [];
let micStream = null;

// --- Silence detection (auto-stop) ---
let audioContext = null;
let analyser = null;
let silenceTimer = null;
const SILENCE_THRESHOLD = 40;   // average frequency level below this = silence (0-255 scale)
const SILENCE_DURATION = 1500;  // ms of silence before auto-stop
const MIN_RECORD_TIME = 800;    // don't auto-stop in the first 800ms
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
  if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; }
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
      // ArrayBuffer transfers cleanly over Electron IPC.
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

// --- Message rendering ---

function renderMessage(role, text) {
  // Hide the onboarding hint permanently once the first message appears.
  hintEl.classList.add("hidden");

  const div = document.createElement("div");
  div.className = `msg msg-${role}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// --- Confirmation buttons (injected into mic-area during confirming state) ---

function renderConfirmButtons(question, action) {
  micArea.innerHTML = "";

  const yes = document.createElement("button");
  yes.className = "confirm-btn confirm-yes";
  yes.textContent = "Yes";
  yes.addEventListener("click", () => handleConfirm(true, action));

  const no = document.createElement("button");
  no.className = "confirm-btn confirm-no";
  no.textContent = "No";
  no.addEventListener("click", () => handleConfirm(false, action));

  micArea.appendChild(yes);
  micArea.appendChild(no);
}

function clearConfirmButtons() {
  micArea.innerHTML = "";
}

// --- Voice button visual state ---

function setVoiceButtonState(state) {
  voiceBtn.className = `voice-btn-${state}`;

  if (state === LISTENING) {
    voiceIcon.textContent = "⏹";
    voiceLabel.textContent = "Stop";
    // Glow ring signals mic is live — slow and calm, not alarming.
    voiceBtn.classList.add("pulsing");
  } else if (state === THINKING) {
    voiceIcon.textContent = "⟳";
    voiceLabel.textContent = "Thinking...";
    voiceBtn.classList.add("spinning-icon");
  } else {
    voiceIcon.textContent = "🎤";
    voiceLabel.textContent = "Speak";
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

  // Disable text input while assistant is busy; re-enable at idle or confirming.
  const busy = state !== IDLE && state !== CONFIRMING;
  textInput.disabled = busy;
  sendBtn.disabled = busy;
  voiceBtn.disabled = state === THINKING || state === DOING;

  // Announce transitions for vision-impaired users.
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
    renderMessage("assistant", response.speak);

    if (response.requiresConfirmation && response.action) {
      setMicState(CONFIRMING, {
        question: response.speak,
        action: response.action,
      });
    } else if (response.action) {
      window.api.speak(response.speak);
      setMicState(DOING);
      await executeAndFinish(response.action);
    } else {
      window.api.speak(response.speak);
      // Show suggestions if any (e.g. slow computer → offer to close apps)
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
  const rebootSuggestion = suggestions.find(s => s.includes("been on for"));

  // Memory: offer to close heavy apps
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
      }
    } catch (err) {
      console.error("[suggestions] getHeavyProcesses failed:", err.message);
    }
  }

  // Reboot: just recommend it, don't offer to do it
  if (rebootSuggestion) {
    renderMessage("assistant", rebootSuggestion + " Try restarting your computer when you get a chance — it only takes a minute and can make a big difference.");
    window.api.speak("Your computer has been on a while. Try restarting it when you get a chance.");
    setMicState(IDLE);
    return;
  }

  if (!memSuggestion) {
    for (const s of suggestions) {
      renderMessage("assistant", s);
    }
    setMicState(IDLE);
  }
}

function renderInlineConfirm(text, yesLabel, noLabel, onYes, speakText) {
  const div = document.createElement("div");
  div.className = "msg msg-assistant";
  div.style.whiteSpace = "pre-line";
  div.textContent = text;

  const btnRow = document.createElement("div");
  btnRow.style.marginTop = "10px";
  btnRow.style.display = "flex";
  btnRow.style.gap = "8px";

  const yes = document.createElement("button");
  yes.className = "confirm-btn confirm-yes";
  yes.textContent = yesLabel;
  yes.addEventListener("click", async () => {
    btnRow.remove();
    setMicState(DOING);
    await onYes();
  });

  const no = document.createElement("button");
  no.className = "confirm-btn confirm-no";
  no.textContent = noLabel;
  no.addEventListener("click", () => {
    btnRow.remove();
    renderMessage("assistant", "Okay, no problem.");
    window.api.speak("Okay, no problem.");
    setMicState(IDLE);
  });

  btnRow.appendChild(yes);
  btnRow.appendChild(no);
  div.appendChild(btnRow);

  hintEl.classList.add("hidden");
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  if (speakText) window.api.speak(speakText);
  currentState = CONFIRMING;
  statusEl.textContent = "";
  setVoiceButtonState(CONFIRMING);
  textInput.disabled = true;
  sendBtn.disabled = true;
}

// --- Text input: Enter submits, Shift+Enter inserts newline ---

textInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submitTextInput();
  }
});

sendBtn.addEventListener("click", submitTextInput);

function submitTextInput() {
  const text = textInput.value.trim();
  if (!text || currentState !== IDLE) return;
  // Stop any in-progress speech when user submits text.
  window.api.stopSpeaking();
  textInput.value = "";
  handleUserInput(text);
}

// --- Voice button: click once to start, click again to stop ---

voiceBtn.addEventListener("click", async () => {
  if (currentState === IDLE) await startListening();
  else if (currentState === LISTENING) await stopListening();
  // Other states: button is disabled, clicks are ignored.
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
  // Stop any in-progress speech when user starts talking.
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
  if (confirmed) {
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

// --- Init ---

initMic();
setMicState(IDLE);

// Listen for proactive system check trigger from main process
window.api.onSystemCheck(async (suggestions) => {
  if (suggestions.length > 0) {
    await showSuggestions(suggestions);
  }
});

// Listen for long-press voice trigger from the floating button.
// When main sends "start-voice", auto-start listening if we're idle.
if (window.api.onStartVoice) {
  window.api.onStartVoice(() => {
    if (currentState === IDLE) startListening();
  });
}

// Listen for pre-filled query from floating button hold-to-record flow.
// When main sends "submit-query", submit it as if the user typed and sent it.
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
