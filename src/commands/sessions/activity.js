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
  return `╭────────────────────────╮\n${lines.map((line) => `│ ${line}`).join('\n')}\n╰────────────────────────╯`;
}

function buildProgressBar(current, required, size = 5) {
  if (!required || required <= 0) return '░'.repeat(size);
  const ratio = Math.max(0, Math.min(1, Number(current || 0) / Number(required || 0)));
  const filled = Math.round(ratio * size);
  return `${'█'.repeat(filled)}${'░'.repeat(size - filled)}`;
}

function cleanNumber(value) {
  return Number(value || 0);
}

function roleCounts(summary, roleKey) {
  if (roleKey === 'host') {
    return summary.hosted.rolesBySession?.host || { total: 0, interview: 0, training: 0, shift: 0 };
  }

  return summary.support.rolesBySession?.[roleKey] || { total: 0, interview: 0, training: 0, shift: 0 };
}

function countForRoleType(summary, roleKey, sessionType) {
  return cleanNumber(roleCounts(summary, roleKey)[sessionType]);
}

function shouldShowRole(profile, roleKey) {
  return (profile.visibleRoleKeys || []).includes(roleKey);
}

function buildQuotaLines(profile) {
  const q = profile.quota || {};
  const lines = [`${getTeamEmoji(profile)} ${profile.label}`];

  if (q.total > 0 && q.mode === 'regular') lines.push(`- ${q.total} Total Sessions`);
  if (q.mode === 'regular_and_cohost') {
    lines.push(`- ${(q.total || 0) + (q.cohostTotal || 0)} Total Sessions`);
    if (q.total > 0) lines.push(`- ${q.total} Non-Co-Host Sessions`);
  }
  if (q.hostedTotal > 0) lines.push(`- ${q.hostedTotal} Hosted Sessions`);
  if (q.cohostTotal > 0) lines.push(`- ${q.cohostTotal} Co-Host Sessions`);
  if (q.minOverseer > 0) lines.push(`- ${q.minOverseer} Overseer Sessions`);
  if (q.shiftMinutes > 0) lines.push(`- ${q.shiftMinutes} Shift Minutes`);

  if (lines.length === 1) lines.push('- No quota set');

  return lines;
}

function sectionRoleLines(summary, profile, section) {
  const roleOrder = {
    interview: ['host', 'cohost', 'overseer', 'interviewer'],
    training: ['host', 'cohost', 'overseer', 'supervisor', 'trainer', 'helper'],
    shift: ['host', 'cohost', 'overseer', 'attendee'],
  };

  const labels = {
    host: 'Host',
    cohost: 'Co-Host',
    overseer: 'Overseer',
    supervisor: 'Supervisor',
    trainer: 'Trainer',
    interviewer: 'Interviewer',
    helper: 'Helper',
    attendee: 'Attendee',
  };

  return (roleOrder[section] || [])
    .filter((roleKey) => shouldShowRole(profile, roleKey))
    .map((roleKey) => `- ${labels[roleKey]}: ${countForRoleType(summary, roleKey, section)}`);
}

function addProgressGroup(lines, title, progressLines) {
  const usable = progressLines.filter(Boolean);
  if (!usable.length) return;
  lines.push(`${title}:`);
  for (const line of usable) lines.push(line);
}

function progressLine(label, current, required) {
  if (!required || required <= 0) return null;
  return `${label} ${buildProgressBar(current, required)} ${cleanNumber(current)}/${cleanNumber(required)}`;
}

