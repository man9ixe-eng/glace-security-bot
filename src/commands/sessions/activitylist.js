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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('activitylist')
    .setDescription('Show members who have not met their current week quota.'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    await ensureActivityDataFresh(interaction.client, interaction.guild);

    const members = await interaction.guild.members.fetch();
    const currentRange = getWeekRange(0, TIME_ZONE);
    const missing = [];

    for (const member of members.values()) {
      if (member.user?.bot) continue;

      const quotaProfile = getQuotaProfileForMember(member);
      if (!quotaProfile) continue;

      const sessions = getUserSessions(member.id);
      const summary = summarizeSessions(sessions, currentRange);
      if (hasMetQuota(summary, quotaProfile.quota)) continue;

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

    const pages = [];
    const chunkSize = 18;
    for (let i = 0; i < missing.length; i += chunkSize) {
      pages.push(missing.slice(i, i + chunkSize));
    }

    const page = pages[0] || [];

    const description = page.length
      ? page
          .map(({ member, quotaProfile, summary }) => {
            const bits = [
              `🌷 **${member.displayName}**`,
              `└ **${quotaProfile.label}** • ${summary.total}/${quotaProfile.quota.total} total`,
              `• ${summary.interview}/${quotaProfile.quota.interview || 0} interview`,
              `• ${summary.training}/${quotaProfile.quota.training || 0} training`,
            ];

            if (quotaProfile.corporatePlus) {
              bits.push(`• ${summary.hosting}/${quotaProfile.quota.hosting || 0} hosting`);
            }

            return bits.join(' ');
          })
          .join('\n\n')
      : '🌸 Everyone with a quota-tracked Team role has met quota for the current week.';

    const embed = new EmbedBuilder()
      .setColor(0xffb6f2)
      .setTitle('✨ Activity List • Members Below Quota')
      .setDescription(description)
      .addFields({
        name: '📅 Current Week',
        value: `${formatRangeLabel(currentRange, TIME_ZONE)}\nTimezone: **${TIME_ZONE}**`,
      })
      .setFooter({
        text: missing.length > page.length
          ? `Showing ${page.length} of ${missing.length} members below quota.`
          : `${missing.length} members below quota.`,
      });

    await interaction.editReply({ embeds: [embed] });
  },
};
