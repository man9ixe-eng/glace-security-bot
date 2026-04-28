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

const TYPE_DOTS = {
  interview: '🟡',
  training: '🔴',
  shift: '🟣',
};

const CORPORATE_INTERN_PLUS_KEYS = new Set([
  'corporate_intern',
  'junior_corporate',
  'head_corporate',
  'corporate_board',
  'presidential',
]);

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
      return 'Support';
  }
}

function getTeamColor(profile, metQuota) {
  const colors = {
    presidential: metQuota ? 0xFFD700 : 0xC9A227,
    corporate_board: metQuota ? 0xFF8C00 : 0xCC7000,
    head_corporate: metQuota ? 0xFF3B3B : 0xCC2F2F,
    junior_corporate: metQuota ? 0xEF4444 : 0xB91C1C,
    corporate_intern: metQuota ? 0xF87171 : 0xDC2626,
    senior_management: metQuota ? 0x22C55E : 0x16A34A,
    management: metQuota ? 0x8B5CF6 : 0x6D28D9,
    intern: metQuota ? 0xEC4899 : 0xC026D3,
  };

  return colors[profile?.key] || 0x3b82f6;
}

function box(lines) {
  return `╭────────────────────────╮\n${lines.map((l) => `│ ${l}`).join('\n')}\n╰────────────────────────╯`;
}

function buildProgressBar(current, required, size = 5) {
  if (!required || required <= 0) return '░'.repeat(size);
  const ratio = Math.max(0, Math.min(1, current / required));
  const filled = Math.round(ratio * size);
  return `${'█'.repeat(filled)}${'░'.repeat(size - filled)}`;
}

function buildDetailedQuota(profile) {
  const q = profile.quota || {};
  const lines = [`${profile.label}: ${q.total || 0} Sessions`, ''];

  if (profile.key === 'intern') {
    lines.push(`${TYPE_DOTS.interview} 1 Interview`);
    lines.push(`${TYPE_DOTS.training} 1 Training`);
    lines.push('Spectator does not count.');
    return lines;
  }

  if (profile.key === 'management') {
    lines.push('3 Support Sessions');
    lines.push('Balanced mix recommended.');
    lines.push('Spectator does not count.');
    return lines;
  }

  if (profile.key === 'senior_management') {
    lines.push(`${TYPE_DOTS.interview} 2 Interviews`);
    lines.push(`${TYPE_DOTS.training} 2 Trainings`);
    lines.push('Spectator does not count.');
    return lines;
  }

  if (profile.key === 'corporate_intern') {
    lines.push('2 Co-Hosted Sessions');
    lines.push(`${TYPE_DOTS.interview} 1 Co-Hosted Interview`);
    lines.push(`${TYPE_DOTS.training} 1 Co-Hosted Training`);
    lines.push('Other roles are extra only.');
    return lines;
  }

  if (profile.key === 'junior_corporate') {
    lines.push('2 Hosted Sessions');
    lines.push(`${TYPE_DOTS.interview} 1 Hosted Interview`);
    lines.push(`${TYPE_DOTS.training} 1 Hosted Training`);
    lines.push('Co-Host does not count toward quota.');
    return lines;
  }

  if (profile.key === 'head_corporate') {
    lines.push('1 Overseered Session');
    lines.push('2 Hosted Sessions');
    lines.push(`${TYPE_DOTS.interview} 1 Hosted Interview`);
    lines.push(`${TYPE_DOTS.training} 1 Hosted Training`);
    return lines;
  }

  if (profile.key === 'corporate_board') {
    lines.push(`${getTeamEmoji(profile)} Overseer-based quota`);
    lines.push('Board Of Director + Presidential Intern');
    lines.push('are tracked here.');
    return lines;
  }

  if (profile.key === 'presidential') {
    lines.push('1 Session Weekly');
    lines.push('Any counted session can satisfy quota.');
    return lines;
  }

  return lines;
}

