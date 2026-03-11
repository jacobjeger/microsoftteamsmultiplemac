const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage, dialog, shell } = require('electron');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const store = require('./store');

// Catch uncaught errors
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
  dialog.showErrorBox('TeamsHub Error', err.stack || err.message || String(err));
});
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err);
});

// Keep references to prevent garbage collection
let tray = null;
let settingsWindow = null;
const teamsWindows = new Map(); // accountId -> BrowserWindow
const browserWindows = new Map(); // accountId -> BrowserWindow (tabbed browser)
const unreadCounts = new Map(); // accountId -> number
let httpServer = null;

const isDev = !app.isPackaged;
const VITE_DEV_SERVER = 'http://localhost:5173';
const HTTP_PORT = parseInt(process.env.TEAMSHUB_PORT || '47847', 10);

// Chrome user agent to avoid Teams blocking Electron's default UA
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// --- Page Loading (dev vs prod) ---

function loadPage(win, page, query) {
  if (isDev) {
    const url = new URL(`${VITE_DEV_SERVER}/src/${page}/index.html`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        url.searchParams.set(k, v);
      }
    }
    win.loadURL(url.toString());
  } else {
    win.loadFile(path.join(__dirname, `../dist/src/${page}/index.html`), { query });
  }
}

// --- PNG Generation ---

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
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
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
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const compressed = zlib.deflateSync(raw);

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Tray Icon ---

function createTrayIcon() {
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
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

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
      const unread = unreadCounts.get(account.id) || 0;
      const unreadLabel = unread > 0 ? ` (${unread})` : '';
      const statusLabel = isOpen ? ' - open' : isHidden ? ' - background' : '';
      menuItems.push({
        label: `${account.name}${unreadLabel}${statusLabel}`,
        icon: createColorDot(account.color),
        click: () => launchAccount(account.id),
      });
    }

    menuItems.push({ type: 'separator' });
    menuItems.push({
      label: 'Launch All',
      click: () => {
        for (const account of store.getAccounts()) {
          launchAccount(account.id);
        }
      },
    });
    menuItems.push({
      label: 'Close All',
      click: () => {
        for (const [, win] of teamsWindows) {
          if (!win.isDestroyed()) win.close();
        }
      },
    });
  }

  menuItems.push({ type: 'separator' });
  menuItems.push({ label: 'Settings...', click: () => openSettings() });
  menuItems.push({
    label: 'Quit',
    click: () => {
      app.isQuitting = true;
      app.quit();
    },
  });

  return Menu.buildFromTemplate(menuItems);
}

function refreshTray() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

// --- Dock Badge ---

function updateDockBadge() {
  if (!app.dock) return;
  let total = 0;
  for (const count of unreadCounts.values()) {
    total += count;
  }
  app.dock.setBadge(total > 0 ? String(total) : '');
}

// --- URL Helpers ---

function isMicrosoftUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.endsWith('.microsoft.com') ||
           hostname.endsWith('.cloud.microsoft') ||
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
      webviewTag: true,
    },
  });

  loadPage(win, 'browser', { partition, accountName: account.name });

  win.webContents.once('did-finish-load', () => {
    win.webContents.send('add-tab', url);
  });

  win.on('closed', () => {
    browserWindows.delete(account.id);
  });

  browserWindows.set(account.id, win);
}

// --- Window Bounds Persistence ---

let boundsTimers = new Map();

function trackWindowBounds(win, accountId) {
  const saveBounds = () => {
    if (win.isDestroyed()) return;
    const bounds = win.getBounds();
    store.setWindowBounds(accountId, bounds);
  };

  const debouncedSave = () => {
    if (boundsTimers.has(accountId)) clearTimeout(boundsTimers.get(accountId));
    boundsTimers.set(accountId, setTimeout(saveBounds, 500));
  };

  win.on('move', debouncedSave);
  win.on('resize', debouncedSave);
}

// --- Teams Windows ---

