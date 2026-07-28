// src/utils/modlog.js
// Glace moderation audit logging
// - Regular moderation logs go to #audit-log
// - Serious moderation logs go to #corp-audit-log
// - Audit embeds never expose the channel/category where the action happened

const { EmbedBuilder } = require('discord.js');

const FALLBACK_REGULAR_AUDIT_LOG_CHANNEL_ID = '1408044840398098472';

const REGULAR_AUDIT_CHANNEL_NAMES = [
  'audit-log',
  'mod-log',
  'moderation-log',
];

const CORP_AUDIT_CHANNEL_NAMES = [
  'corp-audit-log',
  'corporate-audit-log',
  'corp-mod-log',
];

const SERIOUS_ACTION_KEYWORDS = [
  'ban',
  'pban',
  'permanent ban',
  'kick',
  'timeout',
  'clear warning',
  'clear all warnings',
];

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function getGuildFromSource(source) {
  if (!source) return null;
  if (source.guild) return source.guild;
  if (source.channels?.cache) return source;
  return null;
}

function getClientFromSource(source, guild) {
  return source?.client || guild?.client || null;
}

function getRegularAuditChannelIds() {
  return [
    process.env.OPERATIONS_LOG_CHANNEL_ID,
    process.env.REGULAR_AUDIT_LOG_CHANNEL_ID,
    process.env.AUDIT_LOG_CHANNEL_ID,
    process.env.MOD_LOG_CHANNEL_ID,
    FALLBACK_REGULAR_AUDIT_LOG_CHANNEL_ID,
  ].filter(Boolean);
}

function getCorpAuditChannelIds() {
  return [
    process.env.OPERATIONS_LOG_CHANNEL_ID,
    process.env.CORP_AUDIT_LOG_CHANNEL_ID,
    process.env.CORPORATE_AUDIT_LOG_CHANNEL_ID,
    process.env.CORP_MOD_LOG_CHANNEL_ID,
  ].filter(Boolean);
}

function shouldUseCorpAudit(payload = {}) {
  if (payload.auditLog === 'corp' || payload.logType === 'corp' || payload.corporate === true) return true;
  if (payload.auditLog === 'regular' || payload.logType === 'regular' || payload.corporate === false) return false;

  const action = normalize(payload.action);
  return SERIOUS_ACTION_KEYWORDS.some((keyword) => action.includes(keyword));
}

async function findChannelByIds(client, ids) {
  for (const id of ids) {
    const channel = await client?.channels?.fetch(id).catch(() => null);
    if (channel?.isTextBased?.()) return channel;
  }
  return null;
}

function findChannelByNames(guild, names) {
  const wanted = new Set(names.map(normalize));
  return guild?.channels?.cache?.find((channel) => (
    channel?.isTextBased?.() && wanted.has(normalize(channel.name))
  )) || null;
}

async function resolveAuditChannel(source, payload = {}) {
  const guild = getGuildFromSource(source);
  if (!guild) return null;

  const client = getClientFromSource(source, guild);
  const useCorpAudit = shouldUseCorpAudit(payload);

  const primaryIds = useCorpAudit ? getCorpAuditChannelIds() : getRegularAuditChannelIds();
  const primaryNames = useCorpAudit ? CORP_AUDIT_CHANNEL_NAMES : REGULAR_AUDIT_CHANNEL_NAMES;

  let channel = await findChannelByIds(client, primaryIds);
  if (!channel) channel = findChannelByNames(guild, primaryNames);

  // If the corporate audit channel is not configured/found, keep the log from disappearing.
  // Never fall back to the command channel, because that can leak private channel locations.
  if (!channel && useCorpAudit) {
    channel = await findChannelByIds(client, getRegularAuditChannelIds());
    if (!channel) channel = findChannelByNames(guild, REGULAR_AUDIT_CHANNEL_NAMES);
  }

  return channel || null;
}

function sanitizeLogValue(value) {
  return String(value ?? 'Unknown')
    // Hide channel mentions like <#123456789>
    .replace(/<#\d+>/g, '[channel hidden]')
    // Hide normal-looking channel names like #audit-log without touching warning #1.
    .replace(/#[A-Za-z][A-Za-z0-9_-]*/g, '[channel hidden]')
    // Remove common source-channel wording if a caller accidentally passes it.
    .replace(/\b(in|inside|from)\s+\[channel hidden\]/gi, '[channel hidden]')
    .replace(/\bchannel\s*:\s*\[channel hidden\]/gi, 'Channel hidden')
    .trim()
    .slice(0, 1024) || 'Unknown';
}

function formatUser(user, fallbackId) {
  if (!user && fallbackId) return `Unknown (${fallbackId})`;
  if (!user) return 'Unknown';

  const tag = user.tag || user.username || user.displayName || 'Unknown';
  const id = user.id || fallbackId || 'Unknown';
  return `${tag} (${id})`;
}

function getModerator(source, payload = {}) {
  const user = source?.user || payload.moderator || null;
  if (user) return formatUser(user, payload.moderatorId);

  if (payload.moderatorTag || payload.moderatorId) {
    return `${payload.moderatorTag || 'Unknown'} (${payload.moderatorId || 'Unknown'})`;
  }

  return 'Unknown';
}

function getTarget(payload = {}) {
  if (payload.targetUser) return formatUser(payload.targetUser, payload.targetId);
  if (payload.targetTag || payload.targetId) return `${payload.targetTag || 'Unknown'} (${payload.targetId || 'Unknown'})`;
  return null;
}

/**
 * logModerationAction(interactionOrGuild, payload)
 *
 * Expected payload:
 * {
 *   action: string,
 *   targetUser?: User,
 *   reason?: string,
 *   details?: string,
 *   auditLog?: 'regular' | 'corp' // optional override
 * }
 */
async function logModerationAction(source, payload = {}) {
  try {
    const guild = getGuildFromSource(source);
    if (!guild) return false;

    const channel = await resolveAuditChannel(source, payload);
    if (!channel) {
      console.warn('[MODLOG] No audit log channel found. Create #audit-log or set REGULAR_AUDIT_LOG_CHANNEL_ID.');
      return false;
    }

    const useCorpAudit = shouldUseCorpAudit(payload);
    const embed = new EmbedBuilder()
      .setTitle(useCorpAudit ? 'Corporate Moderation Audit' : 'Moderation Audit')
      .setColor(useCorpAudit ? 0x1f4e79 : 0x6cb2eb)
      .addFields(
        { name: 'Action', value: sanitizeLogValue(payload.action || 'Unknown'), inline: true },
        { name: 'Moderator', value: sanitizeLogValue(getModerator(source, payload)), inline: true },
      )
      .setTimestamp(new Date());

    const target = getTarget(payload);
    if (target) {
      embed.addFields({ name: 'Target', value: sanitizeLogValue(target), inline: false });
    }

    if (payload.reason) {
      embed.addFields({ name: 'Reason', value: sanitizeLogValue(payload.reason), inline: false });
    }

    if (payload.details) {
      embed.addFields({ name: 'Details', value: sanitizeLogValue(payload.details), inline: false });
    }

    await channel.send({ embeds: [embed] });
    return true;
  } catch (err) {
    console.error('[MODLOG] Failed to log moderation action:', err);
    return false;
  }
}

module.exports = {
  logModerationAction,
  shouldUseCorpAudit,
  sanitizeLogValue,
};
