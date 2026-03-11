const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getAccounts: () => ipcRenderer.invoke('get-accounts'),
  addAccount: (name, color) => ipcRenderer.invoke('add-account', name, color),
  removeAccount: (id) => ipcRenderer.invoke('remove-account', id),
  updateAccount: (id, data) => ipcRenderer.invoke('update-account', id, data),
  reorderAccounts: (ids) => ipcRenderer.invoke('reorder-accounts', ids),
  launchAccount: (id) => ipcRenderer.invoke('launch-account', id),
  launchAll: () => ipcRenderer.invoke('launch-all'),
  getWindowStatus: (id) => ipcRenderer.invoke('get-window-status', id),
  onAccountsChanged: (callback) => {
    ipcRenderer.on('accounts-changed', (_, accounts) => callback(accounts));
  },
});
