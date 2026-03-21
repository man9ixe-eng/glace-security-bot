"use strict";

/**
 * Ticket counter + one-open-ticket-per-user store
 * Stored as ONE pinned JSON message in the counter channel
 */

const cfg = require("../config/tickets");

function defaultState() {
  return {
    counters: {
      corporate: 0,
      ingame: 0,
      kick: 0,
      ban: 0,
      pban: 0,
    },
    openByUser: {}, // { [userId]: channelId }
  };
}

function isStateMessage(msg) {
  if (!msg) return false;
  const c = String(msg.content || "");
  return c.includes('"counters"') && c.includes('"openByUser"');
}

async function fetchPinnedStateMessage(channel) {
  const pins = await channel.messages.fetchPinned(); // Collection
  if (!pins || pins.size === 0) return null;

  // keep only pinned state messages (usually authored by the bot)
  const candidates = pins.filter((m) => isStateMessage(m));

  if (candidates.size === 0) return null;

  // Choose the OLDEST state message as canonical
  const ordered = Array.from(candidates.values()).sort(
    (a, b) => (a.createdTimestamp || 0) - (b.createdTimestamp || 0)
  );
  const keep = ordered[0];

  // Cleanup duplicates (unpin + optionally delete extras)
  const extras = ordered.slice(1);
  for (const m of extras) {
    try {
      await m.unpin().catch(() => {});
      // delete only if bot authored it (avoid nuking human pins)
      if (m.author?.bot) await m.delete().catch(() => {});
    } catch {}
  }

  return keep;
}

async function ensurePinnedStateMessage(channel) {
  let msg = await fetchPinnedStateMessage(channel);

  if (!msg) {
    msg = await channel.send(
      "```json\n" + JSON.stringify(defaultState(), null, 2) + "\n```"
    );
    await msg.pin().catch(() => {});
  }

  return msg;
}

function parseStateFromMessage(msg) {
  try {
    const raw = String(msg.content || "")
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    const parsed = JSON.parse(raw);

    // normalize missing keys safely
    if (!parsed || typeof parsed !== "object") return defaultState();
    if (!parsed.counters || typeof parsed.counters !== "object") parsed.counters = {};
    if (!parsed.openByUser || typeof parsed.openByUser !== "object") parsed.openByUser = {};

    for (const k of Object.keys(defaultState().counters)) {
      if (typeof parsed.counters[k] !== "number") parsed.counters[k] = 0;
    }

    return parsed;
  } catch {
    return defaultState();
  }
}

async function saveStateToMessage(msg, state) {
  await msg.edit("```json\n" + JSON.stringify(state, null, 2) + "\n```");
}

async function getCounterChannel(guild) {
  const ch = await guild.channels.fetch(cfg.TICKET_COUNTER_CHANNEL_ID).catch(() => null);
  if (!ch) throw new Error("TICKET_COUNTER_CHANNEL_ID invalid or bot cannot access it.");
  return ch;
}

/**
 * Returns:
 * - { blocked: true, channelId } if opener already has an open ticket (and that channel still exists)
 * - { number } with the bumped counter otherwise
 */
async function getNextNumberAndBump(guild, typeKey, openerId) {
  const channel = await getCounterChannel(guild);
  const msg = await ensurePinnedStateMessage(channel);
  const state = parseStateFromMessage(msg);

  // One open ticket per user (stale-safe)
  const existing = state.openByUser[openerId];
  if (existing) {
    const exists = await guild.channels.fetch(existing).catch(() => null);
    if (exists) {
      return { blocked: true, channelId: existing };
    }
    // stale mapping -> clear it and continue
    delete state.openByUser[openerId];
  }

  state.counters[typeKey] = (state.counters[typeKey] || 0) + 1;
  await saveStateToMessage(msg, state);

  return { number: state.counters[typeKey] };
}

async function markUserOpen(guild, openerId, channelId) {
  const channel = await getCounterChannel(guild);
  const msg = await ensurePinnedStateMessage(channel);
  const state = parseStateFromMessage(msg);

  state.openByUser[openerId] = channelId;
  await saveStateToMessage(msg, state);
}

async function clearUserOpen(guild, openerId) {
  const channel = await getCounterChannel(guild);
  const msg = await ensurePinnedStateMessage(channel);
  const state = parseStateFromMessage(msg);

  if (state.openByUser[openerId]) delete state.openByUser[openerId];
  await saveStateToMessage(msg, state);
}

module.exports = {
  getNextNumberAndBump,
  markUserOpen,
  clearUserOpen,
};