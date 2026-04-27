// src/commands/sessions/sessions.js

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { listSessionCards } = require('../../utils/trelloClient');

const TIME_ZONE = process.env.SESSIONS_VIEW_TIME_ZONE || 'America/New_York';

function getTimeZoneParts(date, timeZone = TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  });

  const parts = formatter.formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }

  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: weekdayMap[map.weekday],
  };
}

function zonedLocalToUtcMs(local, timeZone = TIME_ZONE) {
  const targetLocalMs = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour || 0,
    local.minute || 0,
    local.second || 0,
    local.millisecond || 0,
  );

  let guess = targetLocalMs;
  for (let i = 0; i < 4; i += 1) {
    const actual = getTimeZoneParts(new Date(guess), timeZone);
    const actualLocalMs = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
      0,
    );
    guess += targetLocalMs - actualLocalMs;
  }

  return guess;
}

function addDays(local, days) {
  const date = new Date(Date.UTC(local.year, local.month - 1, local.day + days, 12, 0, 0));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function getRange(rangeKey) {
  const nowParts = getTimeZoneParts(new Date(), TIME_ZONE);

  if (rangeKey === 'day') {
    const start = { year: nowParts.year, month: nowParts.month, day: nowParts.day };
    return {
      startMs: zonedLocalToUtcMs({ ...start, hour: 0, minute: 0, second: 0, millisecond: 0 }),
      endMs: zonedLocalToUtcMs({ ...start, hour: 23, minute: 59, second: 59, millisecond: 999 }),
      label: 'Today',
    };
  }

  const daysSinceMonday = nowParts.weekday === 0 ? 6 : nowParts.weekday - 1;
  const monday = addDays(nowParts, -daysSinceMonday);
  const sunday = addDays(monday, 6);

  return {
    startMs: zonedLocalToUtcMs({ ...monday, hour: 0, minute: 0, second: 0, millisecond: 0 }),
    endMs: zonedLocalToUtcMs({ ...sunday, hour: 23, minute: 59, second: 59, millisecond: 999 }),
    label: 'This Week',
  };
}

function sessionEmoji(type) {
  if (type === 'training') return '🔴';
  if (type === 'interview') return '🟡';
  if (type === 'mass_shift') return '🟣';
  return '🔹';
}

function sessionLabel(type) {
  if (type === 'training') return 'Training';
  if (type === 'interview') return 'Interview';
  if (type === 'mass_shift') return 'Mass Shift';
  return 'Session';
}

function extractHost(cardName = '') {
  const match = String(cardName).match(/-\s*([^\]-]+)$/);
  return match ? match[1].trim() : 'Unknown Host';
}

function formatWindowLabel(range) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return `${formatter.format(new Date(range.startMs))} — ${formatter.format(new Date(range.endMs))}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sessions')
    .setDescription('View Trello sessions for today or this week.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('range')
        .setDescription('Choose the session window to view.')
        .setRequired(true)
        .addChoices(
          { name: 'Day', value: 'day' },
          { name: 'Week', value: 'week' },
        ),
    )
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('Optional session type filter.')
        .setRequired(false)
        .addChoices(
          { name: 'All', value: 'all' },
          { name: 'Interview', value: 'interview' },
          { name: 'Training', value: 'training' },
          { name: 'Mass Shift', value: 'mass_shift' },
        ),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const rangeKey = interaction.options.getString('range', true);
    const typeFilter = interaction.options.getString('type') || 'all';
    const range = getRange(rangeKey);

    let cards;
    try {
      cards = await listSessionCards();
    } catch (err) {
      console.error('[SESSIONS] Failed to list Trello sessions:', err);
      await interaction.editReply('❌ I could not load Trello sessions. Please check the Trello env vars/list IDs.');
      return;
    }

    const filtered = cards
      .filter((card) => card.due)
      .map((card) => ({ ...card, dueMs: new Date(card.due).getTime() }))
      .filter((card) => Number.isFinite(card.dueMs))
      .filter((card) => card.dueMs >= range.startMs && card.dueMs <= range.endMs)
      .filter((card) => typeFilter === 'all' || card.sessionType === typeFilter)
      .sort((a, b) => a.dueMs - b.dueMs || String(a.name || '').localeCompare(String(b.name || '')));

    const shown = filtered.slice(0, 25);
    const emptySuffix = typeFilter !== 'all' ? ` under **${sessionLabel(typeFilter)}**` : '';
    const emptyText = `No sessions found for **${range.label.toLowerCase()}**${emptySuffix}.`;

    const lines = shown.map((card, index) => {
      const unix = Math.floor(card.dueMs / 1000);
      const url = card.shortUrl || card.url || `https://trello.com/c/${card.id}`;
      const done = card.dueComplete ? ' ✅' : '';
      return [
        `**${index + 1}. ${sessionEmoji(card.sessionType)} ${sessionLabel(card.sessionType)}${done}**`,
        `Host: ${extractHost(card.name)}`,
        `Time: <t:${unix}:F> (<t:${unix}:R>)`,
        `Status/List: ${card.listName || 'Trello'}`,
        `[Open Trello Card](${url})`,
      ].join('\n');
    });

    const embed = new EmbedBuilder()
      .setTitle(`📅 Sessions • ${range.label}`)
      .setColor(0x3b82f6)
      .setDescription(lines.length ? lines.join('\n\n') : emptyText)
      .addFields({
        name: 'Window',
        value: `${formatWindowLabel(range)}\nTimezone: ${TIME_ZONE}`,
        inline: false,
      })
      .setFooter({
        text: filtered.length > shown.length
          ? `Showing first ${shown.length} of ${filtered.length} sessions.`
          : `${filtered.length} session(s) found.`,
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
