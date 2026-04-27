const { SlashCommandBuilder } = require('discord.js');
const { cancelSessionCard, resolveCardId } = require('../../utils/trelloClient');
const { deleteSessionAnnouncement } = require('../../utils/sessionAutomation');
const {
  cleanupQueueForCard,
  logAttendeesForCard,
} = require('../../utils/sessionQueueManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('cancelsession')
    .setDescription('Cancel a Trello session card, clear notices, and choose whether to log it.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('card')
        .setDescription('Trello card URL or short ID')
        .setRequired(true),
    )
    .addBooleanOption((option) =>
      option
        .setName('log')
        .setDescription('Log the cancelled session attendees? Choose true or false.')
        .setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const cardInput = interaction.options.getString('card', true).trim();
    const shouldLog = interaction.options.getBoolean('log', true);
    const resolvedCardId = await resolveCardId(cardInput);
    const cardId = resolvedCardId || cardInput;

    const success = await cancelSessionCard({ cardId });

    if (!success) {
      await interaction.editReply(
        '⚠️ I tried to cancel that session on Trello, but something went wrong.\nPlease double-check the card link/ID and Trello configuration.',
      );
      return;
    }

    try {
      await deleteSessionAnnouncement(interaction.client, cardId);
      if (cardId !== cardInput) {
        await deleteSessionAnnouncement(interaction.client, cardInput);
      }
    } catch (err) {
      console.error('[CANCELSESSION] Could not clear session notice:', err);
    }

    let logLine = 'Cancelled session was not logged.';

    if (shouldLog) {
      try {
        const result = await logAttendeesForCard(interaction.client, cardInput, {
          recordAttendance: false,
          cancelled: true,
        });

        logLine = result?.ok
          ? 'Cancelled session attendees were logged, but not counted toward active quota.'
          : 'I could not create the cancelled-session log because I could not find the matching active queue.';
      } catch (err) {
        console.error('[CANCELSESSION] Error while logging cancelled session:', err);
        logLine = 'An error happened while creating the cancelled-session log.';
      }
    }

    try {
      await cleanupQueueForCard(interaction.client, cardInput);
    } catch (err) {
      console.error('[CANCELSESSION] Error while cleaning queue messages:', err);
      await interaction.editReply(
        `✅ Session successfully cancelled on Trello.\n✅ Session notice cleared.\n⚠️ ${logLine}\n⚠️ An error happened while removing the queue messages.`,
      );
      return;
    }

    await interaction.editReply(
      `✅ Session successfully cancelled on Trello.\n✅ Session notice cleared.\n✅ Queue messages cleaned up.\n${shouldLog ? '✅' : 'ℹ️'} ${logLine}`,
    );
  },
};
