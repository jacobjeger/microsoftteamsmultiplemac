const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onAddTab: (callback) => {
    ipcRenderer.on('add-tab', (_, url) => callback(url));
  },
  getQueryParams: () => {
    const params = new URLSearchParams(window.location.search);
    return {
      partition: params.get('partition') || '',
      accountName: params.get('accountName') || 'Browser',
    };
  },
});
