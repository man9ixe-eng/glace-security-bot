'use strict';

const { resolveDataPath, readJsonFile, atomicWriteJson } = require('./dataPaths');

const STORE_PATH = resolveDataPath('loaRecords.json', process.env.LOA_STORE_PATH);
const EMPTY = { schemaVersion: 2, users: {}, history: [] };

function normalizeStore(input) {
  const store = input && typeof input === 'object' ? input : {};
  return {
    schemaVersion: 2,
    users: store.users && typeof store.users === 'object' ? store.users : {},
    history: Array.isArray(store.history) ? store.history : [],
  };
}

function readStore() {
  return normalizeStore(readJsonFile(STORE_PATH, EMPTY));
}

function writeStore(store) {
  atomicWriteJson(STORE_PATH, normalizeStore(store));
}

function makeKey(guildId, userId) {
  return `${String(guildId)}:${String(userId)}`;
}

function getLoaRecord(guildId, userId) {
  return readStore().users[makeKey(guildId, userId)] || null;
}

function setLoaRecord(guildId, userId, record) {
  const store = readStore();
  const key = makeKey(guildId, userId);
  store.users[key] = {
    ...(store.users[key] || {}),
    ...(record || {}),
    guildId: String(guildId),
    userId: String(userId),
    status: String(record?.status || store.users[key]?.status || 'active'),
    updatedAt: new Date().toISOString(),
  };
  writeStore(store);
  return store.users[key];
}

function clearLoaRecord(guildId, userId, endDetails = {}) {
  const store = readStore();
  const key = makeKey(guildId, userId);
  const old = store.users[key] || null;
  if (!old) return null;

  const ended = {
    ...old,
    ...endDetails,
    status: 'ended',
    endedAt: endDetails.endedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.history.unshift(ended);
  store.history = store.history.slice(0, 5000);
  delete store.users[key];
  writeStore(store);
  return old;
}

function listActiveLoas(guildId) {
  const wantedGuild = guildId == null ? null : String(guildId);
  return Object.values(readStore().users)
    .filter((record) => !wantedGuild || String(record.guildId) === wantedGuild)
    .sort((a, b) => String(a.officialEndDate || '').localeCompare(String(b.officialEndDate || '')));
}

function listLoaHistory(guildId, limit = 100) {
  const wantedGuild = guildId == null ? null : String(guildId);
  return readStore().history
    .filter((record) => !wantedGuild || String(record.guildId) === wantedGuild)
    .slice(0, Math.max(1, Number(limit) || 100));
}

module.exports = {
  STORE_PATH,
  getLoaRecord,
  setLoaRecord,
  clearLoaRecord,
  listActiveLoas,
  listLoaHistory,
};
