// floating.js — Floating button: tap opens chat, hold-to-record then release sends voice query.
//
// Hold flow:
//   pointerdown (500ms) → start recording in this window
//   while held          → keep recording, show listening UI
//   pointerup/leave     → stop recording, send audio to main, open chat with transcription

const LONG_PRESS_MS = 500;

const inner = document.getElementById('floating-inner');
const icon  = document.getElementById('floating-icon');
const label = document.getElementById('floating-label');

// --- Mic recording (mirrors renderer.js pattern) ---

let micStream    = null;
let mediaRecorder = null;
let audioChunks  = [];

async function initMic() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true },
    });
  } catch (err) {
    console.warn('[floating] Mic access denied:', err.message);
    micStream = null;
  }
}

function startRecording() {
  if (!micStream) return false;
  audioChunks = [];
  mediaRecorder = new MediaRecorder(micStream, { mimeType: 'audio/webm;codecs=opus' });
  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
  mediaRecorder.start();
  return true;
}

function stopRecording() {
  return new Promise((resolve) => {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') { resolve(null); return; }
    mediaRecorder.onstop = async () => {
      if (audioChunks.length === 0) { resolve(null); return; }
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      resolve(await blob.arrayBuffer());
    };
    mediaRecorder.stop();
  });
}

// --- Visual state helpers ---

function setIdleState() {
  inner.classList.remove('floating-listening', 'floating-processing');
  icon.textContent  = '🎤';
  label.textContent = 'Help';
}

function setListeningState() {
  inner.classList.add('floating-listening');
  inner.classList.remove('floating-processing');
  icon.textContent  = '🎙️';
  label.textContent = 'Release';
}

function setProcessingState() {
  inner.classList.remove('floating-listening');
  inner.classList.add('floating-processing');
  icon.textContent  = '⏳';
  label.textContent = '...';
}

// --- Press state ---

let pressTimer   = null;
let isLongPress  = false;
let isRecording  = false;

// --- Pointer events ---

inner.addEventListener('pointerdown', async (e) => {
  e.preventDefault();
  isLongPress = false;
  isRecording = false;

  pressTimer = setTimeout(async () => {
    isLongPress = true;

    // Request mic focus from main process so getUserMedia works in this window
    await window.api.requestMicFocus();

    const started = startRecording();
    if (started) {
      isRecording = true;
      setListeningState();
    } else {
      // Mic unavailable — fall back to opening chat normally
      isLongPress = false;
      window.api.openChatWindow();
    }
  }, LONG_PRESS_MS);
});

inner.addEventListener('pointerup', () => {
  clearTimeout(pressTimer);

  if (!isLongPress) {
    // Short tap — open chat as usual
    window.api.openChatWindow();
    return;
  }

  handleRelease();
});

inner.addEventListener('pointerleave', () => {
  clearTimeout(pressTimer);
  if (isLongPress && isRecording) {
    // Finger slid off — treat as cancel, reset
    mediaRecorder && mediaRecorder.state === 'recording' && mediaRecorder.stop();
    setIdleState();
  }
  isLongPress = false;
  isRecording = false;
});

inner.addEventListener('contextmenu', (e) => e.preventDefault());

async function handleRelease() {
  if (!isRecording) { setIdleState(); return; }

  setProcessingState();
  isRecording = false;

  const audioBuffer = await stopRecording();

  if (!audioBuffer || audioBuffer.byteLength === 0) {
    setIdleState();
    window.api.openChatWindow(); // open chat anyway so user can type
    return;
  }

  // Transcribe the audio, then open chat with the result
  try {
    const text = await window.api.transcribe(audioBuffer);
    console.log('[floating] transcription completed:', text);
    setIdleState();
    if (text && text.trim()) {
      console.log('[floating] calling openChatWindowWithQuery');
      window.api.openChatWindowWithQuery(text.trim());
    } else {
      window.api.openChatWindow();
    }
  } catch (err) {
    console.error('[floating] Transcription error:', err.message);
    setIdleState();
    window.api.openChatWindow();
  }
}

// --- Init ---
initMic();
