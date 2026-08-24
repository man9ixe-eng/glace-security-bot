// src/commands/sessions/sessions.js

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { listSessionCards } = require('../../utils/trelloClient');

const DEFAULT_TIME_ZONE = process.env.SESSIONS_VIEW_TIME_ZONE || 'America/New_York';

function getTimeZoneParts(date, timeZone = DEFAULT_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
    weekday: 'short',
  });

  const parts = formatter.formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }

  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hour = Number(map.hour) === 24 ? 0 : Number(map.hour);

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: weekdayMap[map.weekday],
  };
}

function zonedLocalToUtcMs(local, timeZone = DEFAULT_TIME_ZONE) {
  const targetLocalMs = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour ?? 0,
    local.minute ?? 0,
    local.second ?? 0,
    local.millisecond ?? 0,
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

function getRange(rangeKey, timeZone = DEFAULT_TIME_ZONE, now = new Date()) {
  const nowParts = getTimeZoneParts(now, timeZone);

  if (rangeKey === 'day') {
    const start = { year: nowParts.year, month: nowParts.month, day: nowParts.day };
    return {
      startMs: zonedLocalToUtcMs({ ...start, hour: 0, minute: 0, second: 0, millisecond: 0 }, timeZone),
      endMs: zonedLocalToUtcMs({ ...start, hour: 23, minute: 59, second: 59, millisecond: 999 }, timeZone),
      label: 'Today',
      timeZone,
    };
  }

  const daysSinceMonday = nowParts.weekday === 0 ? 6 : nowParts.weekday - 1;
  const monday = addDays(nowParts, -daysSinceMonday);
  const sunday = addDays(monday, 6);

  return {
    startMs: zonedLocalToUtcMs({ ...monday, hour: 0, minute: 0, second: 0, millisecond: 0 }, timeZone),
    endMs: zonedLocalToUtcMs({ ...sunday, hour: 23, minute: 59, second: 59, millisecond: 999 }, timeZone),
    label: 'This Week',
    timeZone,
  };
}

function normalizeSessionType(type) {
  const normalized = String(type || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'massshift' || normalized === 'mass_shift') return 'mass_shift';
  if (normalized.includes('interview')) return 'interview';
  if (normalized.includes('training')) return 'training';
  return normalized || 'session';
}

function sessionEmoji(type) {
  const normalized = normalizeSessionType(type);
  if (normalized === 'training') return '\uD83D\uDD34';
  if (normalized === 'interview') return '\uD83D\uDFE1';
  if (normalized === 'mass_shift') return '\uD83D\uDFE3';
  return '\uD83D\uDD39';
}

function sessionLabel(type) {
  const normalized = normalizeSessionType(type);
  if (normalized === 'training') return 'Training';
  if (normalized === 'interview') return 'Interview';
  if (normalized === 'mass_shift') return 'Mass Shift';
  return 'Session';
}

function extractHost(cardName = '') {
  const match = String(cardName).match(/-\s*([^\]-]+)$/);
  return match ? match[1].trim() : 'Unknown Host';
}

function formatWindowLabel(range) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: range.timeZone || DEFAULT_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return `${formatter.format(new Date(range.startMs))} \u2014 ${formatter.format(new Date(range.endMs))}`;
}

function getTimeZoneDisplayName(timeZone) {
  const map = {
    'America/New_York': 'Eastern Time',
    'America/Chicago': 'Central Time',
    'America/Denver': 'Mountain Time',
    'America/Los_Angeles': 'Pacific Time',
    UTC: 'UTC',
  };

  return map[timeZone] || timeZone;
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
          { name: '\uD83D\uDFE1 Interview', value: 'interview' },
          { name: '\uD83D\uDD34 Training', value: 'training' },
          { name: '\uD83D\uDFE3 Mass Shift', value: 'mass_shift' },
        ),
    )
    .addStringOption((option) =>
      option
        .setName('timezone')
        .setDescription('Timezone to use for Day/Week. Default is Eastern Time.')
        .setRequired(false)
        .addChoices(
          { name: 'Eastern Time', value: 'America/New_York' },
          { name: 'Central Time', value: 'America/Chicago' },
          { name: 'Mountain Time', value: 'America/Denver' },
          { name: 'Pacific Time', value: 'America/Los_Angeles' },
          { name: 'UTC', value: 'UTC' },
        ),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const rangeKey = interaction.options.getString('range', true);
    const typeFilter = interaction.options.getString('type') || 'all';
    const timeZone = interaction.options.getString('timezone') || DEFAULT_TIME_ZONE;
    const range = getRange(rangeKey, timeZone, new Date(interaction.createdTimestamp || Date.now()));

    let cards;
    try {
      cards = await listSessionCards();
    } catch (err) {
      console.error('[SESSIONS] Failed to list Trello sessions:', err);
      await interaction.editReply('\u274C I could not load Trello sessions. Please check the Trello env vars/list IDs.');
      return;
    }

    const filtered = cards
      .filter((card) => card.due)
      .map((card) => ({
        ...card,
        dueMs: new Date(card.due).getTime(),
        normalizedType: normalizeSessionType(card.sessionType),
      }))
      .filter((card) => Number.isFinite(card.dueMs))
      .filter((card) => card.dueMs >= range.startMs && card.dueMs <= range.endMs)
      .filter((card) => typeFilter === 'all' || card.normalizedType === typeFilter)
      .sort((a, b) => a.dueMs - b.dueMs || String(a.name || '').localeCompare(String(b.name || '')));

    const shown = filtered.slice(0, 25);
    const emptySuffix = typeFilter !== 'all' ? ` under **${sessionLabel(typeFilter)}**` : '';
    const emptyText = `No sessions found for **${range.label.toLowerCase()}**${emptySuffix}.`;

    const lines = shown.map((card, index) => {
      const unix = Math.floor(card.dueMs / 1000);
      const url = card.shortUrl || card.url || `https://trello.com/c/${card.id}`;
      const done = card.dueComplete ? ' \u2705' : '';
      return [
        `**${index + 1}. ${sessionEmoji(card.normalizedType)} ${sessionLabel(card.normalizedType)}${done}**`,
        `Host: ${extractHost(card.name)}`,
        `Time: <t:${unix}:F> (<t:${unix}:R>)`,
        `Status/List: ${card.listName || 'Trello'}`,
        `[Open Trello Card](${url})`,
      ].join('\n');
    });

    const embed = new EmbedBuilder()
      .setTitle(`\uD83D\uDCC5 Sessions \u2022 ${range.label}`)
      .setColor(0x3b82f6)
      .setDescription(lines.length ? lines.join('\n\n') : emptyText)
      .addFields(
        {
          name: 'Legend',
          value: '\uD83D\uDFE1 Interview \u2022 \uD83D\uDD34 Training \u2022 \uD83D\uDFE3 Mass Shift',
          inline: false,
        },
        {
          name: 'Window',
          value: `${formatWindowLabel(range)}\nTimezone: ${getTimeZoneDisplayName(timeZone)} (${timeZone})`,
          inline: false,
        },
      )
      .setFooter({
        text: filtered.length > shown.length
          ? `Showing first ${shown.length} of ${filtered.length} sessions.`
          : `${filtered.length} session(s) found.`,
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
