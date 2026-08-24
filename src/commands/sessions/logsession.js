// src/commands/sessions/logsession.js

const { SlashCommandBuilder } = require('discord.js');
const { completeSessionCard, resolveCardId } = require('../../utils/trelloClient');
const { deleteSessionAnnouncement } = require('../../utils/sessionAutomation');
const {
  logAttendeesForCard,
  cleanupQueueForCard,
} = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logsession')
    .setDescription('Mark a Trello session card as completed and log attendees.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('card')
        .setDescription('Trello card URL or ID')
        .setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const cardInput = interaction.options.getString('card', true).trim();
    const resolvedCardId = await resolveCardId(cardInput);
    const cardId = resolvedCardId || cardInput;

    const success = await completeSessionCard({ cardId });

    if (!success) {
      await interaction.editReply(
        '\u26A0\uFE0F I tried to log that session on Trello, but something went wrong.\nPlease double-check the card link/ID and my Trello configuration.',
      );
      return;
    }

    try {
      await deleteSessionAnnouncement(interaction.client, cardId);
      if (cardId !== cardInput) {
        await deleteSessionAnnouncement(interaction.client, cardInput);
      }
    } catch (err) {
      console.error('[LOGSESSION] Could not clear session notice:', err);
    }

    try {
      const result = await logAttendeesForCard(interaction.client, cardInput, {
        recordAttendance: true,
        cancelled: false,
        cardUrl: cardInput,
      });

      if (!result?.ok) {
        await interaction.editReply(
          '\u26A0\uFE0F The Trello card was completed and the session notice was cleared, but I could not create the session log/activity entry. Please make sure the queue exists and the session log channel is configured correctly.',
        );
        return;
      }

      await cleanupQueueForCard(interaction.client, cardInput);
    } catch (err) {
      console.error('[LOGSESSION] Error while logging/cleaning queue:', err);
      await interaction.editReply(
        '\u26A0\uFE0F The Trello card was completed, but an error happened while creating the session log/activity entry.',
      );
      return;
    }

    await interaction.editReply(
      '\u2705 Session successfully marked as completed on Trello.\n\u2705 Session notice cleared.\n\u2705 Attendees logged and queue messages cleaned up.',
    );
  },
};