function buildQuotaProgressLines(source, quota, profileKey) {
  if (profileKey === 'head_corporate') {
    return [
      `Hosted: ${buildProgressBar(source.hostedTotal || 0, quota.hostedTotal || 0)} ${source.hostedTotal || 0}/${quota.hostedTotal || 0}`,
      `${TYPE_DOTS.interview} Hosted Interviews: ${buildProgressBar(source.hostedInterview || 0, quota.hostedInterview || 0)} ${source.hostedInterview || 0}/${quota.hostedInterview || 0}`,
      `${TYPE_DOTS.training} Hosted Trainings: ${buildProgressBar(source.hostedTraining || 0, quota.hostedTraining || 0)} ${source.hostedTraining || 0}/${quota.hostedTraining || 0}`,
      `Overseers: ${buildProgressBar(source.overseerTotal || 0, quota.minOverseer || 0)} ${source.overseerTotal || 0}/${quota.minOverseer || 0}`,
    ];
  }

  if (profileKey === 'corporate_board') {
    const required = quota.minOverseer || quota.total || 0;
    return [
      `Overseers: ${buildProgressBar(source.overseerTotal || 0, required)} ${source.overseerTotal || 0}/${required}`,
    ];
  }

  const totalRequired = quota.total || 0;
  const interviewRequired = quota.minInterview || 0;
  const trainingRequired = quota.minTraining || 0;

  const lines = [
    `Progress: ${buildProgressBar(source.total || 0, totalRequired)} ${source.total || 0}/${totalRequired}`,
  ];

  if (interviewRequired > 0) {
    lines.push(
      `${TYPE_DOTS.interview} Interviews: ${buildProgressBar(source.interview || 0, interviewRequired)} ${source.interview || 0}/${interviewRequired}`,
    );
  }

  if (trainingRequired > 0) {
    lines.push(
      `${TYPE_DOTS.training} Trainings: ${buildProgressBar(source.training || 0, trainingRequired)} ${source.training || 0}/${trainingRequired}`,
    );
  }

  return lines;
}

function formatRoleLabel(roleKey) {
  const map = {
    host: 'Host',
    cohost: 'Co-Host',
    overseer: 'Overseer',
    supervisor: 'Supervisor',
    trainer: 'Trainer',
    interviewer: 'Interviewer',
    spectator: 'Spectator',
    attendee: 'Attendee',
  };
  return map[roleKey] || roleKey;
}

function emptyCounts() {
  return { total: 0, interview: 0, training: 0, shift: 0 };
}

function getRoleCountsForDisplay(summary, roleKey) {
  if (roleKey === 'host') {
    return summary.hosted.rolesBySession?.host || emptyCounts();
  }

  return summary.support.rolesBySession?.[roleKey] || emptyCounts();
}

function formatTypeMix(counts) {
  const parts = [];

  if (counts.interview) parts.push(`${TYPE_DOTS.interview} ${counts.interview}`);
  if (counts.training) parts.push(`${TYPE_DOTS.training} ${counts.training}`);
  if (counts.shift) parts.push(`${TYPE_DOTS.shift} ${counts.shift}`);

  return parts.length ? parts.join(' • ') : 'No interview/training/shift split';
}

function formatTotalMix(counts) {
  return `${counts.total || 0} total • ${TYPE_DOTS.interview} ${counts.interview || 0} • ${TYPE_DOTS.training} ${counts.training || 0} • ${TYPE_DOTS.shift} ${counts.shift || 0}`;
}

function buildRoleBreakdown(summary, visibleRoleKeys) {
  const lines = visibleRoleKeys
    .map((roleKey) => {
      const counts = getRoleCountsForDisplay(summary, roleKey);
      if (!counts.total) return null;

      return `**${formatRoleLabel(roleKey)}:** ${counts.total} total • ${formatTypeMix(counts)}`;
    })
    .filter(Boolean);

  return lines.length ? lines.join('\n') : 'No tracked role activity for this week.';
}

