// renderer.js — Chat UI logic: renders transcript, drives mic state machine, calls window.api.

// Five valid states — the only values currentState may hold.
const IDLE = "idle";
const LISTENING = "listening";
const THINKING = "thinking";
const CONFIRMING = "confirming";
const DOING = "doing";
const VALID_STATES = [IDLE, LISTENING, THINKING, CONFIRMING, DOING];

// Status text shown only during active states.
const STATUS_TEXT = {
  [IDLE]: "",
  [LISTENING]: "🎙 Listening...",
  [THINKING]: "⏳ Thinking...",
  [CONFIRMING]: "",
  [DOING]: "⚙️ Doing it now...",
};

const STATUS_COLOR = {
  [LISTENING]: "#E74C3C",
  [THINKING]: "#666",
  [DOING]: "#27AE60",
  [CONFIRMING]: "",
  [IDLE]: "",
};

let currentState = IDLE;

// --- Mic recording ---

let mediaRecorder = null;
let audioChunks = [];
let micStream = null;

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

const statusEl        = document.getElementById("status-text");
const micArea         = document.getElementById("mic-area");
const messagesEl      = document.getElementById("messages");
const hintEl          = document.getElementById("hint");
const chipsEl         = document.getElementById("chips");
const textInput       = document.getElementById("text-input");
const sendBtn         = document.getElementById("send-btn");
const voiceBtn        = document.getElementById("voice-btn");
const voiceIcon       = document.getElementById("voice-icon");
const voiceLabel      = document.getElementById("voice-label");
const doingBar        = document.getElementById("doing-bar");
const typingIndicator = document.getElementById("typing-indicator");

// --- Title bar buttons ---

document.getElementById("tb-minimize").addEventListener("click", () => window.api.winMinimize());
document.getElementById("tb-maximize").addEventListener("click", () => window.api.winMaximize());
document.getElementById("tb-close").addEventListener("click", () => window.api.winClose());

// --- Quick suggestion chips ---

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    if (currentState !== IDLE) return;
    window.api.stopSpeaking();
    textInput.value = "";
    handleUserInput(chip.textContent);
  });
});

// --- Live transcript preview ---

let previewEl = null;

function showTranscriptPreview() {
  if (previewEl) return;
  previewEl = document.createElement("div");
  previewEl.className = "msg msg-user msg-preview";
  previewEl.textContent = "Listening… ▌";
  messagesEl.appendChild(previewEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function removeTranscriptPreview() {
  if (previewEl) {
    previewEl.remove();
    previewEl = null;
  }
}

// --- Message rendering ---

function renderMessage(role, text) {
  hintEl.classList.add("hidden");
  chipsEl.classList.add("hidden");

  const div = document.createElement("div");
  div.className = `msg msg-${role}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// --- Confirmation buttons ---

function renderConfirmButtons(question, action) {
  micArea.innerHTML = "";

  const yes = document.createElement("button");
  yes.className = "confirm-btn confirm-yes";
  yes.textContent = "✓ Yes";
  yes.addEventListener("click", () => handleConfirm(true, action));

  const no = document.createElement("button");
  no.className = "confirm-btn confirm-no";
  no.textContent = "✗ No";
  no.addEventListener("click", () => handleConfirm(false, action));

  micArea.appendChild(yes);
  micArea.appendChild(no);
}

function clearConfirmButtons() {
  micArea.innerHTML = "";
}

// --- Voice button visual state ---

function setVoiceButtonState(state) {
  voiceBtn.className = "";

  if (state === LISTENING) {
    voiceBtn.classList.add("voice-btn-listening");
    voiceIcon.textContent = "⏹";
    voiceLabel.textContent = "Stop";
  } else if (state === THINKING) {
    voiceBtn.classList.add("voice-btn-thinking", "spinning-icon");
    voiceIcon.textContent = "⟳";
    voiceLabel.textContent = "...";
  } else if (state === DOING) {
    voiceBtn.classList.add("voice-btn-doing");
    voiceIcon.textContent = "🔊";
    voiceLabel.textContent = "Doing";
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
  statusEl.style.color = STATUS_COLOR[state] || "#666";

  // Doing progress bar
  if (state === DOING) {
    doingBar.classList.add("active");
    // Reset animation by re-inserting fill
    const fill = document.getElementById("doing-bar-fill");
    fill.style.animation = "none";
    fill.offsetHeight; // force reflow
    fill.style.animation = "";
  } else {
    doingBar.classList.remove("active");
  }

  // Typing indicator
  if (state === THINKING) {
    typingIndicator.classList.remove("hidden");
    messagesEl.scrollTop = messagesEl.scrollHeight;
  } else {
    typingIndicator.classList.add("hidden");
  }

  // Live transcript preview
  if (state === LISTENING) {
    showTranscriptPreview();
  } else {
    removeTranscriptPreview();
  }

  if (state === CONFIRMING) {
    renderConfirmButtons(context.question, context.action);
  } else {
    clearConfirmButtons();
  }

  setVoiceButtonState(state);

  const busy = state !== IDLE && state !== CONFIRMING;
  textInput.disabled = busy;
  sendBtn.disabled = busy;
  voiceBtn.disabled = state === THINKING || state === DOING || state === CONFIRMING;

  // Announce transitions for vision-impaired users.
  if (state === LISTENING) window.api.speak("Listening");
  else if (state === THINKING) window.api.speak("Thinking");
  else if (state === DOING) window.api.speak("Doing it now");
  else if (state === CONFIRMING && context?.question)
    window.api.speak(context.question);
  else if (state === IDLE && context === "completed") window.api.speak("Done");
}

// --- Shared response handler ---

async function handleUserInput(userText) {
  if (!userText || !userText.trim()) return;

  renderMessage("user", userText);
  setMicState(THINKING);

  try {
    const response = await window.api.getResponse(userText);
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
      setMicState(IDLE);
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

// --- Text input ---

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
  window.api.stopSpeaking();
  textInput.value = "";
  handleUserInput(text);
}

// --- Voice button ---

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
  setMicState(LISTENING);
}

async function stopListening() {
  setMicState(THINKING);

  const audioBuffer = await stopRecording();

  if (!audioBuffer || audioBuffer.byteLength === 0) {
    renderMessage("assistant", "I didn't hear anything. Could you try again?");
    window.api.speak("I didn't hear anything. Could you try again?");
    setMicState(IDLE);
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
    await window.api.executeAction(action);
    renderMessage("assistant", "Done.");
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

// Remove window-open animation class after it plays so it doesn't replay on reflow.
setTimeout(() => document.body.classList.remove("window-opening"), 250);
