// src/commands/sessions/editcard.js

'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const {
  getSessionCard,
  updateSessionCard,
  addCardComment,
  getSessionTypeFromCard,
} = require('../../utils/trelloClient');
const {
  parseSessionDateTime,
  parseTimeAndZone,
  getDateDisplayForZone,
  getEasternParts,
  supportedTimeZoneSummary,
} = require('../../utils/timezone');
const { deleteSessionAnnouncement } = require('../../utils/sessionAutomation');

function sanitizeHostName(input) {
  const cleaned = String(input || '')
    .replace(/[\p{Extended_Pictographic}]/gu, '')
    .replace(/[\uFE0F\u200D]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || null;
}

function sessionTypeBracket(sessionType) {
  if (sessionType === 'interview') return 'Interview';
  if (sessionType === 'training') return 'Training';
  if (sessionType === 'mass_shift') return 'Mass Shift';
  return 'Session';
}

function extractHost(cardName) {
  const name = String(cardName || '').trim();
  const match = name.match(/\s+-\s+(.+)$/);
  return match ? match[1].trim() : 'Host';
}

function extractTitlePrefix(cardName) {
  const name = String(cardName || '').trim();
  const match = name.match(/^(.+?)\s+-\s+.+$/);
  return match ? match[1].trim() : name;
}

function extractDisplayedTime(cardName) {
  const name = String(cardName || '').trim();
  const match = name.match(/^\[[^\]]+\]\s+(.+?)\s+-\s+.+$/);
  return match ? match[1].trim() : null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('editcard')
    .setDescription('Edit a Trello session card host, date, time, or add a comment.')
    .setDMPermission(false)
    .addStringOption((option) => option
      .setName('card')
      .setDescription('Trello card link or short ID')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('host')
      .setDescription('New host name'))
    .addStringOption((option) => option
      .setName('date')
      .setDescription('New date in the entered timezone: MM/DD/YYYY'))
    .addStringOption((option) => option
      .setName('time')
      .setDescription('New title time, such as 3:00 PM CET, 15:00 GMT, or 2 PM ET'))
    .addStringOption((option) => option
      .setName('comment')
      .setDescription('Optional Trello comment to add to the card')
      .setMaxLength(1000)),

  async execute(interaction) {
    if (!atLeastTier(interaction.member, 4)) {
      return interaction.reply({
        content: 'You must be at least **Management** to use `/editcard`.',
        ephemeral: true,
      });
    }

    const cardInput = interaction.options.getString('card', true).trim();
    const hostInput = interaction.options.getString('host');
    const dateInput = interaction.options.getString('date');
    const timeInput = interaction.options.getString('time');
    const commentInput = interaction.options.getString('comment');

    if (![hostInput, dateInput, timeInput, commentInput].some((value) => String(value || '').trim())) {
      return interaction.reply({
        content: 'Choose at least one field to change: **host, date, time, or comment**.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const loaded = await getSessionCard(cardInput);
    if (!loaded.ok || !loaded.card) {
      return interaction.editReply(
        '❌ I could not find that Trello card. Check the card link or short ID and try again.',
      );
    }

    const { cardId, card } = loaded;
    if (card.closed) {
      return interaction.editReply('❌ Archived Trello cards cannot be edited with this command.');
    }

    const currentDueMs = card.due ? new Date(card.due).getTime() : NaN;
    const hasCurrentDue = Number.isFinite(currentDueMs);
    let parsed = null;

    if (dateInput || timeInput) {
      if (!hasCurrentDue && (!dateInput || !timeInput)) {
        return interaction.editReply(
          'This card has no current due date. Enter **both** `date` and `time` to schedule it.',
        );
      }

      const currentEastern = hasCurrentDue ? getEasternParts(currentDueMs) : null;
      const displayedTime = extractDisplayedTime(card.name);
      const timeToUse = String(
        timeInput
        || displayedTime
        || `${currentEastern?.hour12}:${String(currentEastern?.minute ?? 0).padStart(2, '0')} ${currentEastern?.ampm} ET`,
      ).trim();

      let dateToUse = String(dateInput || '').trim();
      if (!dateToUse && hasCurrentDue) {
        const parsedTime = parseTimeAndZone(timeToUse);
        dateToUse = parsedTime
          ? getDateDisplayForZone(currentDueMs, parsedTime.zone)
          : currentEastern?.dateDisplay;
      }

      parsed = parseSessionDateTime(dateToUse, timeToUse);
      if (!parsed) {
        return interaction.editReply([
          '❌ I could not understand the new date, time, or timezone.',
          '',
          '**Examples:** `08/12/2026`, `3:00 PM CET`, `15:00 GMT`, `2 PM America/Chicago`',
          '',
          supportedTimeZoneSummary(),
        ].join('\n'));
      }
    }

    const newHost = sanitizeHostName(hostInput) || extractHost(card.name);
    const sessionType = getSessionTypeFromCard(card);
    let newName;

    if (parsed) {
      newName = `[${sessionTypeBracket(sessionType)}] ${parsed.source.timeDisplay} - ${newHost}`;
    } else if (hostInput) {
      newName = `${extractTitlePrefix(card.name)} - ${newHost}`;
    }

    const updateResult = await updateSessionCard({
      cardId,
      name: newName,
      dueISO: parsed ? new Date(parsed.utcMs).toISOString() : undefined,
    });

    if (!updateResult.ok) {
      return interaction.editReply(
        '❌ Trello rejected the card update. Check the bot’s Trello access and try again.',
      );
    }

    const commentResult = await addCardComment(cardId, commentInput);
    if (!commentResult.ok) {
      return interaction.editReply(
        '⚠️ The card fields were updated, but Trello could not add the optional comment.',
      );
    }

    if (newName || parsed) {
      await deleteSessionAnnouncement(interaction.client, cardId).catch((error) => {
        console.error('[EDITCARD] Could not clear an existing session announcement:', error);
      });
    }

    const link = card.shortUrl || card.url || cardInput;
    const lines = ['✅ **Trello session card updated.**', '', `Card: ${link}`];
    if (hostInput) lines.push(`Host: **${newHost}**`);
    if (parsed) {
      const unix = Math.floor(parsed.utcMs / 1000);
      lines.push(`Card title time: **${parsed.source.timeDisplay}**`);
      lines.push(`Trello due date (Eastern account): **${parsed.eastern.dateDisplay}**`);
      lines.push(`Trello due time (Eastern account): **${parsed.eastern.timeDisplay}**`);
      lines.push(`Discord time: <t:${unix}:F>`);
    }
    if (commentInput) lines.push('Comment: **Added to Trello**');
    return interaction.editReply(lines.join('\n'));
  },
};
