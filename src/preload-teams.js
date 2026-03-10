const { ipcRenderer } = require('electron');

// Override the Notification API to forward to main process
// With contextIsolation: false, this directly modifies the page's globals
const OriginalNotification = window.Notification;

window.Notification = function(title, options = {}) {
  // Forward to main process for native notification with account label
  ipcRenderer.send('teams-notification', {
    title: title,
    body: options.body || ''
  });

  // Don't create the web notification — only fire the native one from main process
  // This prevents duplicate notifications
};

// Mimic the Notification API surface so Teams doesn't show "enable notifications" banners
window.Notification.permission = 'granted';
window.Notification.requestPermission = async () => 'granted';

if (OriginalNotification) {
  window.Notification.maxActions = OriginalNotification.maxActions || 2;
}
