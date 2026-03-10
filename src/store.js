const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const storePath = path.join(app.getPath('userData'), 'accounts.json');

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(storePath, 'utf-8'));
  } catch {
    return [];
  }
}

function writeStore(accounts) {
  fs.writeFileSync(storePath, JSON.stringify(accounts, null, 2), 'utf-8');
}

function getAccounts() {
  return readStore();
}

function saveAccounts(accounts) {
  writeStore(accounts);
}

function addAccount(name, color) {
  const accounts = readStore();
  const account = { id: uuidv4(), name, color };
  accounts.push(account);
  writeStore(accounts);
  return account;
}

function removeAccount(id) {
  const accounts = readStore().filter(a => a.id !== id);
  writeStore(accounts);
  return accounts;
}

function updateAccount(id, data) {
  const accounts = readStore().map(a => a.id === id ? { ...a, ...data } : a);
  writeStore(accounts);
  return accounts;
}

function reorderAccounts(orderedIds) {
  const accounts = readStore();
  const map = new Map(accounts.map(a => [a.id, a]));
  const reordered = orderedIds.map(id => map.get(id)).filter(Boolean);
  writeStore(reordered);
  return reordered;
}

module.exports = { getAccounts, saveAccounts, addAccount, removeAccount, updateAccount, reorderAccounts };
