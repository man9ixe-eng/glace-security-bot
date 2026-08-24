// src/commands/sessions/removesession.js

const { SlashCommandBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { trelloRequest } = require('../../utils/trelloClient');

function extractCardShortId(input) {
  if (!input) return null;
  const str = String(input).trim();

  const urlMatch = str.match(/trello\.com\/c\/([a-zA-Z0-9]+)/);
  if (urlMatch) return urlMatch[1];

  const idMatch = str.match(/^([a-zA-Z0-9]{6,10})$/);
  if (idMatch) return idMatch[1];

  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removesession')
    .setDescription('Archive a Trello session card (only if it is more than 1 hour away).')
    .setDMPermission(false)
    .addStringOption(option =>
      option
        .setName('card')
        .setDescription('Trello card link or short ID (https://trello.com/c/xxxx)')
        .setRequired(true),
    ),

  /**
   * /removesession \u2013 Tier 6+ (Corporate and up)
   */
  async execute(interaction) {
    if (!atLeastTier(interaction.member, 6)) {
      return interaction.reply({
        content: 'You must be at least **Tier 6 (Corporate)** to use `/removesession`.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const cardInput = interaction.options.getString('card', true);
    const cardId = extractCardShortId(cardInput);

    if (!cardId) {
      return interaction.editReply(
        '\u26A0\uFE0F I could not parse that Trello card link/ID. Please provide a valid Trello card URL or short ID.',
      );
    }

    // 1) Load card due date first
    const cardRes = await trelloRequest(`/cards/${cardId}`, 'GET', {
      fields: 'name,due,shortUrl,url',
    });

    if (!cardRes.ok || !cardRes.data) {
      return interaction.editReply(
        '\u26A0\uFE0F I could not fetch that Trello card. Check the link/ID and my Trello access.',
      );
    }

    const card = cardRes.data;
    const due = card.due ? new Date(card.due) : null;

    // 2) Block if due is within 1 hour (future)
    if (due && !Number.isNaN(due.getTime())) {
      const diffMs = due.getTime() - Date.now();
      const oneHourMs = 60 * 60 * 1000;

      if (diffMs > 0 && diffMs <= oneHourMs) {
        return interaction.editReply(
          '\u26D4 You cannot use `/removesession` within **1 hour** of the session due time.\n' +
            'Please use `/cancelsession` instead.',
        );
      }
    }

    // 3) Archive the card (no attendee log)
    const archiveRes = await trelloRequest(`/cards/${cardId}`, 'PUT', {
      closed: 'true',
    });

    if (!archiveRes.ok) {
      return interaction.editReply(
        '\u26A0\uFE0F I tried to archive that session card, but something went wrong. Please verify my Trello configuration.',
      );
    }

    const link = card.shortUrl || card.url || cardInput;

    return interaction.editReply(
      `\u2705 Archived the session card.\nCard: ${link}`,
    );
  },
};
