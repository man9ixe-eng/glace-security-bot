const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'editActivityStore.json');

let store = {
  sessions: {},
  pending: {},
};

function loadStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      store.sessions = parsed.sessions || {};
      store.pending = parsed.pending || {};
    }
  } catch {
    store = { sessions: {}, pending: {} };
  }
}

function saveStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.error('[EDITACTIVITY] Failed to save store:', err);
  }
}

loadStore();

function upsertSession(record) {
  if (!record || !record.shortId) return null;
  const existing = store.sessions[record.shortId] || {};
  store.sessions[record.shortId] = {
    ...existing,
    ...record,
    updatedAt: Date.now(),
  };
  saveStore();
  return store.sessions[record.shortId];
}

function getSession(shortId) {
  return store.sessions[shortId] || null;
}

function createPendingEdit({ promptMessageId, editorUserId, channelId, shortId }) {
  if (!promptMessageId || !editorUserId || !channelId || !shortId) return null;
  store.pending[promptMessageId] = {
    promptMessageId,
    editorUserId,
    channelId,
    shortId,
    createdAt: Date.now(),
  };
  saveStore();
  return store.pending[promptMessageId];
}

function getPendingEdit(promptMessageId) {
  return store.pending[promptMessageId] || null;
}

function clearPendingEdit(promptMessageId) {
  if (!store.pending[promptMessageId]) return false;
  delete store.pending[promptMessageId];
  saveStore();
  return true;
}

module.exports = {
  upsertSession,
  getSession,
  createPendingEdit,
  getPendingEdit,
  clearPendingEdit,
};
