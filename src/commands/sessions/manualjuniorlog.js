// src/commands/sessions/manualjuniorlog.js

'use strict';

const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
} = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const { resolveJuniorLogChannel } = require('../../utils/juniorActivityTracker');
const { getSessionCard, getSessionTypeFromCard } = require('../../utils/trelloClient');

const CUSTOM_ID_PREFIX = 'manualjuniorlog:';
const MAX_ATTENDEES = 50;

function normalizeJuniorRole(value) {
  const raw = String(value || '').trim();
  const lower = raw.toLowerCase();
  if (lower.includes('front') && lower.includes('desk')) return 'Front Desk | Helper';
  if (lower.includes('custodian')) return 'Custodian | Helper';
  if (lower.includes('hotel') && lower.includes('cook')) return 'Hotel Cook | Helper';
  if (lower === 'cook' || lower.includes('cook')) return 'Hotel Cook | Helper';
  if (lower.includes('security')) return 'Security | Helper';
  return null;
}

function parseAttendeeLine(line, index) {
  const parts = String(line || '').split('|').map((part) => part.trim());
  if (parts.length < 2) {
    return { error: `Line ${index + 1}: use \`Username | Roblox ID | Role\`.` };
  }

  const username = parts[0].replace(/^@+/, '').trim();
  let robloxId = '';
  let roleInput = '';

  if (parts.length >= 3 && /^\d{3,20}$/.test(parts[1])) {
    robloxId = parts[1];
    roleInput = parts.slice(2).join(' | ');
  } else if (parts.length >= 3 && /^(?:n\/?a|none|unknown|not provided)$/i.test(parts[1])) {
    roleInput = parts.slice(2).join(' | ');
  } else {
    roleInput = parts.slice(1).join(' | ');
  }

  const cleanedId = /^\d{3,20}$/.test(robloxId) ? robloxId : null;
  if (!username) return { error: `Line ${index + 1}: Roblox username is missing.` };

  const role = normalizeJuniorRole(roleInput);
  if (!role) {
    return {
      error: `Line ${index + 1}: role must be Front Desk, Custodian, Hotel Cook, or Security.`,
    };
  }

  return {
    attendee: {
      username,
      robloxId: cleanedId,
      role,
    },
  };
}

function parseAttendees(value) {
  const lines = String(value || '')
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return { attendees: [], errors: ['No attendees were entered.'] };
  if (lines.length > MAX_ATTENDEES) {
    return { attendees: [], errors: [`A maximum of ${MAX_ATTENDEES} Junior Staff can be logged at once.`] };
  }

  const attendees = [];
  const errors = [];
  lines.forEach((line, index) => {
    const parsed = parseAttendeeLine(line, index);
    if (parsed.error) errors.push(parsed.error);
    else attendees.push(parsed.attendee);
  });

  return { attendees, errors };
}


function extractCardIdentifier(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  const urlMatch = raw.match(/trello\.com\/c\/([A-Za-z0-9]+)/i);
  if (urlMatch) return urlMatch[1];

  if (/^[A-Za-z0-9]{5,64}$/.test(raw)) return raw;
  return null;
}

function modalCustomId(cardId, minutes) {
  return `${CUSTOM_ID_PREFIX}${cardId}:${minutes}`;
}

function parseModalCustomId(customId) {
  const match = String(customId || '').match(/^manualjuniorlog:([A-Za-z0-9_-]{5,64}):(\d{1,4})$/);
  if (!match) return null;
  const cardId = match[1];
  const minutes = Number(match[2]);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) return null;
  return { cardId, minutes };
}

function parseCardTitle(cardName) {
  const name = String(cardName || '').trim();
  const match = name.match(/^\[([^\]]+)\]\s+(.+?)\s+-\s+(.+)$/);
  if (!match) {
    return {
      typeLabel: null,
      enteredTime: null,
      host: null,
    };
  }

  return {
    typeLabel: match[1].trim() || null,
    enteredTime: match[2].trim() || null,
    host: match[3].trim() || null,
  };
}

function sessionTypeLabel(card) {
  const title = parseCardTitle(card?.name);
  if (title.typeLabel) return title.typeLabel;

  const type = getSessionTypeFromCard(card || {});
  if (type === 'mass_shift') return 'Mass Shift';
  if (type === 'interview') return 'Interview';
  if (type === 'training') return 'Training';
  return 'Session';
}

