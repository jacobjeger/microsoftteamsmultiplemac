const TEAMSHUB_URL = 'http://127.0.0.1:47847';

document.addEventListener('DOMContentLoaded', async () => {
  const statusBar = document.getElementById('status-bar');
  const tbody = document.getElementById('mappings-body');
  const emptyEl = document.getElementById('empty');

  // Check connection
  let accounts = [];
  let running = false;
  try {
    const res = await fetch(`${TEAMSHUB_URL}/ping`, { signal: AbortSignal.timeout(2000) });
    const data = await res.json();
    running = data.status === 'ok';
  } catch {}

  if (running) {
    statusBar.textContent = 'Connected to TeamsHub';
    statusBar.className = 'status-bar connected';
    try {
      const res = await fetch(`${TEAMSHUB_URL}/accounts`);
      accounts = await res.json();
    } catch {}
  } else {
    statusBar.textContent = 'TeamsHub is not running — start it to manage mappings';
    statusBar.className = 'status-bar disconnected';
  }

  const accountMap = new Map(accounts.map(a => [a.id, a]));

  // Load mappings
  const result = await chrome.storage.local.get('domainMappings');
  const mappings = result.domainMappings || {};
  const entries = Object.entries(mappings);

  if (entries.length === 0) {
    emptyEl.style.display = 'block';
    return;
  }

  for (const [domain, accountId] of entries) {
    const account = accountMap.get(accountId);
    const tr = document.createElement('tr');

    const domainTd = document.createElement('td');
    domainTd.textContent = domain;

    const accountTd = document.createElement('td');
    if (account) {
      accountTd.innerHTML = `<div class="account-cell"><span class="account-dot" style="background:${account.color}"></span>${account.name}</div>`;
    } else {
      accountTd.textContent = accountId;
      accountTd.style.color = '#888';
    }

    const actionTd = document.createElement('td');
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      delete mappings[domain];
      await chrome.storage.local.set({ domainMappings: mappings });
      tr.remove();
      if (Object.keys(mappings).length === 0) {
        emptyEl.style.display = 'block';
      }
    });
    actionTd.appendChild(deleteBtn);

    tr.appendChild(domainTd);
    tr.appendChild(accountTd);
    tr.appendChild(actionTd);
    tbody.appendChild(tr);
  }
});
