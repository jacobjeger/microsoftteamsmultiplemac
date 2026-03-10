const { contextBridge, ipcRenderer } = require('electron');

// Get account ID from additional arguments
const accountId = process.argv.find(a => a.startsWith('--account-id='))?.split('=')[1] || 'unknown';

// Expose notification forwarder to the page context
// The main process injects a script that calls this function
contextBridge.exposeInMainWorld('__teamsLauncherNotify', (title, body, id) => {
  ipcRenderer.send('teams-notification', { title, body, accountId: id || accountId });
});
