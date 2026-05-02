// renderer.js — Chat UI logic: renders transcript, drives mic state machine, calls window.api.

// Five valid states — the only values currentState may hold.
const IDLE = "idle";
const LISTENING = "listening";
const THINKING = "thinking";
const CONFIRMING = "confirming";
const DOING = "doing";
const VALID_STATES = [IDLE, LISTENING, THINKING, CONFIRMING, DOING];

// Status text shown for each state (confirming hides it since the question is in the buttons).
const STATUS_TEXT = {
  [IDLE]: "Tap to talk",
  [LISTENING]: "Listening...",
  [THINKING]: "Thinking...",
  [CONFIRMING]: "",
  [DOING]: "Doing it now...",
};

let currentState = IDLE;

// --- Mic recording ---
// MediaRecorder captures audio while the user holds the mic button.
// On release, the recorded chunks are assembled into a Blob and sent to transcribeAudio via IPC.

let mediaRecorder = null;
let audioChunks = [];
let micStream = null;

// Request mic access once upfront so the first recording starts instantly.
// Errors are caught — if mic is unavailable, transcribe receives null and returns empty.
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
  // Use webm/opus — widely supported in Chromium, ffmpeg converts it to WAV for Whisper.
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
      // Convert Blob to ArrayBuffer for IPC transfer (Electron serializes ArrayBuffers cleanly).
      const arrayBuffer = await blob.arrayBuffer();
      resolve(arrayBuffer);
    };

    mediaRecorder.stop();
  });
}

// --- DOM refs ---

const statusEl = document.getElementById("status-text");
const micArea = document.getElementById("mic-area");
const messagesEl = document.getElementById("messages");
const textInput = document.getElementById("text-input");
const sendBtn = document.getElementById("send-btn");

// --- Message rendering ---

function renderMessage(role, text) {
  const div = document.createElement("div");
  div.className = `msg msg-${role}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  // Keep newest message visible without jarring scroll on older content.
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// --- Mic area rendering ---

function renderMicButton() {
  micArea.innerHTML = "";
  const btn = document.createElement("button");
  btn.id = "mic-btn";
  btn.className = `state-${currentState}`;

  if (currentState === LISTENING) btn.classList.add("pulsing");
  if (currentState === THINKING) btn.classList.add("spinning");

  const icon = document.createElement("span");
  icon.className = "mic-icon";
  icon.textContent = currentState === THINKING ? "⟳" : "🎤";

  const label = document.createElement("span");
  label.className = "mic-label";
  label.textContent = STATUS_TEXT[currentState];

  btn.appendChild(icon);
  btn.appendChild(label);
  micArea.appendChild(btn);

  // Press-and-hold: mousedown starts listening, mouseup ends it.
  btn.addEventListener("mousedown", handleMicDown);
  btn.addEventListener("mouseup", handleMicUp);
  btn.addEventListener("touchstart", handleMicDown);
  btn.addEventListener("touchend", handleMicUp);
}

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

// --- Core state function — the only way state ever changes ---

function setMicState(state, context) {
  if (!VALID_STATES.includes(state)) {
    throw new Error(`Invalid mic state: ${state}`);
  }

  currentState = state;
  statusEl.textContent = STATUS_TEXT[state];

  if (state === CONFIRMING) {
    renderConfirmButtons(context.question, context.action);
  } else {
    renderMicButton();
  }

  // Announce state transitions so vision-impaired users know what's happening.
  if (state === LISTENING) window.api.speak("Listening");
  else if (state === THINKING) window.api.speak("Thinking");
  else if (state === DOING) window.api.speak("Doing it now");
  else if (state === CONFIRMING && context?.question)
    window.api.speak(context.question);
  else if (state === IDLE && context === "completed") window.api.speak("Done");
}

// --- State machine transitions ---

function handleMicDown(e) {
  e.preventDefault();
  if (currentState !== IDLE) return;
  startRecording();
  setMicState(LISTENING);
}

async function handleMicUp(e) {
  e.preventDefault();
  if (currentState !== LISTENING) return;
  setMicState(THINKING);

  try {
    // Stop recording and get the audio as an ArrayBuffer.
    const audioBuffer = await stopRecording();

    if (!audioBuffer || audioBuffer.byteLength === 0) {
      renderMessage(
        "assistant",
        "I didn't hear anything. Could you try again?",
      );
      window.api.speak("I didn't hear anything. Could you try again?");
      setMicState(IDLE);
      return;
    }

    // Send real audio to transcribeAudio via IPC.
    const userText = await window.api.transcribe(audioBuffer);

    if (!userText || userText.trim() === "") {
      renderMessage(
        "assistant",
        "I didn't catch that. Could you say it again?",
      );
      window.api.speak("I didn't catch that. Could you say it again?");
      setMicState(IDLE);
      return;
    }

    renderMessage("user", userText);

    const response = await window.api.getResponse(userText);
    renderMessage("assistant", response.speak);

    if (response.requiresConfirmation && response.action) {
      setMicState(CONFIRMING, {
        question: response.speak,
        action: response.action,
      });
    } else {
      setMicState(DOING);
      await executeAndFinish(response.action);
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

// Request mic access immediately so the first recording starts without delay.
initMic();
setMicState(IDLE);

// --- Text input ---

async function handleTextSend() {
  const text = textInput.value.trim();
  if (!text || currentState !== IDLE) return;

  textInput.value = '';
  sendBtn.disabled = true;
  setMicState(THINKING);
  renderMessage("user", text);

  try {
    const response = await window.api.getResponse(text);
    console.log('[DEBUG] response:', JSON.stringify(response));
    renderMessage("assistant", response.speak);
    window.api.speak(response.speak);

    if (response.requiresConfirmation && response.action) {
      setMicState(CONFIRMING, {
        question: response.speak,
        action: response.action,
      });
    } else {
      setMicState(DOING);
      await executeAndFinish(response.action);
    }
  } catch (err) {
    renderMessage("assistant", "Sorry, something went wrong. Want me to try again?");
    window.api.speak("Sorry, something went wrong.");
    setMicState(IDLE);
  } finally {
    sendBtn.disabled = false;
  }
}

sendBtn.addEventListener("click", handleTextSend);
textInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleTextSend();
});
