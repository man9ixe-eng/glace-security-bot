// src/utils/sessionAutomation.js
// /sessionqueue is the only session-notice system. This module only clears legacy notices.

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
  // Session queue notices are managed only through /sessionqueue.
  // Keeping this function as a no-op preserves compatibility with the existing
  // scheduler without posting a second 30-minute reminder.
  return { ok: true, disabled: true, reason: 'managed_by_sessionqueue' };
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
