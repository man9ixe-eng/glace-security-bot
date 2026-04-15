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
} = require('../../utils/activityTracker');

const TEAM_EMOJIS = {
  intern: ':intern_team:',
  management: ':manager_team:',
  senior_management: ':senior_team:',
  corporate: ':corp_team:',
  corporate_board: ':board_team:',
  presidential: ':pres_team:',
};

function getTeamEmoji(profile) {
  return TEAM_EMOJIS[profile?.key] || '🔹';
}

function getModeLabel(profile) {
  return profile?.isCorporatePlus ? 'Host' : 'Attendee';
}

function buildSectionBox(lines) {
  return `╭────────────────────╮\n${lines.map((line) => `│ ${line}`).join('\n')}\n╰────────────────────╯`;
}

function buildRequirementChecks(summary, quotaProfile) {
  const source =
    quotaProfile.quota.mode === 'hosted' ? summary.hosted : summary.support;

  const totalRequired = quotaProfile.quota.total || 0;
  const interviewRequired = quotaProfile.quota.minInterview || 0;
  const trainingRequired = quotaProfile.quota.minTraining || 0;

  const lines = [
    `Total: ${source.total}/${totalRequired} ${source.total >= totalRequired ? '✅' : '❌'}`,
  ];

  if (interviewRequired > 0) {
    lines.push(
      `Interviews: ${source.interview}/${interviewRequired} ${source.interview >= interviewRequired ? '✅' : '❌'}`,
    );
  }

  if (trainingRequired > 0) {
    lines.push(
      `Trainings: ${source.training}/${trainingRequired} ${source.training >= trainingRequired ? '✅' : '❌'}`,
    );
  }

  return lines;
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

      missing.push({
        member,
        quotaProfile,
        summary,
      });
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
      ? shown.flatMap(({ member, quotaProfile, summary }) => {
          const source =
            quotaProfile.quota.mode === 'hosted'
              ? summary.hosted
              : summary.support;

          return [
            `• ${getTeamEmoji(quotaProfile)} **${member.displayName || member.user.username}**`,
            `  ${quotaProfile.label} • ${getModeLabel(quotaProfile)}`,
            ...buildRequirementChecks(
              { hosted: source, support: source },
              {
                quota: quotaProfile.quota,
                quotaProfile,
                quotaMode: quotaProfile.quota.mode,
              },
            ).map((line) => `  ${line}`),
            '',
          ];
        })
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
          `Monday 12:00 AM → Sunday 11:59 PM`,
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