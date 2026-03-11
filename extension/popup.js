document.addEventListener('DOMContentLoaded', async () => {
  const statusEl = document.getElementById('status');
  const pendingEl = document.getElementById('pending-info');
  const accountsEl = document.getElementById('accounts');
  const notRunningEl = document.getElementById('not-running');
  const optionsLink = document.getElementById('options-link');

  optionsLink.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Get current state from background
  chrome.runtime.sendMessage({ type: 'get-state' }, (state) => {
    if (!state) {
      statusEl.textContent = 'Error communicating with extension';
      statusEl.className = 'status disconnected';
      return;
    }

    if (!state.running) {
      statusEl.textContent = 'Disconnected';
      statusEl.className = 'status disconnected';
      notRunningEl.style.display = 'block';
      return;
    }

    statusEl.textContent = 'Connected';
    statusEl.className = 'status connected';

    // Show pending URL if any
    if (state.pendingDomain) {
      pendingEl.style.display = 'block';
      pendingEl.innerHTML = `<strong>Route this domain:</strong> <span class="domain">${state.pendingDomain}</span>`;
    }

    // Show accounts
    if (state.accounts.length === 0) {
      accountsEl.innerHTML = '<p>No accounts configured in TeamsHub</p>';
      return;
    }

    for (const account of state.accounts) {
      const btn = document.createElement('button');
      btn.className = 'account-btn';
      btn.innerHTML = `<span class="account-dot" style="background:${account.color}"></span>${account.name}`;

      btn.addEventListener('click', () => {
        if (state.pendingUrl && state.pendingDomain) {
          chrome.runtime.sendMessage({
            type: 'select-account',
            domain: state.pendingDomain,
            accountId: account.id,
            url: state.pendingUrl,
            tabId: state.pendingTabId,
          }, () => {
            window.close();
          });
        } else {
          // No pending URL — just a status view
          window.close();
        }
      });

      accountsEl.appendChild(btn);
    }

    // Dismiss button if there's a pending URL
    if (state.pendingDomain) {
      const dismiss = document.createElement('button');
      dismiss.className = 'dismiss';
      dismiss.textContent = 'Skip — open in Chrome instead';
      dismiss.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'dismiss' });
        window.close();
      });
      accountsEl.appendChild(dismiss);
    }
  });
});