function launchAccount(accountId) {
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

  // Restore saved bounds or use defaults
  const savedBounds = store.getWindowBounds(accountId);
  const winOptions = {
    width: savedBounds?.width || 1200,
    height: savedBounds?.height || 800,
    ...(savedBounds?.x != null && { x: savedBounds.x, y: savedBounds.y }),
    title: account.name,
    webPreferences: {
      partition: `persist:account_${account.id}`,
      preload: path.join(__dirname, 'preload-teams.js'),
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [`--account-id=${account.id}`],
    },
  };

  const win = new BrowserWindow(winOptions);
  win.accountId = account.id;
  win.accountName = account.name;

  // Track window position/size
  trackWindowBounds(win, account.id);

  win.webContents.setUserAgent(CHROME_UA);

  // Auto-grant permissions
  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['notifications', 'media', 'mediaKeySystem', 'geolocation'].includes(permission);
    callback(allowed);
  });

  // Intercept new windows — open all links in default browser (Chrome)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url && url !== 'about:blank' && url !== '') {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow', overrideBrowserWindowOptions: { show: false } };
  });

  // Catch child windows (about:blank → navigate pattern) — open in default browser
  win.webContents.on('did-create-window', (childWin) => {
    function redirectChild(url) {
      if (!url || url === 'about:blank' || url === '') return;
      if (!childWin.isDestroyed()) childWin.destroy();
      shell.openExternal(url);
    }

    childWin.webContents.on('will-navigate', (e, url) => {
      e.preventDefault();
      redirectChild(url);
    });
    childWin.webContents.on('did-navigate', (e, url) => {
      redirectChild(url);
    });
    childWin.webContents.on('will-redirect', (e, url) => {
      e.preventDefault();
      redirectChild(url);
    });

    setTimeout(() => {
      if (!childWin.isDestroyed()) {
        const url = childWin.webContents.getURL();
        if (url && url !== 'about:blank') redirectChild(url);
      }
    }, 2000);
  });

  win.loadURL('https://teams.cloud.microsoft');

  // Auto-launch configured URLs in default browser
  if (account.autoLaunchUrls && account.autoLaunchUrls.length > 0) {
    for (const url of account.autoLaunchUrls) {
      shell.openExternal(url);
    }
  }

  // Hide instead of close
  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      win.hide();
      refreshTray();
      notifySettingsChanged();
    }
  });

  win.on('closed', () => {
    teamsWindows.delete(accountId);
    unreadCounts.delete(accountId);
    updateDockBadge();
    refreshTray();
    notifySettingsChanged();
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

  if (app.dock) app.dock.show();

  settingsWindow = new BrowserWindow({
    width: 520,
    height: 600,
    resizable: true,
    minimizable: true,
    maximizable: false,
    title: 'TeamsHub',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload-settings.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  loadPage(settingsWindow, 'settings');

  settingsWindow.on('closed', () => {
    settingsWindow = null;
    const anyVisible = [...teamsWindows.values()].some(w => !w.isDestroyed() && w.isVisible());
    if (app.dock && !anyVisible) app.dock.hide();
  });
}

function notifySettingsChanged() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('accounts-changed', store.getAccounts());
  }
}

// --- IPC Handlers ---

ipcMain.handle('get-accounts', () => store.getAccounts());

ipcMain.handle('add-account', (_, name, color) => {
  const account = store.addAccount(name, color);
  refreshTray();
  return account;
});

ipcMain.handle('remove-account', (_, id) => {
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

ipcMain.handle('launch-all', () => {
  for (const account of store.getAccounts()) {
    launchAccount(account.id);
  }
});

ipcMain.handle('get-window-status', (_, id) => {
  const win = teamsWindows.get(id);
  if (!win || win.isDestroyed()) return 'closed';
  return win.isVisible() ? 'open' : 'background';
});

// Notification forwarding
ipcMain.on('teams-notification', (event, { title, body }) => {
  const senderContents = event.sender;
  let accountName = 'Unknown';
  let accountWindow = null;

  for (const [, win] of teamsWindows) {
    if (!win.isDestroyed() && win.webContents.id === senderContents.id) {
      accountName = win.accountName;
      accountWindow = win;
      break;
    }
  }

  const notification = new Notification({
    title: `[${accountName}] ${title}`,
    body: body || '',
  });

  notification.on('click', () => {
    if (accountWindow && !accountWindow.isDestroyed()) {
      accountWindow.show();
      accountWindow.focus();
    }
  });

  notification.show();
});

// Unread count
ipcMain.on('unread-count-changed', (event, count) => {
  const senderContents = event.sender;
  for (const [id, win] of teamsWindows) {
    if (!win.isDestroyed() && win.webContents.id === senderContents.id) {
      unreadCounts.set(id, count);
      break;
    }
  }
  updateDockBadge();
  refreshTray();
});

// Domain mappings for Chrome extension
ipcMain.handle('get-domain-mappings', () => store.getDomainMappings());
ipcMain.handle('set-domain-mapping', (_, domain, accountId) => {
  store.setDomainMapping(domain, accountId);
});

// Open URL in default browser
ipcMain.handle('open-url-in-account', (_, url, accountId) => {
  shell.openExternal(url);
});

// --- HTTP Server for Native Messaging / Extension ---

function startHttpServer() {
  httpServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://localhost:${HTTP_PORT}`);

    if (req.method === 'GET' && url.pathname === '/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', app: 'teamshub' }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/accounts') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(store.getAccounts()));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/domain-mappings') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(store.getDomainMappings()));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/open-url') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { url: targetUrl, accountId } = JSON.parse(body);
          const accounts = store.getAccounts();
          const account = accounts.find(a => a.id === accountId);
          if (targetUrl) {
            shell.openExternal(targetUrl);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } else {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No URL provided' }));
          }
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/set-domain-mapping') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { domain, accountId } = JSON.parse(body);
          store.setDomainMapping(domain, accountId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  httpServer.listen(HTTP_PORT, '127.0.0.1', () => {
    console.log(`TeamsHub HTTP API running on http://127.0.0.1:${HTTP_PORT}`);
  });

  httpServer.on('error', (err) => {
    console.error('HTTP server error:', err.message);
  });
}

// --- App Lifecycle ---

app.on('window-all-closed', () => {
  // Don't quit — stay in tray
});

app.whenReady().then(() => {
  try {
    if (app.dock) app.dock.hide();

    tray = new Tray(createTrayIcon());
    tray.setToolTip('TeamsHub');
    tray.setContextMenu(buildTrayMenu());
    tray.on('click', () => openSettings());

    // Start HTTP server for extension communication
    startHttpServer();

    // Open settings on launch
    openSettings();

    // Welcome notification on first launch
    const accounts = store.getAccounts();
    if (accounts.length === 0) {
      const welcome = new Notification({
        title: 'TeamsHub is running',
        body: 'Click the menu bar icon to add your Teams accounts.',
      });
      welcome.show();
    }
  } catch (err) {
    console.error('STARTUP ERROR:', err);
    dialog.showErrorBox('TeamsHub Startup Error', err.stack || err.message);
  }
});

app.on('activate', () => openSettings());

app.on('before-quit', () => {
  app.isQuitting = true;
  if (httpServer) httpServer.close();
});
