// src/commands/sessions/sessionqueue.js

const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { createQueueForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessionqueue')
    .setDescription('Open a Glace session queue for a Trello session card.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('card')
        .setDescription('Trello card link or short ID (e.g. https://trello.com/c/abcd1234)')
        .setRequired(true),
    ),

  /**
   * /sessionqueue – Tier 4+ (Management and up) opens a joinable queue
   * for the provided Trello session card.
   */
  async execute(interaction) {
    if (!atLeastTier(interaction.member, 4)) {
      await interaction.reply({
        content: 'You must be at least **Tier 4 (Management)** to use `/sessionqueue`.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const cardOption = interaction.options.getString('card', true);

      await createQueueForCard(
        interaction.client,
        interaction.channel,
        interaction.member,
        cardOption,
      );

      await interaction.editReply({
        content: '✅ Session queue opened successfully.',
      });
    } catch (error) {
      console.error('[SESSIONQUEUE] Error while opening queue:', error);

      await interaction.editReply({
        content:
          '⚠️ I could not open that session queue. Please check the Trello card link/ID and make sure the bot can send messages in this channel.',
      });
    }
  },
};