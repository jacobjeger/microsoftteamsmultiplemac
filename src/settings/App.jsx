import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';

const COLORS = [
  { name: 'Blue', value: '#4a9eff' },
  { name: 'Green', value: '#4ade80' },
  { name: 'Red', value: '#ff6b6b' },
  { name: 'Orange', value: '#ff9f43' },
  { name: 'Purple', value: '#a78bfa' },
  { name: 'Teal', value: '#2dd4bf' },
  { name: 'Pink', value: '#f472b6' },
];

export default function App() {
  const [accounts, setAccounts] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0].value);
  const [autoLaunchUrls, setAutoLaunchUrls] = useState([]);
  const [newUrl, setNewUrl] = useState('');
  const [draggedId, setDraggedId] = useState(null);
  const nameInputRef = useRef(null);

  useEffect(() => {
    window.api.getAccounts().then(setAccounts);
    window.api.onAccountsChanged(setAccounts);
  }, []);

  const openAdd = () => {
    setEditingAccount(null);
    setName('');
    setColor(COLORS[0].value);
    setAutoLaunchUrls([]);
    setNewUrl('');
    setShowModal(true);
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  const openEdit = (account) => {
    setEditingAccount(account);
    setName(account.name);
    setColor(account.color);
    setAutoLaunchUrls(account.autoLaunchUrls || []);
    setNewUrl('');
    setShowModal(true);
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  const closeModal = () => setShowModal(false);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    if (editingAccount) {
      const updated = await window.api.updateAccount(editingAccount.id, {
        name: trimmed, color, autoLaunchUrls,
      });
      setAccounts(updated);
    } else {
      const account = await window.api.addAccount(trimmed, color);
      if (autoLaunchUrls.length > 0) {
        const updated = await window.api.updateAccount(account.id, { autoLaunchUrls });
        setAccounts(updated);
      } else {
        const all = await window.api.getAccounts();
        setAccounts(all);
      }
    }
    closeModal();
  };

  const deleteAccount = async (account) => {
    if (!confirm(`Remove "${account.name}"? This will close its window if open.`)) return;
    const updated = await window.api.removeAccount(account.id);
    setAccounts(updated);
  };

  const addUrl = () => {
    let url = newUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    setAutoLaunchUrls([...autoLaunchUrls, url]);
    setNewUrl('');
  };

  const removeUrl = (index) => {
    setAutoLaunchUrls(autoLaunchUrls.filter((_, i) => i !== index));
  };

  // Drag and drop
  const handleDragStart = (id) => setDraggedId(id);
  const handleDragEnd = () => setDraggedId(null);

  const handleDrop = async (targetId) => {
    if (!draggedId || draggedId === targetId) return;
    const ids = accounts.map(a => a.id);
    const fromIdx = ids.indexOf(draggedId);
    const toIdx = ids.indexOf(targetId);
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, draggedId);
    const updated = await window.api.reorderAccounts(ids);
    setAccounts(updated);
    setDraggedId(null);
  };

  return (
    <div className="app">
      <div className="titlebar-drag" />
      <div className="container">
        <div className="header">
          <h1>TeamsHub</h1>
          <div className="header-actions">
            <button className="btn btn-secondary" onClick={() => window.api.launchAll()} disabled={accounts.length === 0}>
              Launch All
            </button>
            <button className="btn btn-primary" onClick={openAdd}>+ Add Account</button>
          </div>
        </div>

        <div className="account-list">
          {accounts.length === 0 ? (
            <div className="empty-state">No accounts yet. Click "+ Add Account" to get started.</div>
          ) : (
            accounts.map(account => (
              <AccountRow
                key={account.id}
                account={account}
                isDragging={draggedId === account.id}
                onDragStart={() => handleDragStart(account.id)}
                onDragEnd={handleDragEnd}
                onDrop={() => handleDrop(account.id)}
                onLaunch={() => window.api.launchAccount(account.id)}
                onEdit={() => openEdit(account)}
                onDelete={() => deleteAccount(account)}
              />
            ))
          )}
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && closeModal()}>
          <div className="modal">
            <h2>{editingAccount ? 'Edit Account' : 'Add Account'}</h2>

            <label>Account Name</label>
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
                if (e.key === 'Escape') closeModal();
              }}
              placeholder="e.g. Acme Corp"
            />

            <label>Color</label>
            <div className="color-picker">
              {COLORS.map(c => (
                <div
                  key={c.value}
                  className={`color-swatch ${c.value === color ? 'selected' : ''}`}
                  style={{ background: c.value }}
                  title={c.name}
                  onClick={() => setColor(c.value)}
                />
              ))}
            </div>

            <label>Auto-launch URLs</label>
            <div className="url-list">
              {autoLaunchUrls.map((url, i) => (
                <div key={i} className="url-chip">
                  <span>{url}</span>
                  <button onClick={() => removeUrl(i)}>x</button>
                </div>
              ))}
            </div>
            <div className="url-add">
              <input
                type="text"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addUrl())}
                placeholder="https://contoso.sharepoint.com"
              />
              <button className="btn btn-secondary" onClick={addUrl}>Add</button>
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={closeModal}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={!name.trim()}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AccountRow({ account, isDragging, onDragStart, onDragEnd, onDrop, onLaunch, onEdit, onDelete }) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`account-row ${isDragging ? 'dragging' : ''} ${dragOver ? 'drag-over' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); onDrop(); }}
    >
      <span className="drag-handle">&#x2807;</span>
      <span className="color-dot" style={{ background: account.color }} />
      <span className="account-name">{account.name}</span>
      <div className="account-actions">
        <button className="btn-icon btn-launch" title="Launch" onClick={onLaunch}>&#9654;</button>
        <button className="btn-icon" title="Edit" onClick={onEdit}>&#9998;</button>
        <button className="btn-icon btn-delete" title="Delete" onClick={onDelete}>&#10005;</button>
      </div>
    </div>
  );
}
