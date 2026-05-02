// floating.js — Floating button renderer logic: handles mic tap, recording lifecycle, and opening the chat window.

document.getElementById('floating-inner').addEventListener('click', () => {
  window.api.openChatWindow();
});
