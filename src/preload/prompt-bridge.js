const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('promptAPI', {
  initial: () => ipcRenderer.invoke('prompt:initial'),
  submit: (value) => ipcRenderer.send('prompt:submit', value),
  cancel: () => ipcRenderer.send('prompt:cancel')
});
