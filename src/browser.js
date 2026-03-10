// Tabbed browser renderer — one per account, shares session partition
let tabs = []; // { id, webview, title, url }
let activeTabId = null;
let partition = null;

const tabsContainer = document.getElementById('tabs');
const webviewContainer = document.getElementById('webview-container');
const newTabBtn = document.getElementById('new-tab-btn');
const addressBar = document.getElementById('address-bar');
const btnBack = document.getElementById('btn-back');
const btnForward = document.getElementById('btn-forward');
const btnReload = document.getElementById('btn-reload');

// --- Init ---

function init() {
  // Get partition from URL params (set by main process)
  const params = new URLSearchParams(window.location.search);
  partition = params.get('partition') || 'persist:default';

  // Listen for add-tab messages from main process
  window.api.onAddTab((url) => {
    addTab(url);
  });
}

// --- Tab Management ---

let tabIdCounter = 0;

function addTab(url) {
  const id = ++tabIdCounter;
  const normalizedUrl = normalizeUrl(url);

  // Create webview
  const webview = document.createElement('webview');
  webview.setAttribute('partition', partition);
  webview.setAttribute('src', normalizedUrl);
  webview.setAttribute('allowpopups', '');
  webview.style.width = '100%';
  webview.style.height = '100%';

  const tab = { id, webview, title: 'Loading...', url: normalizedUrl };
  tabs.push(tab);
  webviewContainer.appendChild(webview);

  // Webview events
  webview.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || 'Untitled';
    renderTabs();
  });

  webview.addEventListener('did-navigate', (e) => {
    tab.url = e.url;
    if (tab.id === activeTabId) {
      addressBar.value = e.url;
      updateNavButtons();
    }
  });

  webview.addEventListener('did-navigate-in-page', (e) => {
    if (e.isMainFrame) {
      tab.url = e.url;
      if (tab.id === activeTabId) {
        addressBar.value = e.url;
        updateNavButtons();
      }
    }
  });

  webview.addEventListener('did-start-loading', () => {
    setTabLoading(id, true);
  });

  webview.addEventListener('did-stop-loading', () => {
    setTabLoading(id, false);
    updateNavButtons();
  });

  // Intercept new windows — open as new tab
  webview.addEventListener('new-window', (e) => {
    e.preventDefault();
    addTab(e.url);
  });

  switchTab(id);
  renderTabs();
  return id;
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;

  const tab = tabs[idx];
  tab.webview.remove();
  tabs.splice(idx, 1);

  if (tabs.length === 0) {
    // Close window when last tab is closed
    window.close();
    return;
  }

  if (activeTabId === id) {
    // Switch to nearest tab
    const newIdx = Math.min(idx, tabs.length - 1);
    switchTab(tabs[newIdx].id);
  }

  renderTabs();
}

function switchTab(id) {
  activeTabId = id;

  for (const tab of tabs) {
    if (tab.id === id) {
      tab.webview.classList.add('active');
      addressBar.value = tab.url || '';
    } else {
      tab.webview.classList.remove('active');
    }
  }

  updateNavButtons();
  renderTabs();
}

function setTabLoading(id, loading) {
  const tabEl = document.querySelector(`.tab[data-id="${id}"]`);
  if (tabEl) {
    tabEl.classList.toggle('loading', loading);
  }
}

// --- Render ---

function renderTabs() {
  tabsContainer.innerHTML = '';

  for (const tab of tabs) {
    const el = document.createElement('div');
    el.className = `tab${tab.id === activeTabId ? ' active' : ''}`;
    el.dataset.id = tab.id;

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.title || 'New Tab';

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = '✕';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });

    el.appendChild(title);
    el.appendChild(close);

    el.addEventListener('click', () => switchTab(tab.id));

    tabsContainer.appendChild(el);
  }
}

function updateNavButtons() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;

  const wv = tab.webview;
  // canGoBack/canGoForward may not be available immediately
  try {
    btnBack.disabled = !wv.canGoBack();
    btnForward.disabled = !wv.canGoForward();
  } catch {
    btnBack.disabled = true;
    btnForward.disabled = true;
  }
}

// --- Navigation ---

function normalizeUrl(url) {
  if (!url) return 'about:blank';
  if (!/^https?:\/\//i.test(url)) {
    // If it looks like a domain, add https
    if (/^[a-z0-9]+([\-.][a-z0-9]+)*\.[a-z]{2,}/i.test(url)) {
      return 'https://' + url;
    }
    return url;
  }
  return url;
}

addressBar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab) {
      const url = normalizeUrl(addressBar.value.trim());
      tab.webview.loadURL(url);
      addressBar.value = url;
    }
  }
});

addressBar.addEventListener('focus', () => {
  addressBar.select();
});

btnBack.addEventListener('click', () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab && tab.webview.canGoBack()) tab.webview.goBack();
});

btnForward.addEventListener('click', () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab && tab.webview.canGoForward()) tab.webview.goForward();
});

btnReload.addEventListener('click', () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) tab.webview.reload();
});

newTabBtn.addEventListener('click', () => {
  addTab('about:blank');
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey) {
    if (e.key === 't') {
      e.preventDefault();
      addTab('about:blank');
    } else if (e.key === 'w') {
      e.preventDefault();
      if (activeTabId) closeTab(activeTabId);
    } else if (e.key === 'l') {
      e.preventDefault();
      addressBar.focus();
    } else if (e.key === 'r') {
      e.preventDefault();
      const tab = tabs.find(t => t.id === activeTabId);
      if (tab) tab.webview.reload();
    }
  }
});

// --- Start ---
init();
