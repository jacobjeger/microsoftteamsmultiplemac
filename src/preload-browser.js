const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onAddTab: (cb) => {
    ipcRenderer.on('add-tab', (_, url) => cb(url));
  }
});
