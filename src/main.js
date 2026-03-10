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

function createColorDot(hex) {
  const svg = `<svg width="16" height="16" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="8" r="6" fill="${hex}"/>
  </svg>`;
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  );
}

// --- Tray Menu ---

function buildTrayMenu() {
  const accounts = store.getAccounts();
  const menuItems = [];

  if (accounts.length === 0) {
    menuItems.push({ label: 'No accounts configured', enabled: false });
  } else {
    for (const account of accounts) {
      const win = teamsWindows.get(account.id);
      const isOpen = win && !win.isDestroyed() && win.isVisible();
      const isHidden = win && !win.isDestroyed() && !win.isVisible();
      const statusLabel = isOpen ? ' (open)' : isHidden ? ' (background)' : '';
      menuItems.push({
        label: `${account.name}${statusLabel}`,
        icon: createColorDot(account.color),
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
  // If already open (visible or hidden), show and focus it
  if (teamsWindows.has(accountId)) {
    const existing = teamsWindows.get(accountId);
    if (!existing.isDestroyed()) {
      existing.show();
      existing.focus();
      refreshTray();
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
      contextIsolation: false, // allows preload to override page globals (safe: only loads teams.microsoft.com, nodeIntegration is false)
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [`--account-id=${account.id}`]
    }
  });

  // Store account info on the window for notification labeling
  win.accountId = account.id;
  win.accountName = account.name;

  win.webContents.setUserAgent(CHROME_UA);

  // Auto-grant notification and media permissions for Teams
  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['notifications', 'media', 'mediaKeySystem', 'geolocation'].includes(permission);
    callback(allowed);
  });

  win.loadURL('https://teams.microsoft.com');

  // Hide instead of close to keep session alive in background
  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
      refreshTray();
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.webContents.send('accounts-changed', store.getAccounts());
      }
    }
  });

  win.on('closed', () => {
    teamsWindows.delete(accountId);
    refreshTray();
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('accounts-changed', store.getAccounts());
    }
  });

  teamsWindows.set(accountId, win);
  refreshTray();
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
  // Force-destroy the window if it exists (bypass hide-on-close)
  if (teamsWindows.has(id)) {
    const win = teamsWindows.get(id);
    if (!win.isDestroyed()) win.destroy();
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
ipcMain.on('teams-notification', (event, { title, body }) => {
  // Determine which account sent this by matching the sender's webContents
  const senderContents = event.sender;
  let accountName = 'Unknown';
  let accountWindow = null;

  for (const [id, win] of teamsWindows) {
    if (!win.isDestroyed() && win.webContents.id === senderContents.id) {
      accountName = win.accountName;
      accountWindow = win;
      break;
    }
  }

  const notification = new Notification({
    title: `[${accountName}] ${title}`,
    body: body || ''
  });

  notification.on('click', () => {
    if (accountWindow && !accountWindow.isDestroyed()) {
      accountWindow.show();
      accountWindow.focus();
    }
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

  // Trigger macOS notification permission on first launch
  const accounts = store.getAccounts();
  if (accounts.length === 0) {
    const welcome = new Notification({
      title: 'Teams Launcher is running',
      body: 'Click the menu bar icon to add your Teams accounts.'
    });
    welcome.show();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
