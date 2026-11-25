const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('luminaDesktop', {
  isDesktop: true,
  platform: process.platform,
  pickFolder: () => ipcRenderer.invoke('lumina:pick-folder'),
});
