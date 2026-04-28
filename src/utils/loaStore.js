// src/utils/loaStore.js
// Simple persistent LOA store so /removeloa can restore nicknames and log duration.

const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_PATH = process.env.LOA_STORE_PATH || path.join(DATA_DIR, 'loaRecords.json');

function ensureStoreFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ users: {} }, null, 2));
  }
}

function readStore() {
  ensureStoreFile();

  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object') return { users: {} };
    if (!parsed.users || typeof parsed.users !== 'object') parsed.users = {};
    return parsed;
  } catch (err) {
    console.error('[LOA STORE] Failed to read store:', err);
    return { users: {} };
  }
}

function writeStore(store) {
  ensureStoreFile();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store || { users: {} }, null, 2));
}

function makeKey(guildId, userId) {
  return `${String(guildId)}:${String(userId)}`;
}

function getLoaRecord(guildId, userId) {
  const store = readStore();
  return store.users[makeKey(guildId, userId)] || null;
}

function setLoaRecord(guildId, userId, record) {
  const store = readStore();
  const key = makeKey(guildId, userId);
  store.users[key] = {
    ...(store.users[key] || {}),
    ...(record || {}),
    guildId: String(guildId),
    userId: String(userId),
    updatedAt: new Date().toISOString(),
  };
  writeStore(store);
  return store.users[key];
}

function clearLoaRecord(guildId, userId) {
  const store = readStore();
  const key = makeKey(guildId, userId);
  const old = store.users[key] || null;
  delete store.users[key];
  writeStore(store);
  return old;
}

module.exports = {
  getLoaRecord,
  setLoaRecord,
  clearLoaRecord,
};
