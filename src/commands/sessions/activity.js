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

function buildDetailedQuota(profile) {
  const q = profile.quota;
  const lines = [`${profile.label}: ${q.total} Sessions`, ''];

  if (profile.key === 'intern') {
    lines.push('1 Interview');
    lines.push('1 Training');
    lines.push('- Must be balanced.');
    return lines;
  }

  if (profile.key === 'management') {
    lines.push('1 Interview');
    lines.push('2 Training');
    lines.push('or');
    lines.push('2 Interview');
    lines.push('1 Training');
    lines.push('- Must be balanced.');
    return lines;
  }

  if (profile.key === 'senior_management') {
    lines.push('2 Interview');
    lines.push('2 Training');
    lines.push('- Must be balanced.');
    return lines;
  }

  if (profile.key === 'corporate') {
    lines.push('2 Hosted Interview');
    lines.push('2 Hosted Training');
    lines.push('- Must be balanced.');
    return lines;
  }

  if (profile.key === 'corporate_board') {
    lines.push('1 Hosted Interview');
    lines.push('1 Hosted Training');
    lines.push('- Must be balanced.');
    return lines;
  }

  if (profile.key === 'presidential') {
    lines.push('1 Hosted Session');
    return lines;
  }

  if ((q.minInterview || 0) > 0) lines.push(`${q.minInterview} Interview`);
  if ((q.minTraining || 0) > 0) lines.push(`${q.minTraining} Training`);
  return lines;
}

function box(lines) {
  return `╭────────────────────╮\n${lines.map((l) => `│ ${l}`).join('\n')}\n╰────────────────────╯`;
}

function buildProgressBar(current, required, size = 5) {
  if (!required || required <= 0) return '░'.repeat(size);
  const ratio = Math.max(0, Math.min(1, current / required));
  const filled = Math.round(ratio * size);
  return `${'█'.repeat(filled)}${'░'.repeat(size - filled)}`;
}

function buildQuotaProgressLines(source, quota) {
  const totalRequired = quota.total || 0;
  const interviewRequired = quota.minInterview || 0;
  const trainingRequired = quota.minTraining || 0;

  const lines = [
    `Progress: ${buildProgressBar(source.total, totalRequired)} ${source.total}/${totalRequired}`,
  ];

  if (interviewRequired > 0) {
    lines.push(
      `Interviews: ${buildProgressBar(source.interview, interviewRequired)} ${source.interview}/${interviewRequired}`,
    );
  }

  if (trainingRequired > 0) {
    lines.push(
      `Trainings: ${buildProgressBar(source.training, trainingRequired)} ${source.training}/${trainingRequired}`,
    );
  }

  return lines;
}

function getSupportTrainerCount(summary) {
  return summary.roles.trainer || 0;
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

  const met = hasMetQuota(current, quotaProfile);
  const metLast = hasMetQuota(last, quotaProfile);

  const name =
    targetMember.displayName ||
    targetMember.user?.globalName ||
    targetMember.user?.username;

  const currentSource =
    quotaProfile.quota.mode === 'hosted' ? current.hosted : current.support;

  const lastSource =
    quotaProfile.quota.mode === 'hosted' ? last.hosted : last.support;

  const embed = new EmbedBuilder()
    .setColor(met ? 0x1e3a8a : 0x3b82f6)
    .setTitle(`💠 ${name} • Weekly Activity`)
    .setDescription(
      `⏱ Resets Monday 12:00 AM → Sunday 11:59 PM (${TIME_ZONE})`,
    )
    .addFields(
      {
        name: '🏨 Quota',
        value: box([
          `**${getTeamEmoji(quotaProfile)} ${quotaProfile.label}**`,
          '',
          `Mode: ${getModeLabel(quotaProfile)}`,
          '',
          ...buildDetailedQuota(quotaProfile),
        ]),
      },
      {
        name: '📊 Current Week',
        value: box([
          `📅 ${formatRangeLabel(currentRange)}`,
          '',
          `Interviews: ${currentSource.interview}`,
          `Trainings: ${currentSource.training}`,
          `Total: ${currentSource.total}`,
          '',
          ...buildQuotaProgressLines(currentSource, quotaProfile.quota),
          '',
          `Status: ${met ? '✅ Below cleared / Met' : '❌ Below'}`.replace('Below cleared / ', ''),
        ]),
        inline: true,
      },
      {
        name: '📁 Last Week',
        value: box([
          `📅 ${formatRangeLabel(lastRange)}`,
          '',
          `Interviews: ${lastSource.interview}`,
          `Trainings: ${lastSource.training}`,
          `Total: ${lastSource.total}`,
          '',
          ...buildQuotaProgressLines(lastSource, quotaProfile.quota),
          '',
          `Status: ${metLast ? '✅ Met' : '❌ Below'}`,
        ]),
        inline: true,
      },
    )
    .setThumbnail(targetMember.displayAvatarURL({ size: 256 }))
    .setFooter({ text: 'Glace Hotels | Activity System' });

  if (quotaProfile.isCorporatePlus) {
    embed.data.fields[1].value = box([
      `📅 ${formatRangeLabel(currentRange)}`,
      '',
      `Hosted Interviews: ${current.hosted.interview}`,
      `Hosted Trainings: ${current.hosted.training}`,
      `Total Hosted: ${current.hosted.total}`,
      '',
      ...buildQuotaProgressLines(current.hosted, quotaProfile.quota),
      '',
      `Status: ${met ? '✅ Met' : '❌ Below'}`,
    ]);

    embed.data.fields[2].value = box([
      `📅 ${formatRangeLabel(lastRange)}`,
      '',
      `Hosted Interviews: ${last.hosted.interview}`,
      `Hosted Trainings: ${last.hosted.training}`,
      `Total Hosted: ${last.hosted.total}`,
      '',
      ...buildQuotaProgressLines(last.hosted, quotaProfile.quota),
      '',
      `Status: ${metLast ? '✅ Met' : '❌ Below'}`,
    ]);

    embed.addFields(
      {
        name: '🏨 Helped Sessions',
        value: box([
          `Interviews: ${current.support.interview}`,
          `Trainings: ${current.support.training}`,
          `Total: ${current.support.total}`,
        ]),
      },
      {
        name: '👥 This Week',
        value: box([
          `Co-Host: ${current.support.roles.cohost || 0}`,
          `Overseer: ${current.support.roles.overseer || 0}`,
          `Interviewer: ${current.support.roles.interviewer || 0}`,
          `Trainer: ${getSupportTrainerCount(current.support)}`,
          `Supervisor: ${current.support.roles.supervisor || 0}`,
          `Spectator: ${current.support.roles.spectator || 0}`,
        ]),
        inline: true,
      },
      {
        name: '📂 Last Week',
        value: box([
          `Co-Host: ${last.support.roles.cohost || 0}`,
          `Overseer: ${last.support.roles.overseer || 0}`,
          `Interviewer: ${last.support.roles.interviewer || 0}`,
          `Trainer: ${getSupportTrainerCount(last.support)}`,
          `Supervisor: ${last.support.roles.supervisor || 0}`,
          `Spectator: ${last.support.roles.spectator || 0}`,
        ]),
        inline: true,
      },
    );
  }

  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('activity')
    .setDescription('View your activity.'),

  async execute(interaction) {
    const embed = await buildActivityEmbed(interaction, interaction.member);

    if (!embed) {
      return interaction.reply({
        content: 'No quota role found.',
        ephemeral: true,
      });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },

  buildActivityEmbed,
};