async function handleModalSubmit(interaction) {
  if (!interaction?.isModalSubmit?.() || !String(interaction.customId || '').startsWith(CUSTOM_ID_PREFIX)) {
    return false;
  }

  if (!atLeastTier(interaction.member, 6)) {
    await interaction.reply({
      content: 'You must be **Corporate+** to manually recover Junior Staff session logs.',
      ephemeral: true,
    });
    return true;
  }

  const state = parseModalCustomId(interaction.customId);
  if (!state) {
    await interaction.reply({
      content: 'This manual-log form expired or could not be read. Run `/manualjuniorlog` again.',
      ephemeral: true,
    });
    return true;
  }

  const attendeeText = interaction.fields.getTextInputValue('attendees');
  const { attendees, errors } = parseAttendees(attendeeText);
  if (errors.length) {
    await interaction.reply({
      content: [
        '❌ I could not submit the Junior Staff logs yet:',
        '',
        ...errors.slice(0, 10).map((error) => `• ${error}`),
        '',
        'Use one person per line: `Username | Roblox ID | Role`',
        'The Roblox ID may be left out: `Username | Role`',
      ].join('\n'),
      ephemeral: true,
    });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });

  const cardResult = await getSessionCard(state.cardId).catch(() => null);
  if (!cardResult?.ok || !cardResult.card) {
    await interaction.editReply(
      '❌ I could not load that Trello session card anymore. Run `/manualjuniorlog` again with the card link.',
    );
    return true;
  }

  const card = cardResult.card;
  if (!card.due || Number.isNaN(new Date(card.due).getTime())) {
    await interaction.editReply(
      '❌ That Trello card does not have a valid session due date. Add the correct due date to the card first, then run `/manualjuniorlog` again.',
    );
    return true;
  }

  const channel = await resolveJuniorLogChannel(interaction.client, interaction.guild).catch(() => null);
  if (!channel?.isTextBased?.()) {
    await interaction.editReply(
      '❌ I could not find the existing Junior Staff log channel. Check `JUNIOR_ACTIVITY_LOG_CHANNEL_ID`, `ROBLOX_TRAINING_LOG_CHANNEL_ID`, or `TC_LOG_CHANNEL_ID`.',
    );
    return true;
  }

  const titleDetails = parseCardTitle(card.name);
  const sessionDate = new Date(card.due);
  const utcSeconds = Math.floor(sessionDate.getTime() / 1000);
  const cardUrl = card.shortUrl || card.url || `https://trello.com/c/${card.shortLink || state.cardId}`;
  const typeLabel = sessionTypeLabel(card);
  const sent = [];
  const failed = [];

  for (const attendee of attendees) {
    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle('Junior Staff Training Log')
      .setDescription('Manual recovery for a Junior Staff session that was not logged before shutdown.')
      .addFields(
        { name: 'Roblox Username', value: attendee.username, inline: true },
        { name: 'Roblox ID', value: attendee.robloxId || 'Not provided', inline: true },
        { name: 'Role', value: attendee.role, inline: true },
        { name: 'Minutes in TC', value: `${state.minutes} minutes`, inline: true },
        { name: 'Session Type', value: typeLabel, inline: true },
        { name: 'Host', value: titleDetails.host || 'Could not parse from card title', inline: true },
        { name: 'Session Timestamp', value: `<t:${utcSeconds}:F>`, inline: false },
        { name: 'Entered Session Time', value: titleDetails.enteredTime || 'See Trello card', inline: true },
        { name: 'Session Card', value: `[Open Trello card](${cardUrl})`, inline: true },
        { name: 'Recovered By', value: `<@${interaction.user.id}>`, inline: false },
      )
      .setFooter({ text: `Glace Hotels • Manual Junior Staff Log Recovery • Card ${card.shortLink || state.cardId}` })
      .setTimestamp(sessionDate);

    try {
      const message = await channel.send({ embeds: [embed] });
      sent.push({ attendee, message });
    } catch (error) {
      console.error('[MANUAL JUNIOR LOG] Failed to post attendee:', attendee.username, error);
      failed.push(attendee.username);
    }
  }

  const lines = [
    `✅ **${sent.length} Junior Staff log${sent.length === 1 ? '' : 's'} recovered.**`,
    '',
    `• Session card: ${cardUrl}`,
    `• Card title: ${card.name}`,
    `• Session time: <t:${utcSeconds}:F>`,
    `• Minutes logged: ${state.minutes}`,
    `• Junior Logs channel: <#${channel.id}>`,
    '• LI+ activity tracking was not changed.',
  ];
  if (failed.length) lines.push(`• Failed: ${failed.join(', ')}`);
  await interaction.editReply(lines.join('\n'));
  return true;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('manualjuniorlog')
    .setDescription('Recover missed Junior Staff logs from an existing Trello session card.')
    .setDMPermission(false)
    .addStringOption((option) => option
      .setName('session_card')
      .setDescription('The Trello session card link for the missed Junior Staff logs')
      .setRequired(true))
    .addIntegerOption((option) => option
      .setName('minutes')
      .setDescription('Minutes each listed Junior Staff member spent in the session')
      .setMinValue(1)
      .setMaxValue(1440)
      .setRequired(true)),

  async execute(interaction) {
    if (!atLeastTier(interaction.member, 6)) {
      return interaction.reply({
        content: 'You must be **Corporate+** to use `/manualjuniorlog`.',
        ephemeral: true,
      });
    }

    const cardInput = interaction.options.getString('session_card', true);
    const minutes = interaction.options.getInteger('minutes', true);
    const cardIdentifier = extractCardIdentifier(cardInput);

    if (!cardIdentifier) {
      return interaction.reply({
        content: [
          '❌ That does not look like a Trello session card link.',
          '',
          'Paste the full card link, such as:',
          '`https://trello.com/c/abc12345/session-name`',
        ].join('\n'),
        ephemeral: true,
      });
    }

    const modal = new ModalBuilder()
      .setCustomId(modalCustomId(cardIdentifier, minutes))
      .setTitle('Recover Junior Staff Logs');

    const attendees = new TextInputBuilder()
      .setCustomId('attendees')
      .setLabel('Junior Staff attendees')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(4000)
      .setPlaceholder([
        'One person per line:',
        'RobloxUsername | RobloxID | Front Desk',
        'AnotherUsername | 123456789 | Security',
        'ThirdUsername | Custodian',
      ].join('\n'));

    modal.addComponents(new ActionRowBuilder().addComponents(attendees));
    return interaction.showModal(modal);
  },

  handleModalSubmit,
  parseAttendees,
  parseCardTitle,
  extractCardIdentifier,
};
