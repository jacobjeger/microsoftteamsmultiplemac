const COLORS = [
  { name: 'Blue', value: '#4a9eff' },
  { name: 'Green', value: '#4ade80' },
  { name: 'Red', value: '#ff6b6b' },
  { name: 'Orange', value: '#ff9f43' },
  { name: 'Purple', value: '#a78bfa' },
  { name: 'Teal', value: '#2dd4bf' },
  { name: 'Pink', value: '#f472b6' }
];

let accounts = [];
let editingId = null;
let selectedColor = COLORS[0].value;
let draggedId = null;
let autoLaunchUrls = [];

const accountList = document.getElementById('account-list');
const addBtn = document.getElementById('add-account');
const launchAllBtn = document.getElementById('launch-all');
const modalOverlay = document.getElementById('modal-overlay');
const modalTitle = document.getElementById('modal-title');
const accountNameInput = document.getElementById('account-name');
const colorPicker = document.getElementById('color-picker');
const modalCancel = document.getElementById('modal-cancel');
const modalSave = document.getElementById('modal-save');
const autoLaunchUrlsList = document.getElementById('auto-launch-urls');
const newUrlInput = document.getElementById('new-url-input');
const addUrlBtn = document.getElementById('add-url-btn');

// --- Init ---

async function init() {
  accounts = await window.api.getAccounts();
  renderAccounts();
  renderColorPicker();

  window.api.onAccountsChanged((updated) => {
    accounts = updated;
    renderAccounts();
  });
}

// --- Render Accounts ---

function renderAccounts() {
  launchAllBtn.disabled = accounts.length === 0;

  if (accounts.length === 0) {
    accountList.innerHTML = '<div class="empty-state">No accounts yet. Click "+ Add Account" to get started.</div>';
    return;
  }

  accountList.innerHTML = '';
  for (const account of accounts) {
    const row = document.createElement('div');
    row.className = 'account-row';
    row.draggable = true;
    row.dataset.id = account.id;

    row.innerHTML = `
      <span class="drag-handle">⠿</span>
      <span class="color-dot" style="background: ${account.color}"></span>
      <span class="account-name">${escapeHtml(account.name)}</span>
      <div class="account-actions">
        <button class="btn-icon btn-launch" title="Launch" data-action="launch">▶</button>
        <button class="btn-icon" title="Edit" data-action="edit">✎</button>
        <button class="btn-icon btn-delete" title="Delete" data-action="delete">✕</button>
      </div>
    `;

    // Drag events
    row.addEventListener('dragstart', (e) => {
      draggedId = account.id;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      draggedId = null;
      // Remove all drag-over classes
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });

    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (draggedId && draggedId !== account.id) {
        row.classList.add('drag-over');
      }
    });

    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over');
    });

    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      if (!draggedId || draggedId === account.id) return;

      // Reorder: move draggedId before this account
      const ids = accounts.map(a => a.id);
      const fromIdx = ids.indexOf(draggedId);
      const toIdx = ids.indexOf(account.id);
      ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, draggedId);

      accounts = await window.api.reorderAccounts(ids);
      renderAccounts();
    });

    // Button actions
    row.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action) return;

      if (action === 'launch') {
        window.api.launchAccount(account.id);
      } else if (action === 'edit') {
        openModal(account);
      } else if (action === 'delete') {
        deleteAccount(account);
      }
    });

    accountList.appendChild(row);
  }
}

// --- Color Picker ---

function renderColorPicker() {
  colorPicker.innerHTML = '';
  for (const color of COLORS) {
    const swatch = document.createElement('div');
    swatch.className = `color-swatch${color.value === selectedColor ? ' selected' : ''}`;
    swatch.style.background = color.value;
    swatch.title = color.name;
    swatch.addEventListener('click', () => {
      selectedColor = color.value;
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
    });
    colorPicker.appendChild(swatch);
  }
}

// --- Modal ---

function openModal(account = null) {
  editingId = account ? account.id : null;
  modalTitle.textContent = account ? 'Edit Account' : 'Add Account';
  accountNameInput.value = account ? account.name : '';
  selectedColor = account ? account.color : COLORS[0].value;
  autoLaunchUrls = account && account.autoLaunchUrls ? [...account.autoLaunchUrls] : [];
  renderColorPicker();
  renderAutoLaunchUrls();
  modalOverlay.classList.remove('hidden');
  accountNameInput.focus();
}

function closeModal() {
  modalOverlay.classList.add('hidden');
  editingId = null;
}

async function saveModal() {
  const name = accountNameInput.value.trim();
  if (!name) return;

  if (editingId) {
    accounts = await window.api.updateAccount(editingId, { name, color: selectedColor, autoLaunchUrls });
  } else {
    const account = await window.api.addAccount(name, selectedColor);
    if (autoLaunchUrls.length > 0) {
      accounts = await window.api.updateAccount(account.id, { autoLaunchUrls });
    } else {
      accounts = await window.api.getAccounts();
    }
  }

  renderAccounts();
  closeModal();
}

async function deleteAccount(account) {
  const confirmed = confirm(`Remove "${account.name}"? This will close the window if it's open.`);
  if (!confirmed) return;

  accounts = await window.api.removeAccount(account.id);
  renderAccounts();
}

// --- Auto-Launch URLs ---

function renderAutoLaunchUrls() {
  autoLaunchUrlsList.innerHTML = '';
  for (let i = 0; i < autoLaunchUrls.length; i++) {
    const chip = document.createElement('div');
    chip.className = 'url-chip';
    const span = document.createElement('span');
    span.textContent = autoLaunchUrls[i];
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => {
      autoLaunchUrls.splice(i, 1);
      renderAutoLaunchUrls();
    });
    chip.appendChild(span);
    chip.appendChild(removeBtn);
    autoLaunchUrlsList.appendChild(chip);
  }
}

function addAutoLaunchUrl() {
  let url = newUrlInput.value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  autoLaunchUrls.push(url);
  newUrlInput.value = '';
  renderAutoLaunchUrls();
}

// --- Event Listeners ---

addBtn.addEventListener('click', () => openModal());
launchAllBtn.addEventListener('click', () => {
  for (const account of accounts) {
    window.api.launchAccount(account.id);
  }
});
modalCancel.addEventListener('click', closeModal);
modalSave.addEventListener('click', saveModal);
addUrlBtn.addEventListener('click', addAutoLaunchUrl);
newUrlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addAutoLaunchUrl();
  }
});

modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

accountNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveModal();
  if (e.key === 'Escape') closeModal();
});

// Update save button state
accountNameInput.addEventListener('input', () => {
  modalSave.disabled = !accountNameInput.value.trim();
});

// --- Helpers ---

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Start ---
init();
