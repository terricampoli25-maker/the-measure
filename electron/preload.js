const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  activate: (serial, machineId) => ipcRenderer.invoke('activate', { serial, machineId }),
});
