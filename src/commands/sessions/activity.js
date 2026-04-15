const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getUserSessions,
  getQuotaProfileForMember,
  getWeekRange,
  summarizeSessions,
  hasMetQuota,
  formatRangeLabel,
  TIME_ZONE,
  ensureActivityDataFresh,
} = require('../../utils/activityTracker');

function quotaBreakdownLines(summary, quotaProfile, includeLiveQuotaStatus = true) {
  const quota = quotaProfile.quota;
  const lines = [
    `🌷 **Total Sessions** • **${summary.total}/${quota.total}**`,
    `🎤 **Interviews** • **${summary.interview}/${quota.interview || 0}**`,
    `🎓 **Trainings** • **${summary.training}/${quota.training || 0}**`,
  ];

  if (quotaProfile.corporatePlus) {
    lines.push(`🏨 **Hosted Requirement** • **${summary.hosting}/${quota.hosting || 0}**`);
  }

  if (includeLiveQuotaStatus) {
    lines.push('', hasMetQuota(summary, quota) ? '✅ **Quota Complete**' : '❌ **Quota Not Met Yet**');
  }

  return lines.join('\n');
}

function buildActivityEmbed(member, targetUser, guild) {
  const quotaProfile = getQuotaProfileForMember(member);
  if (!quotaProfile) return null;

  const sessions = getUserSessions(targetUser.id);
  const currentRange = getWeekRange(0, TIME_ZONE);
  const lastRange = getWeekRange(-1, TIME_ZONE);
  const currentSummary = summarizeSessions(sessions, currentRange);
  const lastSummary = summarizeSessions(sessions, lastRange);
  const metQuota = hasMetQuota(currentSummary, quotaProfile.quota);

  const displayName =
    targetUser.displayName ||
    targetUser.user?.globalName ||
    targetUser.user?.username ||
    targetUser.username;

  return new EmbedBuilder()
    .setColor(metQuota ? 0xffb6f2 : 0xffd166)
    .setTitle(`✨ ${displayName} • Activity Panel`)
    .setDescription(
      '╭───────────── ୨୧ ─────────────╮\n' +
        `📅 **Current Week:** ${formatRangeLabel(currentRange, TIME_ZONE)}\n` +
        `🕰️ Resets every **Monday at 12:00 AM ${TIME_ZONE}**\n` +
        `🗂️ Tier: **${quotaProfile.label}**\n` +
        '╰─────────────────────────────╯',
    )
    .addFields(
      {
        name: '🌸 Current Week',
        value: quotaBreakdownLines(currentSummary, quotaProfile, true),
        inline: true,
      },
      {
        name: '🫧 Last Week',
        value: quotaBreakdownLines(lastSummary, quotaProfile, false),
        inline: true,
      },
      {
        name: '📝 Quota Rules',
        value:
          `• Total required: **${quotaProfile.quota.total}**\n` +
          `• Interview minimum: **${quotaProfile.quota.interview || 0}**\n` +
          `• Training minimum: **${quotaProfile.quota.training || 0}**` +
          (quotaProfile.corporatePlus
            ? `\n• Hosting minimum: **${quotaProfile.quota.hosting || 0}**`
            : ''),
      },
    )
    .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
    .setFooter({
      text: guild?.name ? `${guild.name} • Only logged sessions count` : 'Only logged sessions count',
    });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('activity')
    .setDescription('View your current and previous week activity.'),

  async execute(interaction) {
    await ensureActivityDataFresh(interaction.client, interaction.guild);

    const embed = buildActivityEmbed(interaction.member, interaction.member, interaction.guild);
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
