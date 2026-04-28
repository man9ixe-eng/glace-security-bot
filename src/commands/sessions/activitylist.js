const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  TIME_ZONE,
  backfillFromLogChannel,
  getQuotaProfileForMember,
  getUserActivity,
  getWeekRange,
  summarizeActivity,
  hasMetQuota,
  formatRangeLabel,
  getQuotaSource,
} = require('../../utils/activityTracker');

const TEAM_EMOJIS = {
  intern: '<:intern_team:1476916364877758505>',
  management: '<:manager_team:1476916258036514837>',
  senior_management: '<:senior_team:1476916038602985614>',
  // Corporate Intern is part of the Senior Management team visually, but keeps its own quota class.
  corporate_intern: '<:senior_team:1476916038602985614>',
  junior_corporate: '<:corp_team:1478642239155474533>',
  head_corporate: '<:corp_team:1478642239155474533>',
  corporate_board: '<:board_team:1476915796730187868>',
  presidential: '<:pres_team:1476915718644699136>',
};

function getTeamEmoji(profile) {
  return TEAM_EMOJIS[profile?.key] || '🔹';
}

function getTeamDisplayLabel(profile) {
  // Corporate Intern should look like Senior Management, while still using its unique quota.
  if (profile?.key === 'corporate_intern') return 'Senior Management';
  return profile?.label || 'Unknown Team';
}

function buildSectionBox(lines) {
  return `╭────────────────────╮\n${lines.map((line) => `│ ${line}`).join('\n')}\n╰────────────────────╯`;
}

function checkLine(label, actual, required) {
  if (!required || required <= 0) return null;
  return `${label}: ${actual || 0}/${required} ${(actual || 0) >= required ? '✅' : '❌'}`;
}

function buildRequirementChecks(summary, quotaProfile) {
  const source = getQuotaSource(summary, quotaProfile);
  const q = quotaProfile.quota || {};
  const lines = [];

  if ((q.total || 0) > 0 && q.mode === 'regular') {
    lines.push(checkLine('Total Sessions', source.total, q.total));
    lines.push(checkLine('Interviews', source.interview, q.minInterview));
    lines.push(checkLine('Trainings', source.training, q.minTraining));
  }

  if ((q.total || 0) > 0 && q.mode === 'regular_and_cohost') {
    lines.push(checkLine('Non-Co-Host Sessions', source.regularTotal, q.total));
    lines.push(checkLine('Non-Co-Host Interviews', source.regularInterview, q.minInterview));
    lines.push(checkLine('Non-Co-Host Trainings', source.regularTraining, q.minTraining));
  }

  if ((q.hostedTotal || 0) > 0) {
    lines.push(checkLine('Hosted Sessions', source.hostedTotal, q.hostedTotal));
    lines.push(checkLine('Hosted Interviews', source.hostedInterview, q.hostedInterview));
    lines.push(checkLine('Hosted Trainings', source.hostedTraining, q.hostedTraining));
  }

  if ((q.cohostTotal || 0) > 0) {
    lines.push(checkLine('Co-Host Sessions', source.cohostTotal, q.cohostTotal));
    lines.push(checkLine('Co-Host Interviews', source.cohostInterview, q.cohostInterview));
    lines.push(checkLine('Co-Host Trainings', source.cohostTraining, q.cohostTraining));
  }

  if ((q.minOverseer || 0) > 0) {
    lines.push(checkLine('Overseer Sessions', source.overseerTotal, q.minOverseer));
    lines.push(checkLine('Overseer Interviews', source.overseerInterview, q.overseerInterview));
    lines.push(checkLine('Overseer Trainings', source.overseerTraining, q.overseerTraining));
  }

  if ((q.shiftMinutes || 0) > 0) {
    lines.push(checkLine('Shift Minutes', source.shiftMinutes || 0, q.shiftMinutes));
  }

  return lines.filter(Boolean);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('activitylist')
    .setDescription('Show members who have not met quota.')
    .addStringOption((option) =>
      option
        .setName('period')
        .setDescription('Which week to view')
        .setRequired(true)
        .addChoices(
          { name: 'Current Week', value: 'current' },
          { name: 'Last Week', value: 'last' },
        ),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    await backfillFromLogChannel(interaction.client);

    const period = interaction.options.getString('period', true);
    const isCurrent = period === 'current';
    const selectedRange = getWeekRange(isCurrent ? 0 : -1, TIME_ZONE);

    const members = await interaction.guild.members.fetch();
    const missing = [];

    for (const member of members.values()) {
      if (member.user?.bot) continue;

      const quotaProfile = getQuotaProfileForMember(member);
      if (!quotaProfile) continue;

      const activity = getUserActivity(member.id);
      const summary = summarizeActivity(activity, selectedRange);

      if (hasMetQuota(summary, quotaProfile)) continue;

      missing.push({ member, quotaProfile, summary });
    }

    missing.sort((a, b) => {
      if (a.quotaProfile.label !== b.quotaProfile.label) {
        return a.quotaProfile.label.localeCompare(b.quotaProfile.label);
      }

      return (a.member.displayName || a.member.user.username).localeCompare(
        b.member.displayName || b.member.user.username,
      );
    });

    const shown = missing.slice(0, 20);

    const listLines = missing.length
      ? shown.flatMap(({ member, quotaProfile, summary }) => [
          `• ${getTeamEmoji(quotaProfile)} **${member.displayName || member.user.username}**`,
          `  ${getTeamDisplayLabel(quotaProfile)}`,
          ...buildRequirementChecks(summary, quotaProfile).map((line) => `  ${line}`),
          '',
        ])
      : ['All Glace Interns+ have met quota for the selected week.'];

    const embed = new EmbedBuilder()
      .setColor(0x1d4ed8)
      .setTitle(`💠 Activity List • ${isCurrent ? 'Current Week' : 'Last Week'}`)
      .setDescription(
        `Below is the current list of members who have not met quota.\n\n${buildSectionBox(
          listLines.length && listLines[listLines.length - 1] === ''
            ? listLines.slice(0, -1)
            : listLines,
        )}`,
      )
      .addFields({
        name: '📅 Week Window',
        value: buildSectionBox([
          `${formatRangeLabel(selectedRange)}`,
          'Monday 12:00 AM → Sunday 11:59 PM',
          `${TIME_ZONE}`,
        ]),
      })
      .setFooter({
        text:
          missing.length > shown.length
            ? `Showing ${shown.length} of ${missing.length} members below quota.`
            : `${missing.length} members below quota.`,
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
