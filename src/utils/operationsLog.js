'use strict';

const { EmbedBuilder } = require('discord.js');

function candidateChannelIds() {
  return [
    process.env.OPERATIONS_LOG_CHANNEL_ID,
    process.env.CORPORATE_AUDIT_LOG_CHANNEL_ID,
    process.env.CORP_AUDIT_LOG_CHANNEL_ID,
    process.env.AUDIT_LOG_CHANNEL_ID,
    process.env.REGULAR_AUDIT_LOG_CHANNEL_ID,
  ].filter(Boolean);
}

async function resolveOperationsLogChannel(client, guild) {
  for (const id of candidateChannelIds()) {
    const channel = await client?.channels?.fetch(id).catch(() => null);
    if (channel?.isTextBased?.()) return channel;
  }

  return guild?.channels?.cache?.find((channel) => {
    const name = String(channel?.name || '').toLowerCase();
    return channel?.isTextBased?.() && ['operations-log', 'staff-operations-log', 'audit-log'].includes(name);
  }) || null;
}

function safe(value, max = 1024) {
  return String(value ?? 'Unknown').trim().slice(0, max) || 'Unknown';
}

async function sendOperationsLog(client, guild, payload = {}) {
  try {
    const channel = await resolveOperationsLogChannel(client, guild);
    if (!channel) return false;

    const embed = new EmbedBuilder()
      .setTitle(safe(payload.title || 'Staff Operations Update', 256))
      .setColor(Number(payload.color) || 0x7c3aed)
      .setTimestamp(new Date());

    if (payload.description) embed.setDescription(safe(payload.description, 4096));

    const fields = Array.isArray(payload.fields) ? payload.fields.slice(0, 25) : [];
    if (fields.length) {
      embed.addFields(fields.map((field) => ({
        name: safe(field.name, 256),
        value: safe(field.value, 1024),
        inline: Boolean(field.inline),
      })));
    }

    await channel.send({ embeds: [embed] });
    return true;
  } catch (err) {
    console.error('[OPS LOG] Failed to send operations log:', err);
    return false;
  }
}

module.exports = {
  resolveOperationsLogChannel,
  sendOperationsLog,
};
