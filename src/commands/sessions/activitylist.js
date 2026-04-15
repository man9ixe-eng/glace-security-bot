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

function summarizeAgainstQuota(summary, quotaProfile) {
  const source =
    quotaProfile.quota.mode === 'hosted' ? summary.hosted : summary.support;

  const parts = [`${source.total}/${quotaProfile.quota.total} total`];

  if ((quotaProfile.quota.minInterview || 0) > 0) {
    parts.push(`${source.interview}/${quotaProfile.quota.minInterview} interview`);
  }

  if ((quotaProfile.quota.minTraining || 0) > 0) {
    parts.push(`${source.training}/${quotaProfile.quota.minTraining} training`);
  }

  return parts.join(' • ');
}

function buildSectionBox(lines) {
  return `╭────────────────────╮\n${lines.map((line) => `│ ${line}`).join('\n')}\n╰────────────────────╯`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('activitylist')
    .setDescription('Show members who have not met their current week quota.'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    await backfillFromLogChannel(interaction.client);

    const members = await interaction.guild.members.fetch();
    const currentRange = getWeekRange(0, TIME_ZONE);
    const missing = [];

    for (const member of members.values()) {
      if (member.user?.bot) continue;

      const quotaProfile = getQuotaProfileForMember(member);
      if (!quotaProfile) continue;

      const activity = getUserActivity(member.id);
      const summary = summarizeActivity(activity, currentRange);

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

    const shown = missing.slice(0, 25);

    const listText = missing.length
      ? shown
          .map(({ member, quotaProfile, summary }) => {
            const modeLabel =
              quotaProfile.quota.mode === 'hosted' ? 'Hosted' : 'Regular';

            return `• **${member.displayName || member.user.username}**\n` +
              `  ${quotaProfile.label} • ${modeLabel}\n` +
              `  ${summarizeAgainstQuota(summary, quotaProfile)}`;
          })
          .join('\n\n')
      : 'All Glace Interns+ have met quota for the current week.';

    const embed = new EmbedBuilder()
      .setColor(0x1d4ed8)
      .setTitle('💠 Activity List')
      .setDescription(
        `Below is the current list of members who have not met quota.\n\n${buildSectionBox(
          listText.split('\n')
        )}`,
      )
      .addFields({
        name: '📅 Week Window',
        value: buildSectionBox([
          `${formatRangeLabel(currentRange)}`,
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