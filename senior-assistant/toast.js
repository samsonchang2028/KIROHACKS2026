const { ipcRenderer } = require('electron');

ipcRenderer.on('show-toast', (_e, message) => {
  document.getElementById('text').textContent = message;
});

document.getElementById('fix-btn').addEventListener('click', () => {
  ipcRenderer.invoke('openChatWindow');
  ipcRenderer.invoke('toast-clicked');
});
