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
const { parseSessionDateTime, supportedTimeZoneSummary } = require('../../utils/timezone');
const { resolveJuniorLogChannel } = require('../../utils/juniorActivityTracker');

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

function modalCustomId(utcSeconds, minutes) {
  return `${CUSTOM_ID_PREFIX}${utcSeconds}:${minutes}`;
}

function parseModalCustomId(customId) {
  const match = String(customId || '').match(/^manualjuniorlog:(\d{9,12}):(\d{1,4})$/);
  if (!match) return null;
  const utcSeconds = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(utcSeconds) || !Number.isFinite(minutes) || minutes < 1 || minutes > 1440) return null;
  return { utcSeconds, minutes };
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

  const channel = await resolveJuniorLogChannel(interaction.client, interaction.guild).catch(() => null);
  if (!channel?.isTextBased?.()) {
    await interaction.editReply(
      '❌ I could not find the existing Junior Staff log channel. Check `JUNIOR_ACTIVITY_LOG_CHANNEL_ID`, `ROBLOX_TRAINING_LOG_CHANNEL_ID`, or `TC_LOG_CHANNEL_ID`.',
    );
    return true;
  }

  const sessionDate = new Date(state.utcSeconds * 1000);
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
        { name: 'Session Timestamp', value: `<t:${state.utcSeconds}:F>`, inline: false },
        { name: 'Recovered By', value: `<@${interaction.user.id}>`, inline: false },
      )
      .setFooter({ text: 'Glace Hotels • Manual Junior Staff Log Recovery' })
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
    `• Session time: <t:${state.utcSeconds}:F>`,
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
    .setDescription('Recover missed Junior Staff training logs in the existing Junior Logs channel.')
    .setDMPermission(false)
    .addStringOption((option) => option
      .setName('date')
      .setDescription('Original session date in its entered timezone: MM/DD/YYYY')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('time')
      .setDescription('Original session time and timezone, such as 9:00 PM EST')
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

    const dateInput = interaction.options.getString('date', true);
    const timeInput = interaction.options.getString('time', true);
    const minutes = interaction.options.getInteger('minutes', true);
    const parsed = parseSessionDateTime(dateInput, timeInput);

    if (!parsed) {
      return interaction.reply({
        content: [
          '❌ I could not understand that session date, time, or timezone.',
          '',
          '**Example:** `/manualjuniorlog date:08/02/2026 time:9:00 PM EST minutes:45`',
          '',
          supportedTimeZoneSummary(),
        ].join('\n'),
        ephemeral: true,
      });
    }

    const modal = new ModalBuilder()
      .setCustomId(modalCustomId(Math.floor(parsed.utcMs / 1000), minutes))
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
};