function buildRoleQuotaProgressLines(summary, source, profile) {
  const q = profile.quota || {};
  const lines = [];

  if (q.mode === 'regular') {
    if (q.minInterview > 0) {
      addProgressGroup(lines, 'Interviewer', [
        progressLine('Interview', countForRoleType(summary, 'interviewer', 'interview'), q.minInterview),
      ]);
    }

    if (q.minTraining > 0) {
      addProgressGroup(lines, 'Trainer', [
        progressLine('Training', cleanNumber(source.training), q.minTraining),
      ]);
    }

    if ((q.total || 0) > (q.minInterview || 0) + (q.minTraining || 0)) {
      lines.push(progressLine('Total Sessions', source.total, q.total));
    }
  }

  if (q.mode === 'regular_and_cohost') {
    const regularProgress = [];
    if ((q.minInterview || 0) > 0) {
      regularProgress.push(progressLine('Interview', source.regularInterview, q.minInterview));
    }
    if ((q.minTraining || 0) > 0) {
      regularProgress.push(progressLine('Training', source.regularTraining, q.minTraining));
    }
    if (!regularProgress.length) {
      regularProgress.push(progressLine('Session', source.regularTotal, q.total));
    } else if ((q.total || 0) > (q.minInterview || 0) + (q.minTraining || 0)) {
      regularProgress.push(progressLine('Total Non-Co-Host', source.regularTotal, q.total));
    }
    addProgressGroup(lines, 'Non-Co-Host', regularProgress);
  }

  if ((q.hostedTotal || 0) > 0) {
    const hostedProgress = [];
    if ((q.hostedInterview || 0) > 0) {
      hostedProgress.push(progressLine('Interview', source.hostedInterview, q.hostedInterview));
    }
    if ((q.hostedTraining || 0) > 0) {
      hostedProgress.push(progressLine('Training', source.hostedTraining, q.hostedTraining));
    }
    if (!hostedProgress.length) {
      hostedProgress.push(progressLine('Session', source.hostedTotal, q.hostedTotal));
    } else if ((q.hostedTotal || 0) > (q.hostedInterview || 0) + (q.hostedTraining || 0)) {
      hostedProgress.push(progressLine('Total Hosted', source.hostedTotal, q.hostedTotal));
    }
    addProgressGroup(lines, 'Host', hostedProgress);
  }

  if ((q.cohostTotal || 0) > 0) {
    const cohostProgress = [];
    if ((q.cohostInterview || 0) > 0) {
      cohostProgress.push(progressLine('Interview', source.cohostInterview, q.cohostInterview));
    }
    if ((q.cohostTraining || 0) > 0) {
      cohostProgress.push(progressLine('Training', source.cohostTraining, q.cohostTraining));
    }
    if (!cohostProgress.length) {
      cohostProgress.push(progressLine('Session', source.cohostTotal, q.cohostTotal));
    } else if ((q.cohostTotal || 0) > (q.cohostInterview || 0) + (q.cohostTraining || 0)) {
      cohostProgress.push(progressLine('Total Co-Host', source.cohostTotal, q.cohostTotal));
    }
    addProgressGroup(lines, 'Co-Host', cohostProgress);
  }

  if ((q.minOverseer || 0) > 0) {
    const overseerProgress = [];
    if ((q.overseerInterview || 0) > 0) {
      overseerProgress.push(progressLine('Interview', source.overseerInterview, q.overseerInterview));
    }
    if ((q.overseerTraining || 0) > 0) {
      overseerProgress.push(progressLine('Training', source.overseerTraining, q.overseerTraining));
    }
    if (!overseerProgress.length) {
      overseerProgress.push(progressLine('Session', source.overseerTotal, q.minOverseer));
    } else if ((q.minOverseer || 0) > (q.overseerInterview || 0) + (q.overseerTraining || 0)) {
      overseerProgress.push(progressLine('Total Overseer', source.overseerTotal, q.minOverseer));
    }
    addProgressGroup(lines, 'Overseer', overseerProgress);
  }

  if ((q.shiftMinutes || 0) > 0) {
    lines.push(progressLine('Shift Minutes:', source.shiftMinutes || 0, q.shiftMinutes));
  }

  return lines.filter(Boolean);
}

