
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  TIME_ZONE,
  getQuotaProfileForMember,
  getUserActivity,
  getWeekRange,
  summarizeActivity,
  hasMetQuota,
  formatRangeLabel,
} = require('../../utils/activityTracker');

function formatQuotaLine(quotaProfile) {
  const quota = quotaProfile.quota;
  const base = [`${quota.total} total`];
  if ((quota.minInterview || 0) > 0) base.push(`${quota.minInterview} interview`);
  if ((quota.minTraining || 0) > 0) base.push(`${quota.minTraining} training`);
  return base.join(' • ');
}

function formatSupportRoles(summary) {
  const labels = [
    ['cohost', 'Co-Host'],
    ['overseer', 'Overseer'],
    ['interviewer', 'Main Role'],
    ['supervisor', 'Supervisor'],
    ['spectator', 'Spectator'],
  ];

  const parts = labels
    .map(([key, label]) => `${label}: **${summary.roles[key] || 0}**`)
    .join('\n');

  return (
    `${parts}\n` +
    `Interviews: **${summary.interview}**\n` +
    `Trainings: **${summary.training}**\n` +
    `Total Help Sessions: **${summary.total}**`
  );
}

function buildSectionBox(lines) {
  return `╭────────────────────╮\n${lines.map((line) => `│ ${line}`).join('\n')}\n╰────────────────────╯`;
}

function buildActivityEmbed(member, targetMember) {
  const quotaProfile = getQuotaProfileForMember(targetMember);
  if (!quotaProfile) return null;

  const currentRange = getWeekRange(0, TIME_ZONE);
  const lastRange = getWeekRange(-1, TIME_ZONE);
  const activity = getUserActivity(targetMember.id);
  const current = summarizeActivity(activity, currentRange);
  const last = summarizeActivity(activity, lastRange);
  const metQuota = hasMetQuota(current, quotaProfile);

  const displayName =
    targetMember.displayName ||
    targetMember.user?.globalName ||
    targetMember.user?.username ||
    targetMember.username;

  const quotaSource = quotaProfile.quota.mode === 'hosted' ? current.hosted : current.support;
  const lastQuotaSource = quotaProfile.quota.mode === 'hosted' ? last.hosted : last.support;

  const embed = new EmbedBuilder()
    .setColor(metQuota ? 0xf7b2ff : 0xffc5d9)
    .setTitle(`✨ ${displayName} • Activity Panel`)
    .setDescription(
      `Weekly tracking resets every **Monday at 12:00 AM ${TIME_ZONE}** and ends every **Sunday at 11:59 PM ${TIME_ZONE}**.\n` +
      `Current tracked week: **${formatRangeLabel(currentRange, TIME_ZONE)}**`,
    )
    .addFields(
      {
        name: '🌸 Quota Tier',
        value: buildSectionBox([
          `${quotaProfile.label}`,
          `Quota Type: ${quotaProfile.quota.mode === 'hosted' ? 'Hosted Sessions' : 'Regular Sessions'}`,
          `Required: ${formatQuotaLine(quotaProfile)}`,
        ]),
      },
      {
        name: '💫 Current Week',
        value: buildSectionBox([
          `Interviews: **${quotaSource.interview}**`,
          `Trainings: **${quotaSource.training}**`,
          `Total: **${quotaSource.total}**`,
          `Status: ${metQuota ? '✅ Met quota' : '❌ Below quota'}`,
        ]),
        inline: true,
      },
      {
        name: '🫧 Last Week',
        value: buildSectionBox([
          `Interviews: **${lastQuotaSource.interview}**`,
          `Trainings: **${lastQuotaSource.training}**`,
          `Total: **${lastQuotaSource.total}**`,
        ]),
        inline: true,
      },
    )
    .setThumbnail(targetMember.displayAvatarURL({ size: 256 }))
    .setFooter({ text: 'Hosted sessions count for Corporate+ quota. Regular helper roles count for non-Corporate quotas.' });

  if (quotaProfile.isCorporatePlus) {
    embed.addFields(
      {
        name: '🏨 Hosted Sessions',
        value: buildSectionBox([
          `Hosted Interviews: **${current.hosted.interview}**`,
          `Hosted Trainings: **${current.hosted.training}**`,
          `Total Hosted: **${current.hosted.total}**`,
        ]),
        inline: true,
      },
      {
        name: '🤝 Helped Other Hosts',
        value: buildSectionBox([
          `Co-Host: **${current.support.roles.cohost || 0}**`,
          `Overseer: **${current.support.roles.overseer || 0}**`,
          `Main Role: **${current.support.roles.interviewer || 0}**`,
          `Supervisor: **${current.support.roles.supervisor || 0}**`,
          `Spectator: **${current.support.roles.spectator || 0}**`,
          `Total Help Sessions: **${current.support.total}**`,
        ]),
      },
      {
        name: '🌙 Last Week Helper Activity',
        value: buildSectionBox([
          `Co-Host: **${last.support.roles.cohost || 0}**`,
          `Overseer: **${last.support.roles.overseer || 0}**`,
          `Main Role: **${last.support.roles.interviewer || 0}**`,
          `Supervisor: **${last.support.roles.supervisor || 0}**`,
          `Spectator: **${last.support.roles.spectator || 0}**`,
          `Total Help Sessions: **${last.support.total}**`,
        ]),
      },
    );
  }

  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('activity')
    .setDescription('View your current and previous week activity.'),

  async execute(interaction) {
    const embed = buildActivityEmbed(interaction.member, interaction.member);

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
