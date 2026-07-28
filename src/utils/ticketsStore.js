'use strict';

const fs = require('node:fs');
const { resolveDataPath, readJsonFile, atomicWriteJson } = require('./dataPaths');

const STORE_PATH = resolveDataPath('ticketState.json', process.env.TICKET_STORE_PATH);
const LEGACY_PATH = resolveDataPath('tickets.json');

function defaultState() {
  return {
    schemaVersion: 2,
    counters: { corporate: 0, ingame: 0, kick: 0, ban: 0, pban: 0 },
    openByUser: {},
    updatedAt: new Date().toISOString(),
  };
}

function normalizeState(state) {
  const normalized = defaultState();
  if (state && typeof state === 'object') {
    normalized.counters = { ...normalized.counters, ...(state.counters || {}) };
    // The original project used `open`; the fixed store uses `openByUser`.
    const legacyOpen = state.openByUser || state.open;
    normalized.openByUser = legacyOpen && typeof legacyOpen === 'object' ? legacyOpen : {};
    normalized.updatedAt = state.updatedAt || normalized.updatedAt;
  }
  return normalized;
}

function readState() {
  if (!fs.existsSync(STORE_PATH) && fs.existsSync(LEGACY_PATH)) {
    const migrated = normalizeState(readJsonFile(LEGACY_PATH, defaultState()));
    atomicWriteJson(STORE_PATH, migrated);
    return migrated;
  }
  return normalizeState(readJsonFile(STORE_PATH, defaultState()));
}

function writeState(state) {
  const normalized = normalizeState(state);
  normalized.updatedAt = new Date().toISOString();
  atomicWriteJson(STORE_PATH, normalized);
}

async function removeStaleOpenTicket(guild, state, openerId) {
  const existing = state.openByUser[String(openerId)];
  if (!existing) return null;
  const channel = await guild.channels.fetch(existing).catch(() => null);
  if (channel) return existing;
  delete state.openByUser[String(openerId)];
  return null;
}

async function getNextNumberAndBump(guild, typeKey, openerId) {
  const state = readState();
  const existing = await removeStaleOpenTicket(guild, state, openerId);
  if (existing) return { blocked: true, channelId: existing };

  const key = String(typeKey || 'ticket');
  state.counters[key] = Number(state.counters[key] || 0) + 1;
  writeState(state);
  return { number: state.counters[key] };
}

async function markUserOpen(_guild, openerId, channelId) {
  const state = readState();
  state.openByUser[String(openerId)] = String(channelId);
  writeState(state);
}

async function clearUserOpen(_guild, openerId) {
  const state = readState();
  delete state.openByUser[String(openerId)];
  writeState(state);
}

module.exports = {
  STORE_PATH,
  LEGACY_PATH,
  getNextNumberAndBump,
  markUserOpen,
  clearUserOpen,
};
