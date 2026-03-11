const { ipcRenderer } = require('electron');

// Override the Notification API to forward to main process
const OriginalNotification = window.Notification;

window.Notification = function(title, options = {}) {
  ipcRenderer.send('teams-notification', {
    title: title,
    body: options.body || '',
  });
};

window.Notification.permission = 'granted';
window.Notification.requestPermission = async () => 'granted';

if (OriginalNotification) {
  window.Notification.maxActions = OriginalNotification.maxActions || 2;
}

// Unread count detection via page title
// Teams sets title like "(3) Chat | Microsoft Teams" when there are unreads
let lastUnreadCount = 0;

function parseUnreadCount(title) {
  const match = title && title.match(/^\((\d+)\)/);
  return match ? parseInt(match[1], 10) : 0;
}

// Watch for title changes
const titleObserver = new MutationObserver(() => {
  const count = parseUnreadCount(document.title);
  if (count !== lastUnreadCount) {
    lastUnreadCount = count;
    ipcRenderer.send('unread-count-changed', count);
  }
});

// Start observing once page loads
window.addEventListener('DOMContentLoaded', () => {
  const titleEl = document.querySelector('title');
  if (titleEl) {
    titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
  }

  // Also poll periodically as a fallback
  setInterval(() => {
    const count = parseUnreadCount(document.title);
    if (count !== lastUnreadCount) {
      lastUnreadCount = count;
      ipcRenderer.send('unread-count-changed', count);
    }
  }, 5000);
});
