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
const {
  resolveJuniorLogChannel,
  ingestJuniorActivityLogMessage,
} = require('../../utils/juniorActivityTracker');
const { getSessionCard, getSessionTypeFromCard } = require('../../utils/trelloClient');

const CUSTOM_ID_PREFIX = 'manualjuniorlog:';
const MAX_ATTENDEES = 50;
const SEARCH_LIMIT = 500;

function normalizeJuniorRole(value) {
  const lower = String(value || '').trim().toLowerCase();
  if (lower.includes('front') && lower.includes('desk')) return 'Front Desk | Helper';
  if (lower.includes('custodian')) return 'Custodian | Helper';
  if (lower.includes('hotel') && lower.includes('cook')) return 'Hotel Cook | Helper';
  if (lower === 'cook' || lower.includes('cook')) return 'Hotel Cook | Helper';
  if (lower.includes('security')) return 'Security | Helper';
  return null;
}

function juniorRoleDisplay(role) {
  return String(role || '').replace(/\s*\|\s*/g, ' ').trim();
}

function parseAttendeeLine(line, index) {
  const cleanLine = String(line || '').replace(/^\s*[\u2022*-]\s*/, '').trim();
  const parts = cleanLine.split('|').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { error: `Line ${index + 1}: use \`Username | Roblox ID | Role\`.` };
  }

  const username = parts[0].replace(/^@+/, '').trim();
  let robloxId = null;
  let roleInput;

  if (parts.length >= 3 && /^\d{3,20}$/.test(parts[1])) {
    robloxId = parts[1];
    roleInput = parts.slice(2).join(' ');
  } else if (parts.length >= 3 && /^(?:n\/?a|none|unknown|not provided)$/i.test(parts[1])) {
    roleInput = parts.slice(2).join(' ');
  } else {
    roleInput = parts.slice(1).join(' ');
  }

  if (!username) return { error: `Line ${index + 1}: Roblox username is missing.` };
  const role = normalizeJuniorRole(roleInput);
  if (!role) {
    return {
      error: `Line ${index + 1}: role must be Security Helper, Front Desk Helper, Custodian Helper, or Hotel Cook Helper.`,
    };
  }

  return { attendee: { username, robloxId, role } };
}

