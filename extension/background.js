// TeamsHub Chrome Extension — Background Service Worker
// Intercepts Microsoft 365 navigation and routes to the correct TeamsHub account

const TEAMSHUB_PORT = 47847;
const TEAMSHUB_URL = `http://127.0.0.1:${TEAMSHUB_PORT}`;

const MS_DOMAINS = [
  '.sharepoint.com',
  '.onedrive.com',
  '.office.com',
  '.office365.com',
  '.teams.microsoft.com',
  '.cloud.microsoft',
];

function isMicrosoftDomain(hostname) {
  hostname = hostname.toLowerCase();
  return MS_DOMAINS.some(d => hostname.endsWith(d));
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

// Check if TeamsHub is running
async function pingTeamsHub() {
  try {
    const res = await fetch(`${TEAMSHUB_URL}/ping`, { signal: AbortSignal.timeout(2000) });
    const data = await res.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}

// Get accounts from TeamsHub
async function getAccounts() {
  try {
    const res = await fetch(`${TEAMSHUB_URL}/accounts`, { signal: AbortSignal.timeout(3000) });
    return await res.json();
  } catch {
    return [];
  }
}

// Open URL in a specific account
async function openInAccount(url, accountId) {
  try {
    const res = await fetch(`${TEAMSHUB_URL}/open-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, accountId }),
    });
    return await res.json();
  } catch {
    return { error: 'Failed to connect to TeamsHub' };
  }
}

// Get domain mappings from local storage
async function getDomainMapping(domain) {
  const result = await chrome.storage.local.get('domainMappings');
  const mappings = result.domainMappings || {};
  return mappings[domain] || null;
}

// Save domain mapping
async function saveDomainMapping(domain, accountId) {
  const result = await chrome.storage.local.get('domainMappings');
  const mappings = result.domainMappings || {};
  mappings[domain] = accountId;
  await chrome.storage.local.set({ domainMappings: mappings });

  // Also save to TeamsHub
  try {
    await fetch(`${TEAMSHUB_URL}/set-domain-mapping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, accountId }),
    });
  } catch {
    // Not critical
  }
}

// Track Microsoft 365 navigation — show badge so user can manually route if needed
// Does NOT auto-redirect since links already open in Chrome from TeamsHub
chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return;

  const domain = extractDomain(details.url);
  if (!domain || !isMicrosoftDomain(domain)) return;

  // Just store the URL info so the popup can offer routing if the user clicks it
  await chrome.storage.local.set({
    pendingUrl: details.url,
    pendingDomain: domain,
    pendingTabId: details.tabId,
  });
}, {
  url: MS_DOMAINS.map(d => ({ hostSuffix: d.startsWith('.') ? d.slice(1) : d })),
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'get-state') {
    (async () => {
      const running = await pingTeamsHub();
      const accounts = running ? await getAccounts() : [];
      const stored = await chrome.storage.local.get(['pendingUrl', 'pendingDomain', 'pendingTabId']);
      sendResponse({
        running,
        accounts,
        pendingUrl: stored.pendingUrl || null,
        pendingDomain: stored.pendingDomain || null,
        pendingTabId: stored.pendingTabId || null,
      });
    })();
    return true; // async response
  }

  if (message.type === 'select-account') {
    (async () => {
      const { domain, accountId, url, tabId } = message;
      await saveDomainMapping(domain, accountId);
      const result = await openInAccount(url, accountId);
      if (result.success && tabId) {
        chrome.tabs.remove(tabId).catch(() => {});
      }
      chrome.action.setBadgeText({ text: '' });
      await chrome.storage.local.remove(['pendingUrl', 'pendingDomain', 'pendingTabId']);
      sendResponse({ success: true });
    })();
    return true;
  }

  if (message.type === 'dismiss') {
    chrome.action.setBadgeText({ text: '' });
    chrome.storage.local.remove(['pendingUrl', 'pendingDomain', 'pendingTabId']);
    sendResponse({ success: true });
  }
});
