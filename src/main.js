const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage } = require('electron');
const path = require('path');
const store = require('./store');

// Keep references to prevent garbage collection
let tray = null;
let settingsWindow = null;
const teamsWindows = new Map(); // accountId -> BrowserWindow

// Chrome user agent to avoid Teams blocking Electron's default UA
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// --- Tray Icon ---

function createTrayIcon() {
  // 16x16 template image: simple "T" icon
  const canvas = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
      <rect x="2" y="3" width="12" height="2" fill="black"/>
      <rect x="7" y="3" width="2" height="10" fill="black"/>
    </svg>
  `;
  const base64 = Buffer.from(canvas.trim()).toString('base64');
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${base64}`);
  image.setTemplateImage(true);
  return image;
}

// --- Tray Menu ---

function buildTrayMenu() {
  const accounts = store.getAccounts();
  const menuItems = [];

  if (accounts.length === 0) {
    menuItems.push({ label: 'No accounts configured', enabled: false });
  } else {
    for (const account of accounts) {
      const isOpen = teamsWindows.has(account.id) && !teamsWindows.get(account.id).isDestroyed();
      const statusLabel = isOpen ? ' (open)' : '';
      menuItems.push({
        label: `● ${account.name}${statusLabel}`,
        click: () => launchAccount(account.id)
      });
    }

    menuItems.push({ type: 'separator' });
    menuItems.push({
      label: 'Launch All',
      click: () => {
        for (const account of store.getAccounts()) {
          launchAccount(account.id);
        }
      }
    });
    menuItems.push({
      label: 'Close All',
      click: () => {
        for (const [id, win] of teamsWindows) {
          if (!win.isDestroyed()) win.close();
        }
      }
    });
  }

  menuItems.push({ type: 'separator' });
  menuItems.push({
    label: 'Settings...',
    click: () => openSettings()
  });
  menuItems.push({
    label: 'Quit',
    click: () => {
      app.isQuitting = true;
      app.quit();
    }
  });

  return Menu.buildFromTemplate(menuItems);
}

function refreshTray() {
  if (tray) {
    tray.setContextMenu(buildTrayMenu());
  }
}

// --- Teams Windows ---

function launchAccount(accountId) {
  // If already open, focus it
  if (teamsWindows.has(accountId)) {
    const existing = teamsWindows.get(accountId);
    if (!existing.isDestroyed()) {
      existing.focus();
      return;
    }
  }

  const accounts = store.getAccounts();
  const account = accounts.find(a => a.id === accountId);
  if (!account) return;

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: account.name,
    webPreferences: {
      partition: `persist:account_${account.id}`,
      preload: path.join(__dirname, 'preload-teams.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--account-id=${account.id}`]
    }
  });

  win.webContents.setUserAgent(CHROME_UA);

  // Inject notification override after page loads
  win.webContents.on('did-finish-load', () => {
    injectNotificationOverride(win, account.id);
  });

  // Also inject on navigation within Teams
  win.webContents.on('did-navigate-in-page', () => {
    injectNotificationOverride(win, account.id);
  });

  win.loadURL('https://teams.microsoft.com');

  win.on('closed', () => {
    teamsWindows.delete(accountId);
    refreshTray();
    // Notify settings window if open
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('accounts-changed', store.getAccounts());
    }
  });

  teamsWindows.set(accountId, win);
  refreshTray();
}

function injectNotificationOverride(win, accountId) {
  const script = `
    (function() {
      if (window.__teamsLauncherNotificationPatched) return;
      window.__teamsLauncherNotificationPatched = true;

      const OriginalNotification = window.Notification;
      const accountId = ${JSON.stringify(accountId)};

      window.Notification = function(title, options) {
        // Forward to main process via the exposed API
        if (window.__teamsLauncherNotify) {
          window.__teamsLauncherNotify(title, options ? options.body || '' : '', accountId);
        }
        return new OriginalNotification(title, options);
      };

      window.Notification.permission = OriginalNotification.permission;
      window.Notification.requestPermission = OriginalNotification.requestPermission.bind(OriginalNotification);

      // Copy static properties
      Object.keys(OriginalNotification).forEach(key => {
        if (!(key in window.Notification)) {
          try { window.Notification[key] = OriginalNotification[key]; } catch(e) {}
        }
      });
    })();
  `;
  win.webContents.executeJavaScript(script).catch(() => {});
}

// --- Settings Window ---

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 480,
    height: 560,
    resizable: true,
    minimizable: false,
    maximizable: false,
    title: 'Teams Launcher Settings',
    webPreferences: {
      preload: path.join(__dirname, 'preload-settings.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// --- IPC Handlers ---

ipcMain.handle('get-accounts', () => {
  return store.getAccounts();
});

ipcMain.handle('add-account', (_, name, color) => {
  const account = store.addAccount(name, color);
  refreshTray();
  return account;
});

ipcMain.handle('remove-account', (_, id) => {
  // Close the window if open
  if (teamsWindows.has(id)) {
    const win = teamsWindows.get(id);
    if (!win.isDestroyed()) win.close();
    teamsWindows.delete(id);
  }
  const accounts = store.removeAccount(id);
  refreshTray();
  return accounts;
});

ipcMain.handle('update-account', (_, id, data) => {
  const accounts = store.updateAccount(id, data);
  refreshTray();
  return accounts;
});

ipcMain.handle('reorder-accounts', (_, orderedIds) => {
  const accounts = store.reorderAccounts(orderedIds);
  refreshTray();
  return accounts;
});

ipcMain.handle('launch-account', (_, id) => {
  launchAccount(id);
});

// Notification forwarding from Teams windows
ipcMain.on('teams-notification', (_, { title, body, accountId }) => {
  const accounts = store.getAccounts();
  const account = accounts.find(a => a.id === accountId);
  const label = account ? account.name : 'Unknown';

  const notification = new Notification({
    title: `[${label}] ${title}`,
    body: body || ''
  });
  notification.show();
});

// --- App Lifecycle ---

app.on('window-all-closed', (e) => {
  // Don't quit — stay in tray
});

app.whenReady().then(() => {
  // Hide dock icon on macOS
  if (app.dock) {
    app.dock.hide();
  }

  tray = new Tray(createTrayIcon());
  tray.setToolTip('Teams Launcher');
  tray.setContextMenu(buildTrayMenu());

  // On macOS, clicking the tray icon shows the context menu by default
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
