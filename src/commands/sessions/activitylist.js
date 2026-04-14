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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('activitylist')
    .setDescription('Show members who have not met their current week quota.'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const members = await interaction.guild.members.fetch();
    const currentRange = getWeekRange(0, TIME_ZONE);
    const missing = [];

    for (const member of members.values()) {
      if (member.user?.bot) continue;

      const quotaProfile = getQuotaProfileForMember(member);
      if (!quotaProfile) continue;

      const sessions = getUserSessions(member.id);
      const summary = summarizeSessions(sessions, currentRange);
      const metQuota = hasMetQuota(summary, quotaProfile.quota);
      if (metQuota) continue;

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

    const shown = missing.slice(0, 25);

    const embed = new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle('Activity List | Missing Quota')
      .setDescription(
        missing.length
          ? shown
              .map(({ member, quotaProfile, summary }) =>
                `• **${member.displayName}** — ${quotaProfile.label} — ${summary.total}/${quotaProfile.quota.total} total, ${summary.interview}/${quotaProfile.quota.interview} interview, ${summary.training}/${quotaProfile.quota.training} training`,
              )
              .join('\n')
          : 'Everyone with a quota-tracked role has currently met quota.'
      )
      .addFields({
        name: 'Week Window',
        value: `${formatRangeLabel(currentRange, TIME_ZONE)} (${TIME_ZONE})`,
      })
      .setFooter({
        text: missing.length > shown.length ? `Showing ${shown.length} of ${missing.length} members below quota.` : `${missing.length} members below quota.`,
      });

    await interaction.editReply({ embeds: [embed] });
  },
};
