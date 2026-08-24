// src/commands/sessions/junioractivity.js
// Glace Hotels \u2014 Junior Staff Roblox training activity panel

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');
const {
  getWeekRange,
  formatRangeLabel,
  formatWeekWindowShort,
  TIME_ZONE,
} = require('../../utils/activityTracker');
const {
  backfillJuniorActivityFromLogChannel,
  getRecordsForPlayer,
  getKnownPlayerProfile,
  summarizeJuniorRecords,
  CURRENT_JUNIOR_STAFF_MESSAGE,
  getWeeklyConsistency,
  getPromotionDecision,
  formatMinutes,
} = require('../../utils/juniorActivityTracker');

function monthRange(month, year) {
  const m = Number(month);
  const y = Number(year);
  const startMs = Date.UTC(y, m - 1, 1, 0, 0, 0, 0);
  const endMs = Date.UTC(y, m, 0, 23, 59, 59, 999);
  const startLocal = { year: y, month: m, day: 1 };
  const endDate = new Date(Date.UTC(y, m, 0, 12, 0, 0));
  const endLocal = { year: y, month: m, day: endDate.getUTCDate() };
  return { startMs, endMs, startLocal, endLocal };
}

function getDefaultMonthYear() {
  const now = new Date();
  return { month: now.getUTCMonth() + 1, year: now.getUTCFullYear() };
}

function buildRecentLogs(records) {
  if (!records.length) return 'No training logs found for this range.';

  return records.slice(0, 8).map((record) => {
    const date = new Date(Number(record.timestamp || Date.now()));
    const dateText = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: TIME_ZONE,
    });

    return `\u2022 ${dateText} \u2014 ${record.role || 'Unknown Role'} \u2014 ${formatMinutes(record.minutesInTC)}`;
  }).join('\n');
}

function buildRoleBreakdown(summary) {
  const entries = Object.entries(summary.roles || {})
    .sort((a, b) => b[1] - a[1])
    .map(([role, count]) => `\u2022 ${role}: ${count}`);

  return entries.length ? entries.join('\n') : 'No roles found for this range.';
}

function buildConsistencyLines(windows) {
  if (!windows.length) return 'No weekly data found yet.';

  return windows.map((window) => {
    const label = window.offset === 0 ? 'Current Week' : `${window.offset} Week${window.offset === 1 ? '' : 's'} Ago`;
    const status = window.metTwoTrainingStandard ? '\u2705' : '\u274C';
    return `${status} ${label} (${formatWeekWindowShort(window.range)}): ${window.trainings} training${window.trainings === 1 ? '' : 's'} \u2022 ${formatMinutes(window.minutes)}`;
  }).join('\n');
}

