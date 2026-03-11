const Store = require('electron-store');
const { v4: uuidv4 } = require('uuid');

const store = new Store({
  name: 'teamshub',
  defaults: {
    accounts: [],
    windowBounds: {},
    domainMappings: {},
  },
});

function getAccounts() {
  return store.get('accounts');
}

function addAccount(name, color) {
  const accounts = store.get('accounts');
  const account = { id: uuidv4(), name, color, autoLaunchUrls: [] };
  accounts.push(account);
  store.set('accounts', accounts);
  return account;
}

function removeAccount(id) {
  const accounts = store.get('accounts').filter(a => a.id !== id);
  store.set('accounts', accounts);
  // Clean up window bounds
  const bounds = store.get('windowBounds');
  delete bounds[id];
  store.set('windowBounds', bounds);
  return accounts;
}

function updateAccount(id, data) {
  const accounts = store.get('accounts').map(a => a.id === id ? { ...a, ...data } : a);
  store.set('accounts', accounts);
  return accounts;
}

function reorderAccounts(orderedIds) {
  const accounts = store.get('accounts');
  const map = new Map(accounts.map(a => [a.id, a]));
  const reordered = orderedIds.map(id => map.get(id)).filter(Boolean);
  store.set('accounts', reordered);
  return reordered;
}

function getWindowBounds(accountId) {
  return store.get(`windowBounds.${accountId}`) || null;
}

function setWindowBounds(accountId, bounds) {
  store.set(`windowBounds.${accountId}`, bounds);
}

function getDomainMappings() {
  return store.get('domainMappings');
}

function setDomainMapping(domain, accountId) {
  store.set(`domainMappings.${domain}`, accountId);
}

function removeDomainMapping(domain) {
  const mappings = store.get('domainMappings');
  delete mappings[domain];
  store.set('domainMappings', mappings);
}

module.exports = {
  getAccounts,
  addAccount,
  removeAccount,
  updateAccount,
  reorderAccounts,
  getWindowBounds,
  setWindowBounds,
  getDomainMappings,
  setDomainMapping,
  removeDomainMapping,
};
