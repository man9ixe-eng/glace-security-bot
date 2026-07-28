'use strict';

// One combined, website-friendly audit trail for command activity.

const { EmbedBuilder } = require('discord.js');
const { getTier, getTierLabel } = require('./permissions');
const { resolveDataPath, readJsonFile, atomicWriteJson } = require('./dataPaths');

const STORE_PATH = resolveDataPath('operationsAudit.json', process.env.OPERATIONS_AUDIT_PATH);
const MAX_ENTRIES = Math.max(100, Number(process.env.OPERATIONS_AUDIT_MAX || 5000));
const EMPTY = { schemaVersion: 1, entries: [] };

// Successful read-only commands remain available on the website audit without flooding Discord.
const DISCORD_LOG_COMMANDS = new Set([
  'warn', 'clearwarn', 'clearwarnall', 'kick', 'timeout', 'ban', 'unban',
  'lock', 'unlock', 'slowmode', 'clear', 'sendappeal',
  'addsession', 'cancelsession', 'logsession', 'editactivity', 'removesession',
  'activitysettings', 'addloa', 'extendloa', 'removeloa', 'promotion',
  'announce-promotion', 'enroll', 'changeuser', 'resignation', 'unenroll',
  'add-demotion', 'ticketpanel', 'forceclose', 'adduser', 'opspanel',
]);

function readStore() {
  const parsed = readJsonFile(STORE_PATH, EMPTY);
  return {
    schemaVersion: 1,
    entries: Array.isArray(parsed?.entries) ? parsed.entries : [],
  };
}

function sanitizeOption(value) {
  if (value === null || typeof value === 'undefined') return null;
  if (typeof value === 'string') return value.slice(0, 500);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value?.id) return { id: String(value.id), tag: value.tag || value.username || null };
  return String(value).slice(0, 500);
}

function flattenInteractionOptions(interaction) {
  const output = {};
  const walk = (items = []) => {
    for (const item of items) {
      if (Array.isArray(item.options) && item.options.length) walk(item.options);
      else output[item.name] = sanitizeOption(item.user || item.member?.user || item.value);
    }
  };
  walk(interaction.options?.data || []);
  return output;
}

function appendAudit(entry) {
  const store = readStore();
  const full = {
    id: entry.id || `AUD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    timestamp: entry.timestamp || new Date().toISOString(),
    ...entry,
  };
  store.entries.push(full);
  if (store.entries.length > MAX_ENTRIES) {
    store.entries = store.entries.slice(store.entries.length - MAX_ENTRIES);
  }
  atomicWriteJson(STORE_PATH, store);
  return full;
}

function listAudit({ limit = 100, guildId = null } = {}) {
  let entries = readStore().entries;
  if (guildId) entries = entries.filter((entry) => String(entry.guildId) === String(guildId));
  return entries.slice(-Math.max(1, Math.min(Number(limit) || 100, 1000))).reverse();
}

async function sendAuditToDiscord(client, entry) {
  const channelId = process.env.OPERATIONS_LOG_CHANNEL_ID;
  if (!channelId || !client) return false;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;

  const optionsText = Object.entries(entry.options || {})
    .map(([key, value]) => `**${key}:** ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
    .join('\n')
    .slice(0, 1000) || 'None';

  const embed = new EmbedBuilder()
    .setColor(entry.status === 'failed' || entry.status === 'denied' ? 0xef4444 : 0x8b5cf6)
    .setTitle(`Operations Audit • /${entry.command || 'unknown'}`)
    .addFields(
      { name: 'Actor', value: entry.actorId ? `<@${entry.actorId}>\n${entry.actorTag || 'Unknown'}` : (entry.actorTag || 'Unknown'), inline: true },
      { name: 'Access', value: `Tier ${entry.actorTier} • ${entry.actorTierLabel}`, inline: true },
      { name: 'Status', value: String(entry.status || 'executed'), inline: true },
      { name: 'Options', value: optionsText, inline: false },
    )
    .setFooter({ text: entry.id })
    .setTimestamp(new Date(entry.timestamp));

  if (entry.error) embed.addFields({ name: 'Error', value: String(entry.error).slice(0, 1000), inline: false });
  await channel.send({ embeds: [embed] }).catch((error) => {
    console.error('[OPERATIONS AUDIT] Discord log failed:', error);
  });
  return true;
}

async function auditCommand(interaction, status, extra = {}) {
  const actorTier = getTier(interaction.member);
  const entry = appendAudit({
    type: 'command',
    guildId: interaction.guildId || null,
    channelId: interaction.channelId || null,
    command: interaction.commandName,
    actorId: interaction.user?.id || null,
    actorTag: interaction.user?.tag || interaction.user?.username || null,
    actorTier,
    actorTierLabel: getTierLabel(actorTier),
    status,
    options: flattenInteractionOptions(interaction),
    ...extra,
  });

  if (status !== 'executed' || DISCORD_LOG_COMMANDS.has(String(interaction.commandName || '').toLowerCase())) {
    await sendAuditToDiscord(interaction.client, entry);
  }
  return entry;
}

module.exports = {
  STORE_PATH,
  appendAudit,
  listAudit,
  auditCommand,
  sendAuditToDiscord,
};