function getRangeFromOptions(interaction) {
  const weekBack = interaction.options.getInteger('week');
  const month = interaction.options.getInteger('month');
  const yearOption = interaction.options.getInteger('year');

  if (Number.isInteger(weekBack)) {
    const safeWeekBack = Math.max(0, Math.min(weekBack, 52));
    const range = getWeekRange(-safeWeekBack);
    const label = safeWeekBack === 0
      ? `Current Week \u2022 ${formatRangeLabel(range)}`
      : `${safeWeekBack} Week${safeWeekBack === 1 ? '' : 's'} Ago \u2022 ${formatRangeLabel(range)}`;
    return { range, label, mode: 'week' };
  }

  if (Number.isInteger(month)) {
    const safeMonth = Math.max(1, Math.min(month, 12));
    const { year: currentYear } = getDefaultMonthYear();
    const year = Number.isInteger(yearOption) ? yearOption : currentYear;
    const range = monthRange(safeMonth, year);
    return { range, label: `Month View \u2022 ${formatRangeLabel(range)}`, mode: 'month' };
  }

  const range = getWeekRange(0);
  return { range, label: `Current Week \u2022 ${formatRangeLabel(range)}`, mode: 'week' };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('junioractivity')
    .setDescription('View Junior Staff Roblox training activity by username or Roblox ID.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('player')
        .setDescription('Roblox username or Roblox ID')
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('week')
        .setDescription('Weeks back to view. 0 = current week, 1 = last week.')
        .setMinValue(0)
        .setMaxValue(52)
        .setRequired(false),
    )
    .addIntegerOption((option) =>
      option
        .setName('month')
        .setDescription('Month to view. 1 = January, 12 = December.')
        .setMinValue(1)
        .setMaxValue(12)
        .setRequired(false),
    )
    .addIntegerOption((option) =>
      option
        .setName('year')
        .setDescription('Year for the month view. Defaults to the current year.')
        .setMinValue(2024)
        .setMaxValue(2100)
        .setRequired(false),
    ),

  async execute(interaction) {
    if (!atLeastTier(interaction.member, Number(process.env.JUNIOR_ACTIVITY_MIN_TIER || 4))) {
      await interaction.reply({
        content: 'You must be **Management+** to use `/junioractivity`.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const player = interaction.options.getString('player', true).trim();
    const { range, label } = getRangeFromOptions(interaction);

    const backfill = await backfillJuniorActivityFromLogChannel(interaction.client, {
      guild: interaction.guild,
    });

    if (!backfill.ok && backfill.reason === 'missing_log_channel') {
      await interaction.editReply(
        '\u26A0\uFE0F I could not find the Junior Staff Roblox training log channel. Set `JUNIOR_ACTIVITY_LOG_CHANNEL_ID` in Render, or name the channel `junior-activity-log`, `junior-training-log`, `training-log`, or `tc-log`.',
      );
      return;
    }

    const records = getRecordsForPlayer(player, range);

    // Do not show an empty Junior Staff panel.
    // If the player has no Junior Staff training logs in the selected range,
    // return the simple friendly message instead.
    if (!records.length) {
      await interaction.editReply(CURRENT_JUNIOR_STAFF_MESSAGE);
      return;
    }

    const profile = getKnownPlayerProfile(player);

    if (!profile) {
      await interaction.editReply(CURRENT_JUNIOR_STAFF_MESSAGE);
      return;
    }

    const summary = summarizeJuniorRecords(records);
    const consistency = getWeeklyConsistency(player, 4, getWeekRange);
    const decision = getPromotionDecision(consistency);

    const displayName = profile.robloxUsername && profile.robloxUsername !== 'Unknown'
      ? profile.robloxUsername
      : player;

    const embed = new EmbedBuilder()
      .setTitle(`${displayName} \u2022 Junior Staff Activity`)
      .setColor(
        decision.status === 'Promotion Ready'
          ? 0x22C55E
          : decision.status === 'Needs Time'
          ? 0xF59E0B
          : 0xEF4444,
      )
      .setDescription(
        [
          `**Status:** ${decision.emoji} **${decision.status}**`,
          `**Reason:** ${decision.reason}`,
          '',
          `**Range:** ${label}`,
        ].join('\n'),
      )
      .addFields(
        {
          name: '\uD83D\uDC64 Roblox Profile',
          value: [
            `**Username:** ${profile.robloxUsername || displayName}`,
            `**Roblox ID:** ${profile.robloxId || 'Unknown'}`,
            `**Latest Role:** ${summary.latestRole || profile.role || 'Unknown Junior Staff Role'}`,
          ].join('\n'),
          inline: false,
        },
        {
          name: '\uD83D\uDCDA Training Breakdown',
          value: [
            `**Trainings:** ${summary.totalTrainings}`,
            `**Minutes in TC:** ${formatMinutes(summary.totalMinutes)}`,
            `**Average Time:** ${formatMinutes(summary.averageMinutes)} per training`,
          ].join('\n'),
          inline: false,
        },
        {
          name: '\uD83E\uDDCA Role Breakdown',
          value: buildRoleBreakdown(summary),
          inline: false,
        },
        {
          name: '\uD83D\uDCC8 4-Week Consistency',
          value: buildConsistencyLines(consistency),
          inline: false,
        },
        {
          name: '\uD83D\uDCDD Recent Training Logs',
          value: buildRecentLogs(records),
          inline: false,
        },
      )
      .setFooter({
        text: `Junior Staff tracking uses Roblox username/ID logs only \u2022 Synced ${backfill.added} new / ${backfill.updated} updated`,
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
