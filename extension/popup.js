document.addEventListener('DOMContentLoaded', async () => {
  const statusEl = document.getElementById('status');
  const currentAccountEl = document.getElementById('current-account');
  const pendingEl = document.getElementById('pending-info');
  const accountsEl = document.getElementById('accounts');
  const notRunningEl = document.getElementById('not-running');
  const optionsLink = document.getElementById('options-link');

  optionsLink.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  chrome.runtime.sendMessage({ type: 'get-state' }, (state) => {
    if (!state) {
      statusEl.innerHTML = '<span class="status-dot"></span> Error';
      statusEl.className = 'status disconnected';
      return;
    }

    if (!state.running) {
      statusEl.innerHTML = '<span class="status-dot"></span> Disconnected';
      statusEl.className = 'status disconnected';
      notRunningEl.style.display = 'block';
      return;
    }

    statusEl.innerHTML = '<span class="status-dot"></span> Connected';
    statusEl.className = 'status connected';

    // Show current page account info
    if (state.currentAccount) {
      currentAccountEl.style.display = 'block';
      currentAccountEl.innerHTML = `
        <div class="current-label">Current page</div>
        <div class="current-info">
          <span class="current-dot" style="background:${state.currentAccount.color}"></span>
          <span class="current-name">${state.currentAccount.accountName}</span>
        </div>
        ${state.currentAccount.email ? `<div class="current-email">${state.currentAccount.email}</div>` : ''}
      `;
    }

    // Show pending domain routing
    if (state.pendingDomain) {
      pendingEl.style.display = 'block';
      pendingEl.innerHTML = `<strong>Route this domain:</strong> <span class="domain">${state.pendingDomain}</span>`;
    }

    // Show accounts
    if (state.accounts.length === 0) {
      accountsEl.innerHTML = '<p>No accounts configured</p>';
      return;
    }

    if (state.pendingDomain) {
      for (const account of state.accounts) {
        const btn = document.createElement('button');
        btn.className = 'account-btn';
        btn.innerHTML = `
          <span class="account-dot" style="background:${account.color}"></span>
          ${account.name}
          ${account.email ? `<span class="account-email-small">${account.email}</span>` : ''}
        `;

        btn.addEventListener('click', () => {
          chrome.runtime.sendMessage({
            type: 'select-account',
            domain: state.pendingDomain,
            accountId: account.id,
            url: state.pendingUrl,
            tabId: state.pendingTabId,
          }, () => window.close());
        });

        accountsEl.appendChild(btn);
      }

      const dismiss = document.createElement('button');
      dismiss.className = 'dismiss';
      dismiss.textContent = 'Skip';
      dismiss.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'dismiss' });
        window.close();
      });
      accountsEl.appendChild(dismiss);
    } else if (!state.currentAccount) {
      accountsEl.innerHTML = '<p class="hint">Open a Microsoft 365 page to see account info</p>';
    }
  });
});
