const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('client', {
  connect: data => ipcRenderer.invoke('connect-bot', data),
  disconnect: name => ipcRenderer.invoke('disconnect-bot', name),
  disconnectAll: () => ipcRenderer.invoke('disconnect-all'),
  chat: data => ipcRenderer.invoke('send-chat', data),
  onStatus: callback => ipcRenderer.on('bot-status', (_event, data) => callback(data))
});