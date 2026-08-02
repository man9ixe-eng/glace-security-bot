// src/commands/sessions/addsession.js

'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { createSessionCard } = require('../../utils/trelloClient');
const { parseSessionDateTime, supportedTimeZoneSummary } = require('../../utils/timezone');

function sanitizeHostName(input) {
  const cleaned = String(input || '')
    .replace(/[\p{Extended_Pictographic}]/gu, '')
    .replace(/[\uFE0F\u200D]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'Host';
}

function sessionTypeDisplay(sessionType) {
  if (sessionType === 'interview') return 'INTERVIEW';
  if (sessionType === 'training') return 'TRAINING';
  return 'MASS SHIFT';
}

function sessionTypeBracket(sessionType) {
  if (sessionType === 'interview') return 'Interview';
  if (sessionType === 'training') return 'Training';
  return 'Mass Shift';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addsession')
    .setDescription('Create a Trello session card while keeping the entered timezone in its title.')
    .setDMPermission(false)
    .addStringOption((option) => option
      .setName('type')
      .setDescription('Session type.')
      .setRequired(true)
      .addChoices(
        { name: 'Interview', value: 'interview' },
        { name: 'Training', value: 'training' },
        { name: 'Mass Shift', value: 'mass_shift' },
      ))
    .addStringOption((option) => option
      .setName('date')
      .setDescription('Date in the timezone entered: MM/DD/YYYY')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('time')
      .setDescription('Examples: 3:00 PM CET, 15:00 GMT, 2 PM America/Chicago')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('host')
      .setDescription('Host name; emojis are removed.')
      .setRequired(true)),

  async execute(interaction) {
    if (!atLeastTier(interaction.member, 4)) {
      return interaction.reply({
        content: 'You must be at least **Management** to use `/addsession`.',
        ephemeral: true,
      });
    }

    const sessionType = interaction.options.getString('type', true);
    const dateInput = interaction.options.getString('date', true);
    const timeInput = interaction.options.getString('time', true);
    const hostName = sanitizeHostName(interaction.options.getString('host', true));
    const parsed = parseSessionDateTime(dateInput, timeInput);

    if (!parsed) {
      return interaction.reply({
        content: [
          '❌ I could not understand that date, time, or timezone.',
          '',
          '**Examples**',
          '• `08/12/2026` and `3:00 PM CET`',
          '• `08/12/2026` and `15:00 GMT`',
          '• `08/12/2026` and `2 PM America/Chicago`',
          '',
          supportedTimeZoneSummary(),
        ].join('\n'),
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    try {
      const eastern = parsed.eastern;
      const cardName = `[${sessionTypeBracket(sessionType)}] ${parsed.source.timeDisplay} - ${hostName}`;
      const cardDesc = '** PLEASE JOIN 5-10 MINUTES BEFORE START **';
      const result = await createSessionCard({
        sessionType,
        dueISO: new Date(parsed.utcMs).toISOString(),
        cardName,
        cardDesc,
      });

      if (!result?.ok) {
        return interaction.editReply(
          'I tried to create the Trello card, but something went wrong. Check the Trello configuration and try again.',
        );
      }

      const unixSeconds = Math.floor(parsed.utcMs / 1000);
      return interaction.editReply({
        content: [
          `✅ **${sessionTypeDisplay(sessionType)} ADDED**`,
          '',
          `• Host: ${hostName}`,
          `• Card title time: ${parsed.source.timeDisplay}`,
          `• Trello due date (Eastern account): ${eastern.dateDisplay}`,
          `• Trello due time (Eastern account): ${eastern.timeDisplay}`,
          `• Discord time: <t:${unixSeconds}:F>`,
          '',
          `Card Link: ${result.url || '(no link returned)'}`,
        ].join('\n'),
      });
    } catch (error) {
      console.error('[ADDSESSION] Unexpected error:', error);
      return interaction.editReply('Unexpected error while running `/addsession`. Please try again.');
    }
  },
};
