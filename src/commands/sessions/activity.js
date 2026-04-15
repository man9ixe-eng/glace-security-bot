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

function formatQuotaLine(quotaProfile) {
  const quota = quotaProfile.quota;
  const parts = [`${quota.total} total`];

  if ((quota.minInterview || 0) > 0) {
    parts.push(`${quota.minInterview} interview`);
  }

  if ((quota.minTraining || 0) > 0) {
    parts.push(`${quota.minTraining} training`);
  }

  return parts.join(' • ');
}

function statBlock(lines) {
  return lines.join('\n');
}

function buildCorporateSupportTypeTotals(summary) {
  const interviewerCount = summary.roles.interviewer || 0;
  const trainerCount = summary.roles.trainer || 0;

  return {
    interviews: interviewerCount,
    trainings: trainerCount,
    total: summary.total || 0,
  };
}

async function buildActivityEmbed(interaction, targetMember) {
  await backfillFromLogChannel(interaction.client);

  const quotaProfile = getQuotaProfileForMember(targetMember);
  if (!quotaProfile) return null;

  const currentRange = getWeekRange(0, TIME_ZONE);
  const lastRange = getWeekRange(-1, TIME_ZONE);

  const activity = getUserActivity(targetMember.id);
  const current = summarizeActivity(activity, currentRange);
  const last = summarizeActivity(activity, lastRange);

  const metCurrentQuota = hasMetQuota(current, quotaProfile);
  const metLastQuota = hasMetQuota(last, quotaProfile);

  const displayName =
    targetMember.displayName ||
    targetMember.user?.globalName ||
    targetMember.user?.username ||
    targetMember.username;

  const quotaSource =
    quotaProfile.quota.mode === 'hosted' ? current.hosted : current.support;

  const lastQuotaSource =
    quotaProfile.quota.mode === 'hosted' ? last.hosted : last.support;

  const embed = new EmbedBuilder()
    .setColor(metCurrentQuota ? 0x1d4ed8 : 0x2563eb)
    .setTitle(`${displayName} • Activity Overview`)
    .setDescription(
      `**Week Window**\n${formatRangeLabel(currentRange)}\n\n` +
        `Tracking resets every Monday at **12:00 AM ${TIME_ZONE}** and ends every Sunday at **11:59 PM ${TIME_ZONE}**.`
    )
    .addFields(
      {
        name: 'Quota Profile',
        value: statBlock([
          `**Tier:** ${quotaProfile.label}`,
          `**Quota Type:** ${
            quotaProfile.quota.mode === 'hosted'
              ? 'Hosted Sessions'
              : 'Regular Sessions'
          }`,
          `**Requirement:** ${formatQuotaLine(quotaProfile)}`,
        ]),
      },
      {
        name: 'Current Week',
        value: statBlock([
          `**Interviews:** ${quotaSource.interview}`,
          `**Trainings:** ${quotaSource.training}`,
          `**Total:** ${quotaSource.total}`,
          `**Status:** ${metCurrentQuota ? '✅ Met quota' : '❌ Below quota'}`,
        ]),
        inline: true,
      },
      {
        name: 'Last Week',
        value: statBlock([
          `**Interviews:** ${lastQuotaSource.interview}`,
          `**Trainings:** ${lastQuotaSource.training}`,
          `**Total:** ${lastQuotaSource.total}`,
          `**Status:** ${metLastQuota ? '✅ Met quota' : '❌ Below quota'}`,
        ]),
        inline: true,
      }
    )
    .setThumbnail(targetMember.displayAvatarURL({ size: 256 }))
    .setFooter({
      text: 'Glace Hotels Activity System',
    })
    .setTimestamp();

  if (quotaProfile.isCorporatePlus) {
    const currentHelpTotals = buildCorporateSupportTypeTotals(current.support);
    const lastHelpTotals = buildCorporateSupportTypeTotals(last.support);

    embed.data.fields[1].value = statBlock([
      `**Hosted Interviews:** ${current.hosted.interview}`,
      `**Hosted Trainings:** ${current.hosted.training}`,
      `**Total Hosted:** ${current.hosted.total}`,
      `**Status:** ${metCurrentQuota ? '✅ Met quota' : '❌ Below quota'}`,
    ]);

    embed.data.fields[2].value = statBlock([
      `**Hosted Interviews:** ${last.hosted.interview}`,
      `**Hosted Trainings:** ${last.hosted.training}`,
      `**Total Hosted:** ${last.hosted.total}`,
      `**Status:** ${metLastQuota ? '✅ Met quota' : '❌ Below quota'}`,
    ]);

    embed.addFields(
      {
        name: 'Support Sessions',
        value: statBlock([
          `**Interviews:** ${currentHelpTotals.interviews}`,
          `**Trainings:** ${currentHelpTotals.trainings}`,
          `**Total Non-Hosted:** ${currentHelpTotals.total}`,
        ]),
      },
      {
        name: 'This Week Support Breakdown',
        value: statBlock([
          `**Co-Host:** ${current.support.roles.cohost || 0}`,
          `**Overseer:** ${current.support.roles.overseer || 0}`,
          `**Interviewer:** ${current.support.roles.interviewer || 0}`,
          `**Trainer:** ${current.support.roles.trainer || 0}`,
          `**Supervisor:** ${current.support.roles.supervisor || 0}`,
          `**Spectator:** ${current.support.roles.spectator || 0}`,
          `**Total Support Sessions:** ${current.support.total}`,
        ]),
        inline: true,
      },
      {
        name: 'Last Week Support Breakdown',
        value: statBlock([
          `**Co-Host:** ${last.support.roles.cohost || 0}`,
          `**Overseer:** ${last.support.roles.overseer || 0}`,
          `**Interviewer:** ${last.support.roles.interviewer || 0}`,
          `**Trainer:** ${last.support.roles.trainer || 0}`,
          `**Supervisor:** ${last.support.roles.supervisor || 0}`,
          `**Spectator:** ${last.support.roles.spectator || 0}`,
          `**Total Support Sessions:** ${last.support.total}`,
        ]),
        inline: true,
      }
    );
  }

  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('activity')
    .setDescription('View your current and previous week activity.'),

  async execute(interaction) {
    const embed = await buildActivityEmbed(interaction, interaction.member);

    if (!embed) {
      await interaction.reply({
        content: 'You do not have a quota-tracked Team role on this server.',
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },

  buildActivityEmbed,
};