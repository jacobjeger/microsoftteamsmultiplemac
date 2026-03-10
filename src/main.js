const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage, dialog, shell } = require('electron');
const path = require('path');
const zlib = require('zlib');
const store = require('./store');

// Catch uncaught errors so we can see what's crashing
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
  dialog.showErrorBox('Teams Launcher Error', err.stack || err.message || String(err));
});
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err);
});

// Keep references to prevent garbage collection
let tray = null;
let settingsWindow = null;
const teamsWindows = new Map(); // accountId -> BrowserWindow
const browserWindows = new Map(); // accountId -> BrowserWindow (tabbed browser)

// Chrome user agent to avoid Teams blocking Electron's default UA
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// --- PNG Generation (Electron nativeImage doesn't support SVG) ---

// CRC32 lookup table
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function createPng(width, height, pixelFn) {
  // Build raw RGBA rows with filter byte (0 = None)
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y);
      const off = y * (width * 4 + 1) + 1 + x * 4;
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b; raw[off + 3] = a;
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw);

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

// --- Tray Icon ---

function createTrayIcon() {
  // 16x16 "T" icon — black on transparent, used as macOS template image
  const png = createPng(16, 16, (x, y) => {
    const topBar = y >= 3 && y <= 4 && x >= 2 && x <= 13;
    const stem = y >= 5 && y <= 12 && x >= 6 && x <= 9;
    if (topBar || stem) return [0, 0, 0, 255];
    return [0, 0, 0, 0];
  });
  const image = nativeImage.createFromBuffer(png);
  image.setTemplateImage(true);
  return image;
}

function createColorDot(hexColor) {
  // Parse hex color
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // 16x16 filled circle
  const png = createPng(16, 16, (x, y) => {
    const dx = x - 7.5, dy = y - 7.5;
    if (dx * dx + dy * dy <= 36) return [r, g, b, 255];
    return [0, 0, 0, 0];
  });
  return nativeImage.createFromBuffer(png);
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

// --- URL Helpers ---

function isMicrosoftUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.endsWith('.microsoft.com') ||
           hostname.endsWith('.microsoftonline.com') ||
           hostname.endsWith('.sharepoint.com') ||
           hostname.endsWith('.office.com') ||
           hostname.endsWith('.office365.com') ||
           hostname.endsWith('.live.com') ||
           hostname.endsWith('.onenote.com') ||
           hostname.endsWith('.onedrive.com');
  } catch {
    return false;
  }
}

// --- Browser Window (Tabbed) ---

function openInBrowser(url, account) {
  const partition = `persist:account_${account.id}`;

  if (browserWindows.has(account.id)) {
    const existing = browserWindows.get(account.id);
    if (!existing.isDestroyed()) {
      existing.webContents.send('add-tab', url);
      existing.show();
      existing.focus();
      return;
    }
  }

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: `${account.name} Browser`,
    webPreferences: {
      preload: path.join(__dirname, 'preload-browser.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  win.loadFile(path.join(__dirname, 'browser.html'), {
    query: { partition }
  });

  // Once the browser window is ready, send the initial URL as a tab
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('add-tab', url);
  });

  win.on('closed', () => {
    browserWindows.delete(account.id);
  });

  browserWindows.set(account.id, win);
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

  // Intercept link opens — Microsoft URLs go to account's browser, others to default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isMicrosoftUrl(url)) {
      openInBrowser(url, account);
    } else {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.loadURL('https://teams.microsoft.com');

  // Auto-launch configured URLs in the browser window
  if (account.autoLaunchUrls && account.autoLaunchUrls.length > 0) {
    for (const url of account.autoLaunchUrls) {
      openInBrowser(url, account);
    }
  }

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
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  // Show dock icon while settings window is open
  if (app.dock) {
    app.dock.show();
  }

  settingsWindow = new BrowserWindow({
    width: 520,
    height: 600,
    resizable: true,
    minimizable: true,
    maximizable: false,
    title: 'Teams Launcher',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload-settings.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
    // Hide dock icon again when settings closes (if no Teams windows visible)
    const anyVisible = [...teamsWindows.values()].some(w => !w.isDestroyed() && w.isVisible());
    if (app.dock && !anyVisible) {
      app.dock.hide();
    }
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
  try {
    // Hide dock icon on macOS
    if (app.dock) {
      app.dock.hide();
    }

    console.log('Creating tray icon...');
    tray = new Tray(createTrayIcon());
    tray.setToolTip('Teams Launcher');
    tray.setContextMenu(buildTrayMenu());

    // Left-click tray icon opens Settings window
    tray.on('click', () => {
      openSettings();
    });

    console.log('Tray created successfully');

    // Open settings window on launch so the app feels like a regular app
    openSettings();

    // Trigger macOS notification permission on first launch
    const accounts = store.getAccounts();
    if (accounts.length === 0) {
      const welcome = new Notification({
        title: 'Teams Launcher is running',
        body: 'Click the menu bar icon to add your Teams accounts.'
      });
      welcome.show();
    }
  } catch (err) {
    console.error('STARTUP ERROR:', err);
    dialog.showErrorBox('Teams Launcher Startup Error', err.stack || err.message);
  }
});

// Re-open settings when clicking the dock icon
app.on('activate', () => {
  openSettings();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
