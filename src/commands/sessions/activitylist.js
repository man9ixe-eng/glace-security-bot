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
  corporate_intern: '<:corp_team:1478642239155474533>',
  junior_corporate: '<:corp_team:1478642239155474533>',
  head_corporate: '<:corp_team:1478642239155474533>',
  corporate_board: '<:board_team:1476915796730187868>',
  presidential: '<:pres_team:1476915718644699136>',
};

function getTeamEmoji(profile) {
  return TEAM_EMOJIS[profile?.key] || '🔹';
}

function getModeLabel(profile) {
  switch (profile?.quota?.mode) {
    case 'regular':
      return 'Support';
    case 'cohost':
      return 'Co-Host';
    case 'hosted':
      return 'Host';
    case 'head_corporate_mixed':
      return 'Host + Overseer';
    case 'overseer_only':
      return 'Overseer';
    case 'combined_any':
      return 'Any Counted Session';
    default:
      return profile?.isCorporatePlus ? 'Host' : 'Support';
  }
}

function buildSectionBox(lines) {
  return `╭────────────────────╮\n${lines.map((line) => `│ ${line}`).join('\n')}\n╰────────────────────╯`;
}

function buildRequirementChecks(summary, quotaProfile) {
  const source = getQuotaSource(summary, quotaProfile);
  const quota = quotaProfile.quota || {};

  if (quota.mode === 'head_corporate_mixed') {
    return [
      `Hosted: ${source.hostedTotal || 0}/${quota.hostedTotal || 0} ${(source.hostedTotal || 0) >= (quota.hostedTotal || 0) ? '✅' : '❌'}`,
      `Hosted Interviews: ${source.hostedInterview || 0}/${quota.hostedInterview || 0} ${(source.hostedInterview || 0) >= (quota.hostedInterview || 0) ? '✅' : '❌'}`,
      `Hosted Trainings: ${source.hostedTraining || 0}/${quota.hostedTraining || 0} ${(source.hostedTraining || 0) >= (quota.hostedTraining || 0) ? '✅' : '❌'}`,
      `Overseers: ${source.overseerTotal || 0}/${quota.minOverseer || 0} ${(source.overseerTotal || 0) >= (quota.minOverseer || 0) ? '✅' : '❌'}`,
    ];
  }

  if (quota.mode === 'overseer_only') {
    const required = quota.minOverseer || quota.total || 0;
    return [
      `Overseers: ${source.overseerTotal || 0}/${required} ${(source.overseerTotal || 0) >= required ? '✅' : '❌'}`,
    ];
  }

  const totalRequired = quota.total || 0;
  const interviewRequired = quota.minInterview || 0;
  const trainingRequired = quota.minTraining || 0;

  const lines = [
    `Total: ${source.total || 0}/${totalRequired} ${(source.total || 0) >= totalRequired ? '✅' : '❌'}`,
  ];

  if (interviewRequired > 0) {
    lines.push(
      `Interviews: ${source.interview || 0}/${interviewRequired} ${(source.interview || 0) >= interviewRequired ? '✅' : '❌'}`,
    );
  }

  if (trainingRequired > 0) {
    lines.push(
      `Trainings: ${source.training || 0}/${trainingRequired} ${(source.training || 0) >= trainingRequired ? '✅' : '❌'}`,
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
          return [
            `• ${getTeamEmoji(quotaProfile)} **${member.displayName || member.user.username}**`,
            `  ${quotaProfile.label} • ${getModeLabel(quotaProfile)}`,
            ...buildRequirementChecks(summary, quotaProfile).map((line) => `  ${line}`),
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