function buildMainSessionLines(summary, source, quotaProfile) {
  if (
    quotaProfile.key === 'junior_corporate' ||
    quotaProfile.key === 'head_corporate' ||
    quotaProfile.key === 'presidential'
  ) {
    return [
      `${TYPE_DOTS.interview} Hosted Interviews: ${summary.hosted.interview}`,
      `${TYPE_DOTS.training} Hosted Trainings: ${summary.hosted.training}`,
      `${TYPE_DOTS.shift} Hosted Shifts: ${summary.hosted.shift || 0}`,
      `Total Hosted: ${summary.hosted.total}`,
    ];
  }

  if (quotaProfile.key === 'corporate_board') {
    return [
      `${TYPE_DOTS.interview} Overseered Interviews: ${source.overseerInterview || 0}`,
      `${TYPE_DOTS.training} Overseered Trainings: ${source.overseerTraining || 0}`,
      `${TYPE_DOTS.shift} Overseered Shifts: ${source.overseerShift || 0}`,
      `Total Overseered: ${source.overseerTotal || 0}`,
    ];
  }

  if (quotaProfile.key === 'corporate_intern') {
    return [
      `${TYPE_DOTS.interview} Co-Hosted Interviews: ${source.interview || 0}`,
      `${TYPE_DOTS.training} Co-Hosted Trainings: ${source.training || 0}`,
      `${TYPE_DOTS.shift} Co-Hosted Shifts: ${source.shift || 0}`,
      `Total Co-Hosted: ${source.total || 0}`,
    ];
  }

  return [
    `${TYPE_DOTS.interview} Interviews: ${source.interview || 0}`,
    `${TYPE_DOTS.training} Trainings: ${source.training || 0}`,
    `${TYPE_DOTS.shift} Shifts: ${source.shift || 0}`,
    `Total: ${source.total || 0}`,
  ];
}

function buildCoHostSection(current, last) {
  const currentCounts = current.support.rolesBySession?.cohost || emptyCounts();
  const lastCounts = last.support.rolesBySession?.cohost || emptyCounts();

  return [
    `Current Week: ${formatTotalMix(currentCounts)}`,
    `Last Week: ${formatTotalMix(lastCounts)}`,
    '',
    'Co-Host is shown for Corporate Intern+.',
  ].join('\n');
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

  const currentQuotaSource = getQuotaSource(current, quotaProfile);
  const lastQuotaSource = getQuotaSource(last, quotaProfile);

  const name =
    targetMember.displayName ||
    targetMember.user?.globalName ||
    targetMember.user?.username;

  const fields = [
    {
      name: '🏨 Quota',
      value: box([
        `${getTeamEmoji(quotaProfile)}  ${quotaProfile.label}`,
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
        ...buildMainSessionLines(current, currentQuotaSource, quotaProfile),
        '',
        ...buildQuotaProgressLines(currentQuotaSource, quotaProfile.quota, quotaProfile.key),
        '',
        `Status: ${met ? '✅ Met' : '❌ Below'}`,
      ]),
      inline: true,
    },
    {
      name: '📁 Last Week',
      value: box([
        `📅 ${formatRangeLabel(lastRange)}`,
        '',
        ...buildMainSessionLines(last, lastQuotaSource, quotaProfile),
        '',
        ...buildQuotaProgressLines(lastQuotaSource, quotaProfile.quota, quotaProfile.key),
        '',
        `Status: ${metLast ? '✅ Met' : '❌ Below'}`,
      ]),
      inline: true,
    },
    {
      name: '🏨 Helped Sessions',
      value: box([
        `${TYPE_DOTS.interview} Interviews: ${current.support.interview}`,
        `${TYPE_DOTS.training} Trainings: ${current.support.training}`,
        `${TYPE_DOTS.shift} Shifts: ${current.support.shift || 0}`,
        `Total: ${current.support.total}`,
      ]),
    },
  ];

  if (CORPORATE_INTERN_PLUS_KEYS.has(quotaProfile.key)) {
    fields.push({
      name: '🤝 Co-Host Sessions',
      value: buildCoHostSection(current, last),
    });
  }

  fields.push(
    {
      name: '👥 Current Week Role Breakdown',
      value: buildRoleBreakdown(current, quotaProfile.visibleRoleKeys || []),
      inline: true,
    },
    {
      name: '📂 Last Week Role Breakdown',
      value: buildRoleBreakdown(last, quotaProfile.visibleRoleKeys || []),
      inline: true,
    },
  );

  const embed = new EmbedBuilder()
    .setColor(getTeamColor(quotaProfile, met))
    .setTitle(`${getTeamEmoji(quotaProfile)} ${name} • Activity`)
    .setDescription(
      `⏱ Resets Monday 12:00 AM → Sunday 11:59 PM (${TIME_ZONE})\n${TYPE_DOTS.interview} Interview • ${TYPE_DOTS.training} Training • ${TYPE_DOTS.shift} Shift`,
    )
    .addFields(fields)
    .setThumbnail(targetMember.displayAvatarURL({ size: 256 }))
    .setFooter({ text: 'Glace Hotels | Activity System' });

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
