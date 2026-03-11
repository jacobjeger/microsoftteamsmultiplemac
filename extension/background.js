// TeamsHub Chrome Extension — Background Service Worker
// Routes Microsoft 365 links to the correct account by injecting login_hint

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

// Microsoft login URL patterns that we can inject login_hint into
const MS_LOGIN_HOSTS = [
  'login.microsoftonline.com',
  'login.microsoft.com',
  'login.live.com',
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

// Query TeamsHub for which account a domain belongs to
async function getAccountForDomain(domain) {
  try {
    const res = await fetch(`${TEAMSHUB_URL}/url-account?domain=${encodeURIComponent(domain)}`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {}
  return null;
}

// Save domain mapping
async function saveDomainMapping(domain, accountId) {
  const result = await chrome.storage.local.get('domainMappings');
  const mappings = result.domainMappings || {};
  mappings[domain] = accountId;
  await chrome.storage.local.set({ domainMappings: mappings });

  try {
    await fetch(`${TEAMSHUB_URL}/set-domain-mapping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, accountId }),
    });
  } catch {}
}

// When a Microsoft domain page loads, query TeamsHub for the account
// and cache the email for login_hint injection
chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0) return;

  const domain = extractDomain(details.url);
  if (!domain || !isMicrosoftDomain(domain)) return;

  const accountInfo = await getAccountForDomain(domain);
  if (accountInfo && accountInfo.email) {
    // Cache domain → email mapping for login_hint
    const result = await chrome.storage.local.get('domainEmails');
    const domainEmails = result.domainEmails || {};
    domainEmails[domain] = accountInfo.email;
    await chrome.storage.local.set({ domainEmails });

    // Show account color as badge
    chrome.action.setBadgeText({ tabId: details.tabId, text: ' ' });
    chrome.action.setBadgeBackgroundColor({ tabId: details.tabId, color: accountInfo.color || '#4a9eff' });
  }
}, {
  url: MS_DOMAINS.map(d => ({ hostSuffix: d.startsWith('.') ? d.slice(1) : d })),
});

// Intercept Microsoft login redirects and inject login_hint
// This runs BEFORE the navigation happens, so we can modify the URL
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;

  try {
    const url = new URL(details.url);
    const hostname = url.hostname.toLowerCase();

    // Only intercept Microsoft login pages
    if (!MS_LOGIN_HOSTS.includes(hostname)) return;

    // Already has login_hint — don't override
    if (url.searchParams.has('login_hint')) return;

    // Find the email for this auth flow by checking the redirect_uri or the referring domain
    let email = null;

    // Check redirect_uri to figure out which tenant/domain this login is for
    const redirectUri = url.searchParams.get('redirect_uri') || '';
    const redirectDomain = extractDomain(redirectUri);

    if (redirectDomain) {
      const result = await chrome.storage.local.get('domainEmails');
      const domainEmails = result.domainEmails || {};
      email = domainEmails[redirectDomain];

      // If not found by exact domain, try parent domain matching
      if (!email) {
        for (const [cachedDomain, cachedEmail] of Object.entries(domainEmails)) {
          if (redirectDomain.endsWith(cachedDomain) || cachedDomain.endsWith(redirectDomain)) {
            email = cachedEmail;
            break;
          }
          // Match by tenant: contoso.sharepoint.com → any *.contoso.* domain
          const parts = cachedDomain.split('.');
          if (parts.length >= 3) {
            const tenant = parts[0]; // e.g. "contoso" from "contoso.sharepoint.com"
            if (redirectDomain.includes(tenant)) {
              email = cachedEmail;
              break;
            }
          }
        }
      }
    }

    // Also check the tab that initiated this navigation
    if (!email && details.tabId > 0) {
      try {
        const tab = await chrome.tabs.get(details.tabId);
        if (tab && tab.url) {
          const tabDomain = extractDomain(tab.url);
          if (tabDomain) {
            const result = await chrome.storage.local.get('domainEmails');
            const domainEmails = result.domainEmails || {};
            email = domainEmails[tabDomain];
          }
        }
      } catch {}
    }

    if (email) {
      // Inject login_hint into the auth URL
      url.searchParams.set('login_hint', email);
      // Redirect to the modified URL
      chrome.tabs.update(details.tabId, { url: url.toString() });
    }
  } catch (err) {
    console.error('TeamsHub: Error injecting login_hint:', err);
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'get-state') {
    (async () => {
      const running = await pingTeamsHub();
      const accounts = running ? await getAccounts() : [];
      const stored = await chrome.storage.local.get(['pendingUrl', 'pendingDomain', 'pendingTabId']);

      // Also get current tab info
      let currentAccount = null;
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url) {
          const domain = extractDomain(tab.url);
          if (domain && isMicrosoftDomain(domain) && running) {
            currentAccount = await getAccountForDomain(domain);
          }
        }
      } catch {}

      sendResponse({
        running,
        accounts,
        currentAccount,
        pendingUrl: stored.pendingUrl || null,
        pendingDomain: stored.pendingDomain || null,
        pendingTabId: stored.pendingTabId || null,
      });
    })();
    return true;
  }

  if (message.type === 'select-account') {
    (async () => {
      const { domain, accountId, url, tabId } = message;
      await saveDomainMapping(domain, accountId);
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
