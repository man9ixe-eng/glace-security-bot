// src/utils/modlog.js

const { EmbedBuilder } = require('discord.js');

// Hard fallback if env var is missing:
const FALLBACK_MOD_LOG_CHANNEL_ID = '1408044840398098472';

function getModLogChannelId() {
  return process.env.MOD_LOG_CHANNEL_ID || FALLBACK_MOD_LOG_CHANNEL_ID;
}

/**
 * logModerationAction(interaction, { action, targetUser, reason, details })
 * - Sends moderation logs to the configured MOD log channel
 * - If channel not found, falls back to posting in the channel the command was used in
 */
async function logModerationAction(interaction, payload = {}) {
  try {
    const { action, targetUser, reason, details } = payload;

    const guild = interaction.guild;
    if (!guild) return false;

    const modLogChannelId = getModLogChannelId();

    const channel =
      (modLogChannelId
        ? await interaction.client.channels.fetch(modLogChannelId).catch(() => null)
        : null) || interaction.channel;

    const embed = new EmbedBuilder()
      .setTitle('Moderation Log')
      .setColor(0x6cb2eb)
      .addFields(
        { name: 'Action', value: action || 'Unknown', inline: true },
        { name: 'Moderator', value: `${interaction.user.tag} (${interaction.user.id})`, inline: true },
      )
      .setTimestamp(new Date());

    if (targetUser) {
      embed.addFields({
        name: 'Target',
        value: `${targetUser.tag || targetUser.username || 'Unknown'} (${targetUser.id || 'Unknown'})`,
        inline: false,
      });
    }

    if (reason) {
      embed.addFields({ name: 'Reason', value: String(reason).slice(0, 1024), inline: false });
    }

    if (details) {
      embed.addFields({ name: 'Details', value: String(details).slice(0, 1024), inline: false });
    }

    await channel.send({ embeds: [embed] });
    return true;
  } catch (err) {
    console.error('[MODLOG] Failed to log moderation action:', err);
    return false;
  }
}

module.exports = { logModerationAction };