function parseAttendees(value) {
  const lines = String(value || '')
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return { attendees: [], errors: ['No Junior Staff were entered.'] };
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

function parseCardTitle(cardName) {
  const match = String(cardName || '').trim().match(/^\[([^\]]+)\]\s+(.+?)\s+-\s+(.+)$/);
  return match
    ? { typeLabel: match[1].trim(), enteredTime: match[2].trim(), host: match[3].trim() }
    : { typeLabel: null, enteredTime: null, host: null };
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

function attendeeKey(attendee) {
  return attendee.robloxId
    ? `id:${attendee.robloxId}`
    : `user:${String(attendee.username || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

function mergeAttendees(existing, incoming) {
  const map = new Map();
  for (const attendee of [...existing, ...incoming]) map.set(attendeeKey(attendee), attendee);
  return [...map.values()].sort((a, b) => a.username.localeCompare(b.username));
}

function parseExistingManualEntries(message) {
  const field = (message?.embeds || [])
    .flatMap((embed) => embed.fields || [])
    .find((entry) => /manual junior staff entries|junior staff attendees|attendees/i.test(String(entry.name || '')));
  if (!field?.value) return [];
  return parseAttendees(field.value).attendees;
}

function messageContainsCard(message, shortLink, cardUrl) {
  const haystack = [
    message?.content,
    ...(message?.embeds || []).flatMap((embed) => [
      embed.title,
      embed.description,
      embed.footer?.text,
      ...(embed.fields || []).flatMap((field) => [field.name, field.value]),
    ]),
  ].filter(Boolean).join('\n').toLowerCase();
  return haystack.includes(String(shortLink || '').toLowerCase())
    || haystack.includes(String(cardUrl || '').toLowerCase());
}

async function findSessionLog(channel, shortLink, cardUrl) {
  let before;
  let scanned = 0;
  while (scanned < SEARCH_LIMIT) {
    const batch = await channel.messages.fetch({
      limit: Math.min(100, SEARCH_LIMIT - scanned),
      before,
    }).catch(() => null);
    if (!batch?.size) break;
    for (const message of batch.values()) {
      scanned += 1;
      if (messageContainsCard(message, shortLink, cardUrl)) return message;
    }
    before = batch.last()?.id;
    if (!before) break;
  }
  return null;
}

function buildAttendeeLines(attendees) {
  return attendees.map((attendee) => (
    `\u2022 ${attendee.username} | ${attendee.robloxId || 'N/A'} | ${juniorRoleDisplay(attendee.role)}`
  ));
}

function buildAttendeeFields(attendees, baseName = 'Junior Staff Attendees') {
  const chunks = [];
  let current = [];
  let length = 0;
  for (const line of buildAttendeeLines(attendees)) {
    const extra = line.length + (current.length ? 1 : 0);
    if (current.length && length + extra > 1000) {
      chunks.push(current.join('\n'));
      current = [];
      length = 0;
    }
    current.push(line);
    length += line.length + (current.length > 1 ? 1 : 0);
  }
  if (current.length) chunks.push(current.join('\n'));
  return chunks.map((value, index) => ({
    name: chunks.length > 1 ? `${baseName} ${index + 1}/${chunks.length}` : baseName,
    value,
    inline: false,
  }));
}

function buildNewSessionEmbed({ card, cardUrl, shortLink, attendees, recoveredBy }) {
  const titleDetails = parseCardTitle(card.name);
  const sessionDate = new Date(card.due);
  const unixSeconds = Math.floor(sessionDate.getTime() / 1000);
  return new EmbedBuilder()
    .setColor(0x2563eb)
    .setTitle('Junior Staff Session Log')
    .setDescription('Manual recovery for a Junior Staff session that was not logged before shutdown.')
    .addFields(
      { name: 'Session', value: card.name || sessionTypeLabel(card), inline: false },
      { name: 'Session Type', value: sessionTypeLabel(card), inline: true },
      { name: 'Host', value: titleDetails.host || 'See Trello card', inline: true },
      { name: 'Session Timestamp', value: `<t:${unixSeconds}:F>`, inline: false },
      { name: 'Entered Session Time', value: titleDetails.enteredTime || 'See Trello card', inline: true },
      { name: 'Session Card', value: `[Open Trello card](${cardUrl})`, inline: true },
      ...buildAttendeeFields(attendees),
      { name: 'Recovered By', value: recoveredBy, inline: false },
    )
    .setFooter({ text: `Glace Hotels \u2022 Junior Staff Session \u2022 Card ${shortLink}` })
    .setTimestamp(sessionDate);
}

function buildUpdatedEmbeds(existingMessage, attendees, recoveredBy, shortLink) {
  const existing = existingMessage.embeds?.[0];
  const data = existing ? existing.toJSON() : {};
  const fields = Array.isArray(data.fields) ? [...data.fields] : [];
  const attendeeFieldIndexes = fields
    .map((field, index) => (/manual junior staff entries|junior staff attendees|attendees/i.test(String(field.name || '')) ? index : -1))
    .filter((index) => index >= 0);
  const insertAt = attendeeFieldIndexes.length ? attendeeFieldIndexes[0] : fields.length;
  const attendeeFields = buildAttendeeFields(attendees, attendeeFieldIndexes.length ? 'Junior Staff Attendees' : 'Manual Junior Staff Entries');
  const withoutAttendees = fields.filter((field) => !/manual junior staff entries|junior staff attendees|attendees/i.test(String(field.name || '')));
  withoutAttendees.splice(insertAt, 0, ...attendeeFields);
  fields.length = 0;
  fields.push(...withoutAttendees);

  const recoveredIndex = fields.findIndex((field) => /recovered by|last manual update/i.test(String(field.name || '')));
  const recoveredField = { name: 'Last Manual Update', value: recoveredBy, inline: false };
  if (recoveredIndex >= 0) fields[recoveredIndex] = recoveredField;
  else fields.push(recoveredField);

  return [new EmbedBuilder({
    ...data,
    title: data.title || 'Junior Staff Session Log',
    color: data.color || 0x2563eb,
    fields: fields.slice(0, 25),
    footer: data.footer || { text: `Glace Hotels \u2022 Junior Staff Session \u2022 Card ${shortLink}` },
  })];
}

async function handleModalSubmit(interaction) {
  if (!interaction?.isModalSubmit?.() || !String(interaction.customId || '').startsWith(CUSTOM_ID_PREFIX)) return false;

  if (!atLeastTier(interaction.member, 6)) {
    await interaction.reply({ content: 'You must be **Corporate+** to manually recover Junior Staff session logs.', ephemeral: true });
    return true;
  }

  const cardIdentifier = String(interaction.customId || '').slice(CUSTOM_ID_PREFIX.length);
  if (!/^[A-Za-z0-9]{5,64}$/.test(cardIdentifier)) {
    await interaction.reply({ content: 'This manual-log form expired. Run `/manualjuniorlog` again.', ephemeral: true });
    return true;
  }

  const { attendees, errors } = parseAttendees(interaction.fields.getTextInputValue('attendees'));
  if (errors.length) {
    await interaction.reply({
      content: [
        '\u274C I could not submit the Junior Staff log yet:',
        '',
        ...errors.slice(0, 10).map((error) => `\u2022 ${error}`),
        '',
        'Use one person per line: `Username | Roblox ID | Security Helper`',
        'The Roblox ID may be `N/A`.',
      ].join('\n'),
      ephemeral: true,
    });
    return true;
  }

  await interaction.deferReply({ ephemeral: true });

  const cardResult = await getSessionCard(cardIdentifier).catch(() => null);
  if (!cardResult?.ok || !cardResult.card) {
    await interaction.editReply('\u274C I could not load that Trello session card. Run `/manualjuniorlog` again with the card link.');
    return true;
  }

  const card = cardResult.card;
  if (!card.due || Number.isNaN(new Date(card.due).getTime())) {
    await interaction.editReply('\u274C That Trello card does not have a valid session date and time.');
    return true;
  }

  const channel = await resolveJuniorLogChannel(interaction.client, interaction.guild).catch(() => null);
  if (!channel?.isTextBased?.()) {
    await interaction.editReply('\u274C I could not find the Junior Staff log channel. Check the Junior Activity log channel environment variable.');
    return true;
  }

  const shortLink = card.shortLink || cardIdentifier;
  const cardUrl = card.shortUrl || card.url || `https://trello.com/c/${shortLink}`;
  const existingMessage = await findSessionLog(channel, shortLink, cardUrl);
  const recoveredBy = `<@${interaction.user.id}>`;
  let resultMessage;
  let action;

  if (existingMessage && existingMessage.author?.id === interaction.client.user.id && existingMessage.editable !== false) {
    const merged = mergeAttendees(parseExistingManualEntries(existingMessage), attendees);
    resultMessage = await existingMessage.edit({
      embeds: buildUpdatedEmbeds(existingMessage, merged, recoveredBy, shortLink),
    });
    action = 'updated';
  } else {
    const embed = buildNewSessionEmbed({ card, cardUrl, shortLink, attendees, recoveredBy });
    resultMessage = await channel.send({ embeds: [embed] });
    action = existingMessage ? 'created a linked recovery log because the existing log could not be edited' : 'created';
  }

  await ingestJuniorActivityLogMessage(resultMessage).catch((error) => {
    console.error('[MANUAL JUNIOR LOG] Could not ingest recovery log:', error);
  });

  await interaction.editReply([
    `\u2705 **Junior Staff session log ${action}.**`,
    '',
    `\u2022 Session card: ${cardUrl}`,
    `\u2022 Junior Staff entered: ${attendees.length}`,
    `\u2022 Log message: ${resultMessage.url}`,
    '\u2022 LI+ activity tracking was not changed.',
  ].join('\n'));
  return true;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('manualjuniorlog')
    .setDescription('Create or update a missed Junior Staff session log from its Trello card.')
    .setDMPermission(false)
    .addStringOption((option) => option
      .setName('session_card')
      .setDescription('Full Trello session card link')
      .setRequired(true)),

  async execute(interaction) {
    if (!atLeastTier(interaction.member, 6)) {
      return interaction.reply({ content: 'You must be **Corporate+** to use `/manualjuniorlog`.', ephemeral: true });
    }

    const cardIdentifier = extractCardIdentifier(interaction.options.getString('session_card', true));
    if (!cardIdentifier) {
      return interaction.reply({
        content: '\u274C Paste the full Trello session card link, such as `https://trello.com/c/abc12345/session-name`.',
        ephemeral: true,
      });
    }

    const modal = new ModalBuilder()
      .setCustomId(`${CUSTOM_ID_PREFIX}${cardIdentifier}`)
      .setTitle('Recover Junior Staff Log');

    const attendeesInput = new TextInputBuilder()
      .setCustomId('attendees')
      .setLabel('Junior Staff and roles')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(4000)
      // Discord limits modal input placeholders to 100 characters.
      // Keep this intentionally short; the full format help is returned on validation errors.
      .setPlaceholder('Username | Roblox ID/N/A | Role\nExampleUser | N/A | Security Helper');

    modal.addComponents(new ActionRowBuilder().addComponents(attendeesInput));
    return interaction.showModal(modal);
  },

  handleModalSubmit,
  parseAttendees,
  parseCardTitle,
  extractCardIdentifier,
};
