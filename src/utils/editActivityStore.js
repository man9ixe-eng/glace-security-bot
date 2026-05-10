const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'editActivityStore.json');
const PENDING_TTL_MS = 30 * 60 * 1000;

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

function pruneExpiredPending() {
  const now = Date.now();
  let changed = false;

  for (const [promptMessageId, pending] of Object.entries(store.pending || {})) {
    if (!pending?.createdAt || now - pending.createdAt > PENDING_TTL_MS) {
      delete store.pending[promptMessageId];
      changed = true;
    }
  }

  if (changed) saveStore();
}

loadStore();
pruneExpiredPending();

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

  pruneExpiredPending();

  // Keep one open editor per staff member per channel so the next corrected message is easy to detect.
  for (const [existingPromptId, pending] of Object.entries(store.pending || {})) {
    if (pending?.editorUserId === editorUserId && pending?.channelId === channelId) {
      delete store.pending[existingPromptId];
    }
  }

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
  pruneExpiredPending();
  return store.pending[promptMessageId] || null;
}

function getPendingEditForEditor(channelId, editorUserId) {
  pruneExpiredPending();

  const matches = Object.values(store.pending || {})
    .filter((pending) => pending?.channelId === channelId && pending?.editorUserId === editorUserId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return matches[0] || null;
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
  getPendingEditForEditor,
  clearPendingEdit,
};
