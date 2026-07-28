'use strict';

const { resolveDataPath, readJsonFile, atomicWriteJson } = require('./dataPaths');

const dataFile = resolveDataPath('warnings.json', process.env.WARNINGS_STORE_PATH);

function loadData() {
  const data = readJsonFile(dataFile, {});
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

function saveData(data) {
  try {
    atomicWriteJson(dataFile, data || {});
    return true;
  } catch (err) {
    console.error('[WARNINGS] Failed to save warnings data:', err);
    return false;
  }
}

function addWarning(guildId, userId, warning) {
  const data = loadData();
  if (!data[guildId]) data[guildId] = {};
  if (!data[guildId][userId]) data[guildId][userId] = [];
  data[guildId][userId].push(warning);
  saveData(data);
  return data[guildId][userId];
}

function getWarnings(guildId, userId) {
  const data = loadData();
  if (!data[guildId]) return [];
  return data[guildId][userId] || [];
}

function clearWarnings(guildId, userId) {
  const data = loadData();
  if (data[guildId] && data[guildId][userId]) {
    delete data[guildId][userId];
    if (Object.keys(data[guildId]).length === 0) delete data[guildId];
    saveData(data);
    return true;
  }
  return false;
}

function removeWarning(guildId, userId, index) {
  const data = loadData();
  if (!data[guildId] || !Array.isArray(data[guildId][userId])) {
    return { removed: null, remaining: [] };
  }

  const list = data[guildId][userId];
  if (index < 0 || index >= list.length) return { removed: null, remaining: list };

  const [removed] = list.splice(index, 1);
  if (list.length === 0) {
    delete data[guildId][userId];
    if (Object.keys(data[guildId]).length === 0) delete data[guildId];
  }

  saveData(data);
  return { removed, remaining: list };
}

module.exports = {
  addWarning,
  getWarnings,
  clearWarnings,
  removeWarning,
};
