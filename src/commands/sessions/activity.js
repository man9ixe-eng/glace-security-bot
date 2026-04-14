const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  getUserSessions,
  getQuotaProfileForMember,
  getWeekRange,
  summarizeSessions,
  hasMetQuota,
  formatRangeLabel,
  TIME_ZONE,
} = require('../../utils/activityTracker');

function buildActivityEmbed(member, targetUser) {
  const quotaProfile = getQuotaProfileForMember(member);
  if (!quotaProfile) return null;

  const sessions = getUserSessions(targetUser.id);
  const currentRange = getWeekRange(0, TIME_ZONE);
  const lastRange = getWeekRange(-1, TIME_ZONE);
  const currentSummary = summarizeSessions(sessions, currentRange);
  const lastSummary = summarizeSessions(sessions, lastRange);
  const metQuota = hasMetQuota(currentSummary, quotaProfile.quota);

  return new EmbedBuilder()
    .setColor(metQuota ? 0x2ecc71 : 0xe74c3c)
    .setTitle(`${targetUser.displayName || targetUser.user?.globalName || targetUser.user?.username || targetUser.username} | Activity Log`)
    .setDescription(`Weekly activity is tracked in **${TIME_ZONE}** and resets every **Monday at 12:00 AM**.`)
    .addFields(
      {
        name: `Current Week (${formatRangeLabel(currentRange, TIME_ZONE)})`,
        value:
          `Hosted Total: **${currentSummary.total}/${quotaProfile.quota.total}**\n` +
          `Interview: **${currentSummary.interview}/${quotaProfile.quota.interview}**\n` +
          `Training: **${currentSummary.training}/${quotaProfile.quota.training}**`,
        inline: true,
      },
      {
        name: `Last Week (${formatRangeLabel(lastRange, TIME_ZONE)})`,
        value:
          `Hosted Total: **${lastSummary.total}**\n` +
          `Interview: **${lastSummary.interview}**\n` +
          `Training: **${lastSummary.training}**`,
        inline: true,
      },
      {
        name: 'Quota Status',
        value: metQuota ? '✅ Met current week quota' : '❌ Has not met current week quota',
      },
      {
        name: 'Quota Tier',
        value:
          `**${quotaProfile.label}**\n` +
          `Required: **${quotaProfile.quota.total} total** / **${quotaProfile.quota.interview} interview** / **${quotaProfile.quota.training} training**`,
      },
    )
    .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
    .setFooter({ text: 'Only logged sessions count toward quota.' });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('activity')
    .setDescription('View your current and previous week activity.'),

  async execute(interaction) {
    const embed = buildActivityEmbed(interaction.member, interaction.member);

    if (!embed) {
      await interaction.reply({
        content: 'You do not have a quota-tracked role on this server.',
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },

  buildActivityEmbed,
};
