// src/commands/moderation/unban.js

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { logModerationAction } = require('../../utils/modlog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user from the server by Discord ID.')
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('discord_id')
        .setDescription('The Discord ID of the user to unban.')
        .setRequired(true),
    )
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason for the unban.')
        .setRequired(false),
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   */
  async execute(interaction) {
    // Tier 5+ (Senior Management and up), matching /ban.
    if (!atLeastTier(interaction.member, 5)) {
      return interaction.reply({
        content: 'You must be at least **Tier 5 (Senior Management)** to use `/unban`.',
        ephemeral: true,
      });
    }

    const discordId = interaction.options.getString('discord_id', true).trim();
    const reason = interaction.options.getString('reason') || 'No reason provided';

    if (!/^\d{17,20}$/.test(discordId)) {
      return interaction.reply({
        content: 'Please enter a valid Discord ID. It should only be numbers.',
        ephemeral: true,
      });
    }

    const banInfo = await interaction.guild.bans.fetch(discordId).catch(() => null);

    if (!banInfo) {
      return interaction.reply({
        content: `I could not find a banned user with the Discord ID \`${discordId}\`.`,
        ephemeral: true,
      });
    }

    try {
      await interaction.guild.members.unban(discordId, reason);

      const targetUser = banInfo.user || null;
      const targetLabel = targetUser?.tag
        ? `**${targetUser.tag}** (\`${discordId}\`)`
        : `Discord ID \`${discordId}\``;

      await interaction.reply({
        content: `Unbanned ${targetLabel}.\nReason: ${reason}`,
      });

      await logModerationAction(interaction, {
        action: 'Unban',
        targetUser,
        targetId: discordId,
        targetTag: targetUser?.tag || `Discord ID ${discordId}`,
        reason,
        auditLog: 'corp',
      });
    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: 'I could not unban that user. Check my permissions and make sure I have Ban Members permission.',
        ephemeral: true,
      });
    }
  },
};
