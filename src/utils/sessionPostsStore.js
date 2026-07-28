// src/utils/sessionPostsStore.js
const fs = require('fs');
const path = require('path');
const { DATA_DIR, resolveDataPath, atomicWriteJson } = require('./dataPaths');

const STORE_PATH = resolveDataPath('sessionPosts.json', process.env.SESSION_POSTS_STORE_PATH);

let store = {};

// Load from disk
function loadStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    store = JSON.parse(raw);
  } catch {
    store = {};
  }
}

function saveStore() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    atomicWriteJson(STORE_PATH, store);
  } catch (err) {
    console.error('[SESSIONS] Failed to save sessionPosts store:', err);
  }
}

loadStore();

function setSessionPost(cardId, channelId, messageId) {
  store[cardId] = { channelId, messageId };
  saveStore();
}

function getSessionPost(cardId) {
  return store[cardId] || null;
}

function clearSessionPost(cardId) {
  if (store[cardId]) {
    delete store[cardId];
    saveStore();
  }
}

module.exports = {
  setSessionPost,
  getSessionPost,
  clearSessionPost,
};