function buildWeekBox(range, summary, source, profile, met) {
  const interviewLines = sectionRoleLines(summary, profile, 'interview');
  const trainingLines = sectionRoleLines(summary, profile, 'training');
  const shiftLines = sectionRoleLines(summary, profile, 'shift');
  const progressLines = buildRoleQuotaProgressLines(summary, source, profile);

  return box([
    `📅 ${formatRangeLabel(range)}`,
    '',
    `${TYPE_DOTS.interview} Interviews`,
    ...(interviewLines.length ? interviewLines : ['- None: 0']),
    '',
    `${TYPE_DOTS.training} Trainings`,
    ...(trainingLines.length ? trainingLines : ['- None: 0']),
    '',
    `${TYPE_DOTS.shift} Shift Minutes: ${source.shiftMinutes || 0}`,
    ...(shiftLines.length ? shiftLines : ['- None: 0']),
    '',
    ...(progressLines.length ? progressLines : ['No quota progress lines set.']),
    '',
    `Status: ${met ? '✅ Met' : '❌ Below'}`,
  ]);
}

function buildOverviewBox(current, source) {
  return box([
    `${TYPE_DOTS.interview} Interviews: ${source.interview || 0}`,
    `${TYPE_DOTS.training} Trainings: ${source.training || 0}`,
    `Total Sessions: ${source.total || 0}`,
    '',
    `${TYPE_DOTS.shift} Shift Minutes: ${source.shiftMinutes || 0}`,
    `Tracked Helped Sessions: ${current.support.total || 0}`,
  ]);
}

function buildCoHostSection(current, last) {
  const currentCounts = current.support.rolesBySession?.cohost || { total: 0, interview: 0, training: 0, shift: 0 };
  const lastCounts = last.support.rolesBySession?.cohost || { total: 0, interview: 0, training: 0, shift: 0 };

  return box([
    `Current Week: ${currentCounts.total || 0} total`,
    `- ${TYPE_DOTS.interview} Interviews: ${currentCounts.interview || 0}`,
    `- ${TYPE_DOTS.training} Trainings: ${currentCounts.training || 0}`,
    `- ${TYPE_DOTS.shift} Shifts: ${currentCounts.shift || 0}`,
    '',
    `Last Week: ${lastCounts.total || 0} total`,
    `- ${TYPE_DOTS.interview} Interviews: ${lastCounts.interview || 0}`,
    `- ${TYPE_DOTS.training} Trainings: ${lastCounts.training || 0}`,
    `- ${TYPE_DOTS.shift} Shifts: ${lastCounts.shift || 0}`,
  ]);
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

  const currentQuotaSource = getQuotaSource(current, quotaProfile);
  const lastQuotaSource = getQuotaSource(last, quotaProfile);

  const met = hasMetQuota(current, quotaProfile);
  const metLast = hasMetQuota(last, quotaProfile);

  const name =
    targetMember.displayName ||
    targetMember.user?.globalName ||
    targetMember.user?.username;

  const fields = [
    {
      name: '🏨 Quota',
      value: box(buildQuotaLines(quotaProfile)),
    },
    {
      name: '📊 Current Week',
      value: buildWeekBox(currentRange, current, currentQuotaSource, quotaProfile, met),
    },
    {
      name: '📁 Last Week',
      value: buildWeekBox(lastRange, last, lastQuotaSource, quotaProfile, metLast),
    },
    {
      name: '🏨 Overview',
      value: buildOverviewBox(current, currentQuotaSource),
    },
  ];

  if (CORPORATE_INTERN_PLUS_KEYS.has(quotaProfile.key)) {
    fields.splice(3, 0, {
      name: '🤝 Co-Host Sessions',
      value: buildCoHostSection(current, last),
    });
  }

  const embed = new EmbedBuilder()
    .setColor(getTeamColor(quotaProfile, met))
    .setTitle(`${getTeamEmoji(quotaProfile)}  ${name} • Activity ${getTeamEmoji(quotaProfile)}`)
    .setDescription(
      `⏱ Resets Monday 12:00 AM → Sunday 11:59 PM (EST)\n\n${TYPE_DOTS.interview} Interview • ${TYPE_DOTS.training} Training • ${TYPE_DOTS.shift} Shift`,
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
