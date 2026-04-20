const { SlashCommandBuilder } = require('discord.js');
const { cancelSessionCard } = require('../../utils/trelloClient');
const { cleanupQueueForCard } = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancelsession')
    .setDescription('Cancel a Trello session card and remove queue messages.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('card')
        .setDescription('Trello card URL or short ID')
        .setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const cardInput = interaction.options.getString('card', true).trim();

    let cardId = cardInput;
    if (cardInput.includes('trello.com')) {
      const match = cardInput.match(/\/c\/([A-Za-z0-9]+)/);
      if (match) cardId = match[1];
    }

    const success = await cancelSessionCard({ cardId });

    if (!success) {
      await interaction.editReply(
        '⚠️ I tried to cancel that session on Trello, but something went wrong.\nPlease double-check the card link/ID and Trello configuration.',
      );
      return;
    }

    try {
      await cleanupQueueForCard(interaction.client, cardInput);
    } catch (err) {
      console.error('[CANCELSESSION] Error while cleaning queue messages:', err);
      await interaction.editReply(
        '⚠️ The Trello card was cancelled, but an error happened while removing the queue messages.',
      );
      return;
    }

    await interaction.editReply(
      '✅ Session successfully cancelled on Trello.\n✅ Queue messages cleaned up.',
    );
  },
};
