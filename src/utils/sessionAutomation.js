// src/utils/sessionAutomation.js
// Creates 30-minute session notices and clears them when /logsession or /cancelsession runs.

const { listSessionCards } = require('./trelloClient');
const { SESSION_CONFIG } = require('../config/sessionAnnouncements');
const {
  setSessionPost,
  getSessionPost,
  clearSessionPost,
} = require('./sessionPostsStore');

const GAME_LINKS = {
  interview:
    process.env.GAME_LINK_INTERVIEW ||
    'https://www.roblox.com/games/71896062227595/GH-Interview-Center',
  training:
    process.env.GAME_LINK_TRAINING ||
    'https://www.roblox.com/games/88554128028552/GH-Training-Center',
  mass_shift:
    process.env.GAME_LINK_MASS_SHIFT ||
    'https://www.roblox.com/games/127619749760478/Glace-Hotels-BETA-V1',
};

function normalizeSessionType(type) {
  if (type === 'massshift') return 'mass_shift';
  return type || 'session';
}

function typeName(type) {
  if (type === 'interview') return 'Interview';
  if (type === 'training') return 'Training';
  if (type === 'mass_shift') return 'Mass Shift';
  return 'Session';
}

function getNoticeConfig(type) {
  const normalized = normalizeSessionType(type);
  return SESSION_CONFIG?.[normalized] || null;
}

async function runSessionAutomation(client) {
  if (!client) return;

  let cards = [];
  try {
    cards = await listSessionCards();
  } catch (err) {
    console.error('[SESSIONS] Failed to load cards for notices:', err);
    return;
  }

  const now = Date.now();

  for (const card of cards) {
    const sessionType = normalizeSessionType(card.sessionType);
    const config = getNoticeConfig(sessionType);
    if (!config?.channelId) continue;
    if (!card?.id || !card?.due || card.dueComplete) continue;
    if (String(card.listName || '').toLowerCase().includes('completed')) continue;

    const dueMs = new Date(card.due).getTime();
    if (!Number.isFinite(dueMs)) continue;

    const diffMs = dueMs - now;
    if (diffMs <= 0 || diffMs > 30 * 60 * 1000) continue;

    if (getSessionPost(card.id)) continue;

    try {
      const channel = await client.channels.fetch(config.channelId).catch(() => null);
      if (!channel || !channel.isTextBased?.()) continue;

      const unix = Math.floor(dueMs / 1000);
      const trelloUrl = card.shortUrl || card.url || `https://trello.com/c/${card.id}`;
      const ping = config.pingRoleId ? `<@&${config.pingRoleId}>` : '';
      const gameLink = GAME_LINKS[sessionType] || '';

      const content = [
        ping,
        `A **${typeName(sessionType)}** session is starting in **30 minutes**!`,
        '',
        `**Name:** ${card.name || typeName(sessionType)}`,
        `**Starts at:** <t:${unix}:T> (<t:${unix}:R>)`,
        gameLink ? `**Game link:** ${gameLink}` : null,
        `**Trello card:** ${trelloUrl}`,
      ]
        .filter((line) => line !== null && line !== undefined)
        .join('\n');

      const msg = await channel.send({
        content,
        allowedMentions: {
          roles: config.pingRoleId ? [config.pingRoleId] : [],
        },
      });

      setSessionPost(card.id, channel.id, msg.id);
      console.log('[SESSIONS] Created session notice for card', card.id);
    } catch (err) {
      console.error('[SESSIONS] Failed to send session notice:', err);
    }
  }
}

/**
 * Delete the Discord notice for a given Trello card (if one exists).
 * Called by /cancelsession and /logsession.
 */
async function deleteSessionAnnouncement(client, cardId) {
  if (!client || !cardId) return;

  const record = getSessionPost(cardId);
  if (!record) return;

  try {
    const channel = await client.channels.fetch(record.channelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) {
      clearSessionPost(cardId);
      return;
    }

    const msg = await channel.messages.fetch(record.messageId).catch(() => null);
    if (msg) {
      await msg.delete().catch(() => {});
      console.log('[SESSIONS] Deleted session notice for card', cardId);
    }
  } catch (err) {
    console.error('[SESSIONS] Failed to delete session notice:', err);
  }

  clearSessionPost(cardId);
}

module.exports = {
  runSessionAutomation,
  deleteSessionAnnouncement,
};
