// src/utils/sessionQueueManager.js

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const { trelloRequest } = require('./trelloClient');
const {
  replaceSessionActivity,
  getAllActivity,
  getWeekRange,
} = require('./activityTracker');
const { upsertSession, getSession } = require('./editActivityStore');

// In-memory registry of active queues, keyed by Trello card shortId.
const queues = new Map();

// Base limits for each role; interviewer is adjusted per sessionType if needed.
const ROLE_LIMITS = {
  cohost: 1,
  overseer: 1,
  interviewer: 12, // default (Interviewers)
  supervisor: 4,
};

// Safety hard-cap (prevents someone from creating massive queues)
const QUEUE_ROLE_HARD_CAP = Number(process.env.SESSION_QUEUE_HARD_CAP || 60);

// Dedicated session logging channel
const SESSION_LOG_CHANNEL_ID = process.env.SESSION_LOG_CHANNEL_ID || null;

// Optional fallback attendees log channel
const SESSION_ATTENDEES_LOG_CHANNEL_ID =
  process.env.SESSION_ATTENDEES_LOG_CHANNEL_ID || null;

const SESSION_LOG_CHANNEL_NAME_FALLBACKS = [
  'session-logs',
  'session-log',
  'session logs',
  'session log',
];

function normalizeChannelLookupName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/[\s_]+/g, '-')
    .trim();
}

async function findTextChannelByName(client, guildId, names = []) {
  const guild = guildId ? await client.guilds.fetch(guildId).catch(() => null) : null;
  if (!guild) return null;

  const channels = await guild.channels.fetch().catch(() => null);
  if (!channels?.size) return null;

  const wanted = new Set(names.map(normalizeChannelLookupName));
  return (
    [...channels.values()].find((channel) => {
      if (!channel?.isTextBased?.()) return false;
      return wanted.has(normalizeChannelLookupName(channel.name));
    }) || null
  );
}

async function resolveSessionLogChannel(client, guildId, fallbackChannelId = null) {
  const configuredIds = [
    SESSION_LOG_CHANNEL_ID,
    SESSION_ATTENDEES_LOG_CHANNEL_ID,
    process.env.SESSION_LOGS_CHANNEL_ID,
    process.env.SESSIONLOGS_CHANNEL_ID,
  ].filter(Boolean);

  for (const channelId of configuredIds) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased?.()) return channel;
  }

  const namedChannel = await findTextChannelByName(
    client,
    guildId,
    SESSION_LOG_CHANNEL_NAME_FALLBACKS,
  );
  if (namedChannel) return namedChannel;

  if (fallbackChannelId) {
    const fallback = await client.channels.fetch(fallbackChannelId).catch(() => null);
    if (fallback?.isTextBased?.()) return fallback;
  }

  return null;
}

function resolveTrelloCardUrl(shortId, queue, cardOptionOrShortId, options = {}) {
  const choices = [
    options.cardUrl,
    queue?.cardUrl,
    cardOptionOrShortId,
    shortId ? `https://trello.com/c/${shortId}` : null,
  ];

  for (const choice of choices) {
    const value = String(choice || '').trim();
    if (!value) continue;

    const urlMatch = value.match(/https?:\/\/[^\s>]+trello\.com\/c\/[a-zA-Z0-9][^\s>]*/i);
    if (urlMatch) return urlMatch[0];

    const shortMatch = value.match(/^([a-zA-Z0-9]{6,10})$/);
    if (shortMatch) return `https://trello.com/c/${shortMatch[1]}`;
  }

  return shortId ? `https://trello.com/c/${shortId}` : 'Unknown';
}

const RANK_LADDER = [
  'Leadership Intern',
  'Supervisor',
  'Assistant Manager',
  'Hotel Manager',
  'Executive Manager',
  'Corporate Intern',
  'Junior Corporate',
  'Senior Corporate',
  'Head Corporate',
  'Board Of Directors',
  'Presidential Intern',
  'CEO',
  'VP',
  'President',
];

function normalizeRoleName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getMemberRankIndex(member) {
  const roles = member?.roles?.cache ? [...member.roles.cache.values()] : [];
  let bestIndex = -1;

  for (const role of roles) {
    const raw = String(role?.name || '');
    const normalized = normalizeRoleName(raw);
    if (!normalized || normalized.includes('former')) continue;

    for (let index = 0; index < RANK_LADDER.length; index += 1) {
      const target = normalizeRoleName(RANK_LADDER[index]);
      if (!target) continue;
      if (normalized.includes(target)) {
        bestIndex = Math.max(bestIndex, index);
      }
    }
  }

  return bestIndex;
}

function hasMinimumRank(member, minimumRank) {
  const requiredIndex = RANK_LADDER.findIndex(
    (rank) => normalizeRoleName(rank) === normalizeRoleName(minimumRank),
  );
  if (requiredIndex === -1) return false;
  return getMemberRankIndex(member) >= requiredIndex;
}

function getAllowedQueueRoles(queue, member) {
  if (!queue || !member) return [];

  if (queue.sessionType === 'training') {
    return [
      hasMinimumRank(member, 'Leadership Intern')
        ? { key: 'interviewer', label: 'Trainer' }
        : null,
      hasMinimumRank(member, 'Assistant Manager')
        ? { key: 'supervisor', label: 'Supervisor' }
        : null,
      hasMinimumRank(member, 'Corporate Intern')
        ? { key: 'cohost', label: 'Co-Host' }
        : null,
      hasMinimumRank(member, 'Head Corporate')
        ? { key: 'overseer', label: 'Overseer' }
        : null,
    ].filter(Boolean);
  }

  if (queue.sessionType === 'massshift') {
    return [
      hasMinimumRank(member, 'Leadership Intern')
        ? { key: 'interviewer', label: 'Attendee' }
        : null,
      hasMinimumRank(member, 'Executive Manager')
        ? { key: 'cohost', label: 'Co-Host' }
        : null,
      hasMinimumRank(member, 'Head Corporate')
        ? { key: 'overseer', label: 'Overseer' }
        : null,
    ].filter(Boolean);
  }

  return [
    hasMinimumRank(member, 'Leadership Intern')
      ? { key: 'interviewer', label: 'Interviewer' }
      : null,
    hasMinimumRank(member, 'Corporate Intern')
      ? { key: 'cohost', label: 'Co-Host' }
      : null,
    hasMinimumRank(member, 'Head Corporate')
      ? { key: 'overseer', label: 'Overseer' }
      : null,
  ].filter(Boolean);
}

function getHeaderEmoji(sessionType) {
  if (sessionType === 'training') return '\uD83D\uDD34';
  if (sessionType === 'massshift') return '\uD83D\uDFE3';
  return '\uD83D\uDFE1';
}

function extractShortId(cardOption) {
  if (!cardOption) return null;

  const urlMatch = cardOption.match(/trello\.com\/c\/([a-zA-Z0-9]+)/);
  if (urlMatch) return urlMatch[1];

  const idMatch = cardOption.match(/^([a-zA-Z0-9]{6,10})$/);
  if (idMatch) return idMatch[1];

  return null;
}

async function fetchCardByShortId(shortId) {
  try {
    const res = await trelloRequest(`/cards/${shortId}`, 'GET', {
      fields: 'name,desc,due,shortUrl,url',
    });

    if (!res || !res.ok || !res.data) {
      console.warn(`[TRELLO] No card returned for shortId ${shortId}`, res?.status);
      return null;
    }

    return res.data;
  } catch (error) {
    console.error('[TRELLO] API error while fetching card', error);
    return null;
  }
}

function detectSessionType(cardName, cardDesc) {
  const name = (cardName || '').toLowerCase();
  const desc = (cardDesc || '').toLowerCase();
  const text = `${name}\n${desc}`;

  if (text.includes('interview')) return 'interview';
  if (text.includes('training')) return 'training';

  if (
    text.includes('mass shift') ||
    text.includes('massshift') ||
    text.includes('mass-shift') ||
    text.includes('mass  shift') ||
    text.includes(' ms ')
  ) {
    return 'massshift';
  }

  return null;
}

function getSessionConfig(sessionType) {
  if (sessionType === 'interview') {
    return {
      typeLabel: 'INTERVIEW',
      color: 0xffc107,
      queueChannelId:
        process.env.QUEUE_INTERVIEW_CHANNEL_ID ||
        process.env.SESSION_QUEUECHANNEL_INTERVIEW_ID ||
        null,
      pingRoleId:
        process.env.QUEUE_INTERVIEW_PING_ROLE_ID ||
        process.env.SESSION_QUEUE_PING_INTERVIEW_ROLE_ID ||
        null,
    };
  }

  if (sessionType === 'training') {
    return {
      typeLabel: 'TRAINING',
      color: 0xf44336,
      queueChannelId:
        process.env.QUEUE_TRAINING_CHANNEL_ID ||
        process.env.SESSION_QUEUECHANNEL_TRAINING_ID ||
        null,
      pingRoleId:
        process.env.QUEUE_TRAINING_PING_ROLE_ID ||
        process.env.SESSION_QUEUE_PING_TRAINING_ROLE_ID ||
        null,
    };
  }

  if (sessionType === 'massshift') {
    return {
      typeLabel: 'MASS SHIFT',
      color: 0x9c27b0,
      queueChannelId:
        process.env.QUEUE_MASS_SHIFT_CHANNEL_ID ||
        process.env.QUEUE_MASSSHIFT_CHANNEL_ID ||
        process.env.SESSION_QUEUECHANNEL_MASS_SHIFT_ID ||
        process.env.SESSION_QUEUECHANNEL_MASSSHIFT_ID ||
        process.env.SESSION_QUEUECHANNEL_MASSHIFT_ID ||
        null,
      pingRoleId:
        process.env.QUEUE_MASS_SHIFT_PING_ROLE_ID ||
        process.env.QUEUE_MASSSHIFT_PING_ROLE_ID ||
        process.env.SESSION_QUEUE_PING_MASS_SHIFT_ROLE_ID ||
        process.env.SESSION_QUEUE_PING_MASSSHIFT_ROLE_ID ||
        process.env.SESSION_QUEUE_PING_MASSHIFT_ROLE_ID ||
        null,
    };
  }

  return null;
}

function extractHostFromDesc(desc, fallbackName) {
  if (typeof desc !== 'string') desc = '';

  const match = desc.match(/Host:\s*([^()\n]+?)\s*\(([0-9]{17,})\)/i);
  if (match) {
    return {
      hostName: match[1].trim(),
      hostId: match[2],
    };
  }

  if (fallbackName) {
    const nameMatch = fallbackName.match(/-\s*([^\]]+)$/);
    if (nameMatch) {
      return {
        hostName: nameMatch[1].trim(),
        hostId: null,
      };
    }
  }

  return { hostName: 'Unknown Host', hostId: null };
}

function extractTimeFromName(cardName) {
  if (!cardName) return null;
  const match = cardName.match(/\]\s*(.+?)\s*-\s*[^-]+$/);
  if (match) {
    return match[1].trim();
  }
  return null;
}

function formatDiscordRelativeFromDue(dueString) {
  if (!dueString) return null;
  const due = new Date(dueString);
  if (Number.isNaN(due.getTime())) return null;

  const epochSeconds = Math.floor(due.getTime() / 1000);
  return `<t:${epochSeconds}:R>`;
}

async function resolveGuildDisplayName(client, guildId, userId, fallback = null) {
  if (!userId) return fallback || 'Unknown';

  try {
    if (guildId) {
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      const member = guild
        ? await guild.members.fetch(userId).catch(() => null)
        : null;

      if (member) {
        return (
          member.displayName ||
          member.user?.globalName ||
          member.user?.username ||
          fallback ||
          `Unknown (${userId})`
        );
      }
    }

    const user = await client.users.fetch(userId);
    return user.globalName || user.username || fallback || `Unknown (${userId})`;
  } catch {
    return fallback || `Unknown (${userId})`;
  }
}

function getLogEmbedStyle(sessionType) {
  switch (sessionType) {
    case 'training':
      return {
        title: 'Training Session | Log',
        color: 0xf44336,
      };
    case 'interview':
      return {
        title: 'Interview Session | Log',
        color: 0xffc107,
      };
    case 'massshift':
      return {
        title: 'Mass Shift Session | Log',
        color: 0x9c27b0,
      };
    default:
      return {
        title: 'Session | Log',
        color: 0x6cb2eb,
      };
  }
}

function upsertQueue(shortId, data) {
  const existing = queues.get(shortId) || {};
  const merged = {
    shortId,
    sessionType: data.sessionType || existing.sessionType,
    hostId: data.hostId || existing.hostId,
    hostName: data.hostName || existing.hostName,
    guildId: data.guildId || existing.guildId || null,
    channelId: data.channelId || existing.channelId,
    messageId: data.messageId || existing.messageId,
    attendeesMessageId:
      data.attendeesMessageId || existing.attendeesMessageId || null,
    cardName: data.cardName || existing.cardName,
    cardUrl: data.cardUrl || existing.cardUrl,
    timeText: data.timeText || existing.timeText,
    due: data.due || existing.due || null,
    isClosed:
      data.isClosed !== undefined ? data.isClosed : existing.isClosed || false,
    roles: existing.roles || {
      cohost: [],
      overseer: [],
      interviewer: [],
      supervisor: [],
    },
  };

  if (data.roles) {
    merged.roles = data.roles;
  }

  queues.set(shortId, merged);
  return merged;
}

function addUserToRole(queue, userId, roleKey) {
  for (const entries of Object.values(queue.roles)) {
    const idx = entries.findIndex((entry) => entry.userId === userId);
    if (idx !== -1) entries.splice(idx, 1);
  }

  const list = queue.roles[roleKey];
  if (!list) return { ok: false, reason: 'Invalid role.' };

  if (Number.isFinite(QUEUE_ROLE_HARD_CAP) && QUEUE_ROLE_HARD_CAP > 0) {
    if (list.length >= QUEUE_ROLE_HARD_CAP) {
      return {
        ok: false,
        reason: 'That queue has reached the hard-cap. Please try again later.',
      };
    }
  }

  list.push({ userId, claimedAt: Date.now() });
  return { ok: true };
}

function removeUserFromQueue(queue, userId) {
  let removed = false;
  for (const entries of Object.values(queue.roles)) {
    const idx = entries.findIndex((entry) => entry.userId === userId);
    if (idx !== -1) {
      entries.splice(idx, 1);
      removed = true;
    }
  }
  return removed;
}

function findUserQueueRole(queue, userId) {
  if (!queue?.roles || !userId) return null;
  for (const [roleKey, entries] of Object.entries(queue.roles)) {
    const found = entries.find((entry) => entry.userId === userId);
    if (found) return { roleKey, entry: found };
  }
  return null;
}

function roleLabelForQueue(queue, roleKey) {
  if (roleKey === 'interviewer') {
    if (queue?.sessionType === 'training') return 'Trainer';
    if (queue?.sessionType === 'massshift') return 'Attendee';
    return 'Interviewer';
  }

  if (roleKey === 'cohost') return 'Co-Host';
  if (roleKey === 'overseer') return 'Overseer';
  if (roleKey === 'supervisor') return 'Supervisor';

  return String(roleKey || 'Role').charAt(0).toUpperCase() + String(roleKey || 'Role').slice(1);
}

function buildPrivateLeaveRow(shortId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`queue_leave_${shortId}`)
      .setLabel('Leave Queue')
      .setStyle(ButtonStyle.Danger),
  );
}

function getRoleLimit(queue, roleKey) {
  let limit = ROLE_LIMITS[roleKey] ?? Infinity;

  if (roleKey === 'interviewer') {
    if (queue.sessionType === 'training') {
      limit = 8;
    } else if (queue.sessionType === 'massshift') {
      limit = 15;
    } else {
      limit = 12;
    }
  }

  return limit;
}

function getQueueRoleCountKeys(queue, roleKey) {
  const key = String(roleKey || '').toLowerCase();
  const sessionType = String(queue?.sessionType || '').toLowerCase();

  if (key === 'interviewer') {
    if (sessionType === 'training') return ['interviewer', 'trainer'];
    if (sessionType === 'massshift') return ['interviewer', 'attendee'];
    return ['interviewer'];
  }

  return [key].filter(Boolean);
}

function makeCurrentWeekRoleCounter(queue, roleKey, guildId) {
  const weekRange = getWeekRange(0);
  const roleKeys = new Set(getQueueRoleCountKeys(queue, roleKey));
  const counts = new Map();

  try {
    const data = getAllActivity();
    const supportEntries = Array.isArray(data?.supportSessions) ? data.supportSessions : [];

    for (const entry of supportEntries) {
      if (!entry?.userId) continue;
      if (entry.cancelled) continue;
      if (guildId && entry.guildId && String(entry.guildId) !== String(guildId)) continue;
      if (entry.timestamp < weekRange.startMs || entry.timestamp > weekRange.endMs) continue;
      if (!roleKeys.has(String(entry.roleKey || '').toLowerCase())) continue;

      const userId = String(entry.userId);
      counts.set(userId, (counts.get(userId) || 0) + 1);
    }
  } catch (error) {
    console.warn('[SESSIONQUEUE] Could not read current-week activity counts:', error?.message || error);
  }

  return (userId) => counts.get(String(userId || '')) || 0;
}

function sortRoleEntries(entries, priorityStore, guildId, roleKey, queue) {
  const getCurrentWeekRoleCount = makeCurrentWeekRoleCounter(queue, roleKey, guildId);

  return [...(entries || [])].sort((a, b) => {
    const aCount = getCurrentWeekRoleCount(a.userId);
    const bCount = getCurrentWeekRoleCount(b.userId);

    // Lower current-week count for the role claimed = higher priority.
    if (aCount !== bCount) return aCount - bCount;

    // Tie-breaker: whoever queued first wins.
    const aClaimed = Number(a.claimedAt || 0);
    const bClaimed = Number(b.claimedAt || 0);
    if (aClaimed !== bClaimed) return aClaimed - bClaimed;

    // Final stable fallback so sorting is predictable.
    return String(a.userId || '').localeCompare(String(b.userId || ''));
  });
}

function splitSelected(entries, limit, priorityStore, guildId, roleKey, queue) {
  const sorted = sortRoleEntries(entries, priorityStore, guildId, roleKey, queue);
  const safeLimit = Number.isFinite(limit) ? limit : sorted.length;
  return {
    sorted,
    selected: sorted.slice(0, safeLimit),
    backups: sorted.slice(safeLimit),
  };
}

function formatBackupsLine(backups, maxShow = 10) {
  if (!backups || backups.length === 0) return null;
  const shown = backups
    .slice(0, maxShow)
    .map((e) => `<@${e.userId}>`)
    .join(' \u2022 ');
  const extra =
    backups.length > maxShow ? ` (+${backups.length - maxShow} more)` : '';
  return `\uD83D\uDFE0 Backups: ${shown}${extra}`;
}

function getEditableSections(sessionType) {
  if (sessionType === 'training') {
    return [
      { key: 'interviewer', label: 'Trainer' },
      { key: 'supervisor', label: 'Supervisor' },
      { key: 'cohost', label: 'Co-Host' },
      { key: 'overseer', label: 'Overseer' },
    ];
  }

  if (sessionType === 'massshift') {
    return [
      { key: 'interviewer', label: 'Attendees' },
      { key: 'cohost', label: 'Co-Host' },
      { key: 'overseer', label: 'Overseer' },
    ];
  }

  return [
    { key: 'interviewer', label: 'Interviewer' },
    { key: 'cohost', label: 'Co-Host' },
    { key: 'overseer', label: 'Overseer' },
  ];
}

function buildStructuredLineup(queue, priorityStore) {
  const guildId = queue.guildId || 'global';
  const main = splitSelected(
    queue.roles.interviewer || [],
    getRoleLimit(queue, 'interviewer'),
    priorityStore,
    guildId,
    'interviewer',
    queue,
  );
  const cohost = splitSelected(
    queue.roles.cohost || [],
    getRoleLimit(queue, 'cohost'),
    priorityStore,
    guildId,
    'cohost',
    queue,
  );
  const overseer = splitSelected(
    queue.roles.overseer || [],
    getRoleLimit(queue, 'overseer'),
    priorityStore,
    guildId,
    'overseer',
    queue,
  );
  const supervisor = splitSelected(
    queue.roles.supervisor || [],
    getRoleLimit(queue, 'supervisor'),
    priorityStore,
    guildId,
    'supervisor',
    queue,
  );

  return {
    shortId: queue.shortId,
    sessionType: queue.sessionType,
    hostId: queue.hostId || null,
    hostName: queue.hostName || null,
    sections: {
      interviewer: main.selected.map((entry) => entry.userId),
      supervisor: supervisor.selected.map((entry) => entry.userId),
      cohost: cohost.selected.map((entry) => entry.userId),
      overseer: overseer.selected.map((entry) => entry.userId),
    },
  };
}

function buildEditTemplateFromLineup(lineup) {
  const sections = getEditableSections(lineup.sessionType);
  const blocks = [];

  for (const section of sections) {
    blocks.push(`[${section.label}]`);
    const ids = lineup.sections?.[section.key] || [];

    if (!ids.length) {
      blocks.push('None');
    } else {
      ids.forEach((userId, index) => {
        blocks.push(`${index + 1}. <@${userId}>`);
      });
    }

    blocks.push('');
  }

  return blocks.join('\n').trim();
}

function buildLogFieldsFromLineup(lineup) {
  const fields = [
    {
      name: 'Host',
      value: lineup.hostId
        ? `<@${lineup.hostId}> (${lineup.hostId})`
        : lineup.hostName || 'Unknown',
    },
  ];

  for (const section of getEditableSections(lineup.sessionType)) {
    const ids = lineup.sections?.[section.key] || [];
    const fieldName =
      section.label === 'Attendees'
        ? 'Attendees'
        : section.label === 'Trainer'
        ? 'Trainers'
        : section.label === 'Interviewer'
        ? 'Interviewers'
        : section.label === 'Supervisor'
        ? 'Supervisors'
        : section.label;

    fields.push({
      name: fieldName,
      value: ids.length
        ? ids.map((id, i) => `${i + 1}. <@${id}> (${id})`).join('\n')
        : 'None',
      inline: section.key !== 'interviewer',
    });
  }

  return fields;
}

function parseEditedLineup(text, sessionType) {
  const allowedSections = getEditableSections(sessionType);
  const nameToKey = new Map(
    allowedSections.map((section) => [section.label.toLowerCase(), section.key]),
  );

  const result = {
    interviewer: [],
    supervisor: [],
    cohost: [],
    overseer: [],
  };

  let currentSectionKey = null;
  const lines = String(text || '').split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      const sectionName = sectionMatch[1].trim().toLowerCase();
      currentSectionKey = nameToKey.get(sectionName) || null;
      continue;
    }

    if (!currentSectionKey) continue;
    if (/^none$/i.test(line)) continue;

    const mentionMatch = line.match(/<@!?(\d+)>/);
    const plainIdMatch = line.match(/\b(\d{17,20})\b/);
    const userId = mentionMatch?.[1] || plainIdMatch?.[1];

    if (userId) {
      result[currentSectionKey].push(userId);
    }
  }

  return result;
}

async function updateAttendeesMessage(client, sessionRecord, lineup) {
  if (!sessionRecord?.attendeesMessageId || !sessionRecord?.queueChannelId) return;

  const channel = await client.channels
    .fetch(sessionRecord.queueChannelId)
    .catch(() => null);
  if (!channel) return;

  const message = await channel.messages
    .fetch(sessionRecord.attendeesMessageId)
    .catch(() => null);
  if (!message) return;

  const lines = [
    '\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557',
    '                              \u2705  SELECTED ATTENDEES \u2705',
    '\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D',
    '',
    lineup.hostId
      ? `\uD83E\uDDCA Host: <@${lineup.hostId}>`
      : `\uD83E\uDDCA Host: ${lineup.hostName || 'Unknown'}`,
    lineup.sections.cohost?.[0]
      ? `\uD83E\uDDCA Co-Host: <@${lineup.sections.cohost[0]}>`
      : '\uD83E\uDDCA Co-Host: None selected',
    lineup.sections.overseer?.[0]
      ? `\uD83E\uDDCA Overseer: <@${lineup.sections.overseer[0]}>`
      : '\uD83E\uDDCA Overseer: None selected',
    '',
    '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500',
    '',
  ];

  if (lineup.sessionType === 'training') {
    lines.push('\uD83D\uDD34  Trainers \uD83D\uDD34');
  } else if (lineup.sessionType === 'massshift') {
    lines.push('\uD83D\uDFE3  Attendees \uD83D\uDFE3');
  } else {
    lines.push('\uD83D\uDFE1  Interviewers \uD83D\uDFE1');
  }

  const mainList = lineup.sections.interviewer || [];
  if (!mainList.length) {
    lines.push('None selected.');
  } else {
    mainList.forEach((userId, idx) => {
      lines.push(`${idx + 1}. <@${userId}>`);
    });
  }

  const supervisorList = lineup.sections.supervisor || [];
  if (supervisorList.length) {
    lines.push('', '\uD83D\uDFE2  Supervisors \uD83D\uDFE2');
    supervisorList.forEach((userId, idx) => {
      lines.push(`${idx + 1}. <@${userId}>`);
    });
  }

  lines.push('', '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500', '');
  lines.push(
    '\uD83E\uDDCA You should now join! Please join within **5 minutes**, or your spot will be given to someone else.',
  );
  lines.push(
    '\uD83E\uDDCA Failure to join on time will result in a **written warning**.',
  );

  if (lineup.sessionType === 'interview') {
    lines.push(
      'https://www.roblox.com/games/71896062227595/GH-Interview-Center',
    );
  } else if (lineup.sessionType === 'training') {
    lines.push(
      'https://www.roblox.com/games/88554128028552/GH-Training-Center',
    );
  } else if (lineup.sessionType === 'massshift') {
    lines.push(
      'https://www.roblox.com/games/127619749760478/Glace-Hotels-BETA-V1',
    );
  }

  let content = lines.join('\n');
  if (content.length > 1950) {
    content = content.slice(0, 1940) + '\n\u2026';
  }

  await message.edit({ content });
}

async function updateLogMessage(client, sessionRecord, lineup) {
  if (!sessionRecord?.logChannelId || !sessionRecord?.logMessageId) return;

  const channel = await client.channels
    .fetch(sessionRecord.logChannelId)
    .catch(() => null);
  if (!channel) return;

  const message = await channel.messages
    .fetch(sessionRecord.logMessageId)
    .catch(() => null);
  if (!message) return;

  const existingEmbed = message.embeds?.[0];
  const logStyle = getLogEmbedStyle(lineup.sessionType);
  const embed = EmbedBuilder.from(existingEmbed || new EmbedBuilder())
    .setTitle(logStyle.title)
    .setColor(logStyle.color)
    .setFields(buildLogFieldsFromLineup(lineup))
    .setFooter({ text: 'Edited with /editactivity' });

  await message.edit({ embeds: [embed] });
}

async function applyEditedLineup(client, shortId, newSections, editorId = null) {
  const queue = queues.get(shortId);
  const record = getSession(shortId);
  const base = queue ? buildStructuredLineup(queue, client.priorityStore) : record;

  if (!base) {
    return {
      ok: false,
      error: 'I could not find an active queue or saved log for that Trello card.',
    };
  }

  const lineup = {
    ...base,
    sections: {
      interviewer: newSections.interviewer || [],
      supervisor: newSections.supervisor || [],
      cohost: newSections.cohost || [],
      overseer: newSections.overseer || [],
    },
    editedBy: editorId,
    editedAt: Date.now(),
  };

  const sessionRecord = upsertSession({
    ...(record || {}),
    shortId,
    sessionType: lineup.sessionType,
    hostId: lineup.hostId || null,
    hostName: lineup.hostName || null,
    lineup,
  });

  if (queue) {
    queue.roles.interviewer = lineup.sections.interviewer.map((userId) => ({
      userId,
      claimedAt: Date.now(),
    }));
    queue.roles.supervisor = lineup.sections.supervisor.map((userId) => ({
      userId,
      claimedAt: Date.now(),
    }));
    queue.roles.cohost = lineup.sections.cohost.map((userId) => ({
      userId,
      claimedAt: Date.now(),
    }));
    queue.roles.overseer = lineup.sections.overseer.map((userId) => ({
      userId,
      claimedAt: Date.now(),
    }));
    queues.set(shortId, queue);
  }

  await updateAttendeesMessage(client, sessionRecord, lineup);

  if (sessionRecord.logMessageId) {
    await updateLogMessage(client, sessionRecord, lineup);

    const supportEntries = [];
    for (const userId of lineup.sections.interviewer) {
      supportEntries.push({ userId, roleKey: 'interviewer' });
    }
    for (const userId of lineup.sections.supervisor) {
      supportEntries.push({ userId, roleKey: 'supervisor' });
    }
    for (const userId of lineup.sections.cohost) {
      supportEntries.push({ userId, roleKey: 'cohost' });
    }
    for (const userId of lineup.sections.overseer) {
      supportEntries.push({ userId, roleKey: 'overseer' });
    }

    replaceSessionActivity({
      shortId,
      hostId: lineup.hostId || null,
      sessionType: lineup.sessionType,
      guildId: sessionRecord.guildId || queue?.guildId || null,
      supportEntries,
      timestamp: sessionRecord.loggedAt || Date.now(),
      cancelled: false,
    });
  }

  return { ok: true, lineup, sessionRecord };
}

async function openQueueForCard(interaction, cardOption) {
  console.log('[QUEUE] Raw card option:', cardOption);

  const shortId = extractShortId(cardOption);
  if (!shortId) {
    await interaction.reply({
      content:
        'I could not parse that Trello card. Please provide a valid Trello card link or short ID.',
      ephemeral: true,
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const card = await fetchCardByShortId(shortId);
  if (!card) {
    console.log('[QUEUE] Could not fetch Trello card for shortId:', shortId);
    await interaction.editReply({
      content:
        'I could not fetch that Trello card. Make sure it exists and I can access it.',
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  const sessionType = detectSessionType(card.name, card.desc);
  if (!sessionType) {
    console.log('[QUEUE] Could not detect session type for card:', card.name);
    await interaction.editReply({
      content:
        'I could not detect the session type from that card.\n' +
        'Make sure the card name or description includes **Interview**, **Training**, or **Mass Shift**.',
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  const cfg = getSessionConfig(sessionType);
  if (!cfg || !cfg.queueChannelId) {
    console.log('[QUEUE] Missing channel config for session type:', sessionType, cfg);
    await interaction.editReply({
      content:
        `I am missing a queue channel configuration for **${sessionType}**.\n` +
        'Please check your environment variables for the queue channel IDs / ping roles.',
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  const queueChannel = await interaction.client.channels
    .fetch(cfg.queueChannelId)
    .catch(() => null);
  if (!queueChannel) {
    console.log('[QUEUE] Could not fetch queue channel:', cfg.queueChannelId);
    await interaction.editReply({
      content:
        'I could not access the configured queue channel. Please check my permissions and the channel ID.',
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  let { hostName, hostId } = extractHostFromDesc(card.desc, card.name);

  if (!hostId) {
    hostId = interaction.user.id;
    hostName =
      interaction.member?.displayName ||
      interaction.user.globalName ||
      interaction.user.username;
  }

  const timeText = extractTimeFromName(card.name);
  const startsIn = formatDiscordRelativeFromDue(card.due);
  const cardUrl = card.shortUrl || card.url || cardOption;

  const headerTop = '\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557';
  const headerEmoji = getHeaderEmoji(sessionType);
  const headerTitle = `${headerEmoji} ${cfg.typeLabel} | ${hostName || 'Host'} | ${
    timeText || 'Time'
  } ${headerEmoji}`;
  const headerBottom = '\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D';

  const descriptionLines = [
    headerTop,
    headerTitle,
    headerBottom,
    '',
    hostId
      ? `\uD83D\uDCCC  Host: <@${hostId}> (${hostId}) \u2022 ${hostName || 'Unknown'}`
      : `\uD83D\uDCCC  Host: ${hostName || 'Unknown'}`,
    startsIn ? `\uD83D\uDCCC  Starts: ${startsIn}` : null,
    timeText ? `\uD83D\uDCCC  Time: ${timeText}` : null,
    '',
    '\uD83D\uDCA0 ROLES \uD83D\uDCA0',
    '----------------------------------------------------------------',
  ];

  if (sessionType === 'interview') {
    descriptionLines.push(
      '\u2139\uFE0F  **Co-Host:** Corporate Intern+',
      '\u2139\uFE0F  **Overseer:** Head Corporate+',
      '\u2139\uFE0F  **Interviewer (12):** Leadership Intern+',
    );
  } else if (sessionType === 'training') {
    descriptionLines.push(
      '\u2139\uFE0F  **Co-Host:** Corporate Intern+',
      '\u2139\uFE0F  **Overseer:** Head Corporate+',
      '\u2139\uFE0F  **Supervisor (4):** Assistant Manager+',
      '\u2139\uFE0F  **Trainer (8):** Leadership Intern+',
    );
  } else if (sessionType === 'massshift') {
    descriptionLines.push(
      '\u2139\uFE0F  **Co-Host:** Executive Manager+',
      '\u2139\uFE0F  **Overseer:** Head Corporate+',
      '\u2139\uFE0F  **Attendees (15):** Leadership Intern+',
    );
  }

  descriptionLines.push(
    '',
    '\u2753  HOW TO JOIN THE QUEUE \u2753',
    '----------------------------------------------------------------',
    '- Check the role list above \u2014 if your rank is allowed, press **Join Queue** and choose your role from the dropdown.',
    '- You\u2019ll get a popup that says: \u201CYou have been added to the (ROLE) Queue.\u201D',
    '- Do NOT join until you are pinged in \u201CSession Attendees\u201D **15 minutes before** the session starts.',
    '- Line up on the number/role you are selected for on "Session Attendees".',
    '- You have 5 minutes after session attendees is posted to join.',
    '',
    '\u2753 HOW TO LEAVE THE QUEUE/INFORM LATE ARRIVAL \u2753',
    '----------------------------------------------------------------',
    '- After you join, the bot will privately show you a **Leave Queue** button.',
    '- You can only leave the queue BEFORE the session list is posted. After that, message your host if you need to un-queue.',
    '- If you do not let the host know anything before **5 minutes** after an attendees post was made, you will be given a **Written Warning, and your spot could be given up.**',
    '----------------------------------------------------------------',
    '\u256D\u2500\u2500\u2500\u2500\u2500\u2500\u2500 \uD83D\uDCA0 LINKS \uD83D\uDCA0 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256E',
    `\u3030\uFE0F Trello Card: ${cardUrl}`,
    '\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256F',
  );

  const embed = new EmbedBuilder()
    .setDescription(descriptionLines.filter(Boolean).join('\n'))
    .setColor(cfg.color || 0x6cb2eb);

  const joinRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`queue_joinmenu_${shortId}`)
      .setLabel('Join Queue')
      .setStyle(ButtonStyle.Success),
  );

  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`queue_close_${shortId}`)
      .setLabel('Close Queue & Post Attendees')
      .setStyle(ButtonStyle.Danger),
  );

  const payload = {
    embeds: [embed],
    components: [joinRow, controlRow],
  };

  if (cfg.pingRoleId) {
    payload.content = `<@&${cfg.pingRoleId}>`;
  }

  const queueMessage = await queueChannel.send(payload);

  upsertQueue(shortId, {
    sessionType,
    hostId,
    hostName,
    guildId: interaction.guildId,
    channelId: queueMessage.channel.id,
    messageId: queueMessage.id,
    attendeesMessageId: null,
    cardName: card.name,
    cardUrl,
    timeText,
    due: card.due || null,
    roles: {
      cohost: [],
      overseer: [],
      interviewer: [],
      supervisor: [],
    },
    isClosed: false,
  });

  await interaction.editReply({
    content: `\u2705 Opened queue for **${card.name}** in <#${queueChannel.id}>`,
  });
  setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
}

function buildLiveAttendeesMessage(queue, priorityStore) {
  const guildId = queue.guildId || 'global';

  const cohost = splitSelected(
    queue.roles.cohost,
    getRoleLimit(queue, 'cohost'),
    priorityStore,
    guildId,
    'cohost',
    queue,
  );
  const overseer = splitSelected(
    queue.roles.overseer,
    getRoleLimit(queue, 'overseer'),
    priorityStore,
    guildId,
    'overseer',
    queue,
  );
  const main = splitSelected(
    queue.roles.interviewer,
    getRoleLimit(queue, 'interviewer'),
    priorityStore,
    guildId,
    'interviewer',
    queue,
  );
  const supervisor = splitSelected(
    queue.roles.supervisor,
    getRoleLimit(queue, 'supervisor'),
    priorityStore,
    guildId,
    'supervisor',
    queue,
  );

  const headerTop = '\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557';
  const headerTitle = '                              \u2705  SELECTED ATTENDEES \u2705';
  const headerBottom = '\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D';

  const lines = [
    headerTop,
    headerTitle,
    headerBottom,
    '',
    queue.hostId
      ? `\uD83E\uDDCA Host: <@${queue.hostId}>`
      : `\uD83E\uDDCA Host: ${queue.hostName || 'Unknown'}`,
    cohost.selected[0]
      ? `\uD83E\uDDCA Co-Host: <@${cohost.selected[0].userId}>`
      : '\uD83E\uDDCA Co-Host: None selected',
    overseer.selected[0]
      ? `\uD83E\uDDCA Overseer: <@${overseer.selected[0].userId}>`
      : '\uD83E\uDDCA Overseer: None selected',
  ];

  const cohostBackups = formatBackupsLine(cohost.backups, 5);
  if (cohostBackups) lines.push(cohostBackups);

  const overseerBackups = formatBackupsLine(overseer.backups, 5);
  if (overseerBackups) lines.push(overseerBackups);

  lines.push('', '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500', '');

  if (queue.sessionType === 'training') {
    lines.push('\uD83D\uDD34  Trainers \uD83D\uDD34');
  } else if (queue.sessionType === 'massshift') {
    lines.push('\uD83D\uDFE3  Attendees \uD83D\uDFE3');
  } else {
    lines.push('\uD83D\uDFE1  Interviewers \uD83D\uDFE1');
  }

  if (main.selected.length === 0) {
    lines.push('None selected.');
  } else {
    main.selected.forEach((entry, idx) => {
      lines.push(`${idx + 1}. <@${entry.userId}>`);
    });
  }

  const mainBackups = formatBackupsLine(main.backups, 12);
  if (mainBackups) lines.push(mainBackups);

  if (supervisor.sorted.length) {
    lines.push('', '\uD83D\uDFE2  Supervisors \uD83D\uDFE2');

    if (supervisor.selected.length === 0) {
      lines.push('None selected.');
    } else {
      supervisor.selected.forEach((entry, idx) => {
        lines.push(`${idx + 1}. <@${entry.userId}>`);
      });
    }

    const supervisorBackups = formatBackupsLine(supervisor.backups, 10);
    if (supervisorBackups) lines.push(supervisorBackups);
  }

  lines.push('', '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500', '');
  lines.push(
    '\uD83E\uDDCA You should now join! Please join within **5 minutes**, or your spot will be given to someone else.',
  );
  lines.push(
    '\uD83E\uDDCA Failure to join on time will result in a **written warning**.',
  );

  if (queue.sessionType === 'interview') {
    lines.push('https://www.roblox.com/games/71896062227595/GH-Interview-Center');
  } else if (queue.sessionType === 'training') {
    lines.push('https://www.roblox.com/games/88554128028552/GH-Training-Center');
  } else if (queue.sessionType === 'massshift') {
    lines.push('https://www.roblox.com/games/127619749760478/Glace-Hotels-BETA-V1');
  }

  let msg = lines.join('\n');

  if (msg.length > 1950) {
    msg = msg.slice(0, 1940) + '\n\u2026';
  }

  return msg;
}

async function postLiveAttendeesForQueue(client, queue) {
  if (!queue || !queue.channelId) return;

  const channel = await client.channels.fetch(queue.channelId).catch(() => null);
  if (!channel) return;

  const content = buildLiveAttendeesMessage(queue, client.priorityStore);
  const message = await channel.send({ content });

  queue.attendeesMessageId = message.id;
  queues.set(queue.shortId, queue);

  const lineup = buildStructuredLineup(queue, client.priorityStore);
  upsertSession({
    shortId: queue.shortId,
    sessionType: queue.sessionType,
    hostId: queue.hostId || null,
    hostName: queue.hostName || null,
    guildId: queue.guildId || null,
    cardName: queue.cardName || null,
    cardUrl: queue.cardUrl || null,
    queueChannelId: queue.channelId || null,
    queueMessageId: queue.messageId || null,
    attendeesMessageId: message.id,
    lineup,
  });
}

async function logAttendeesForCard(client, cardOptionOrShortId, options = {}) {
  const { recordAttendance = false, cancelled = false } = options;

  const shortId = extractShortId(cardOptionOrShortId);
  if (!shortId) {
    console.warn('[LOG] Could not parse shortId from', cardOptionOrShortId);
    return { ok: false, reason: 'invalid_short_id' };
  }

  const queue = queues.get(shortId);
  if (!queue) {
    console.warn('[LOG] No queue stored for shortId', shortId);
    return { ok: false, reason: 'missing_queue' };
  }

  const logChannel = await resolveSessionLogChannel(
    client,
    queue.guildId || null,
    queue.channelId || null,
  );
  if (!logChannel) {
    console.warn('[LOG] Could not fetch #session-logs or fallback log channel for attendees');
    return { ok: false, reason: 'missing_log_channel' };
  }

  const guildId = queue.guildId || 'global';
  const cardUrl = resolveTrelloCardUrl(shortId, queue, cardOptionOrShortId, options);

  const cohost = splitSelected(
    queue.roles.cohost,
    getRoleLimit(queue, 'cohost'),
    client.priorityStore,
    guildId,
    'cohost',
    queue,
  );
  const overseer = splitSelected(
    queue.roles.overseer,
    getRoleLimit(queue, 'overseer'),
    client.priorityStore,
    guildId,
    'overseer',
    queue,
  );
  const main = splitSelected(
    queue.roles.interviewer,
    getRoleLimit(queue, 'interviewer'),
    client.priorityStore,
    guildId,
    'interviewer',
    queue,
  );
  const supervisor = splitSelected(
    queue.roles.supervisor,
    getRoleLimit(queue, 'supervisor'),
    client.priorityStore,
    guildId,
    'supervisor',
    queue,
  );

  async function usernamesFromEntries(entries) {
    const results = [];
    for (const entry of entries) {
      const displayName = await resolveGuildDisplayName(
        client,
        queue.guildId,
        entry.userId,
        `Unknown (${entry.userId})`,
      );
      results.push(`<@${entry.userId}> (${entry.userId}) \u2022 ${displayName}`);
    }
    return results;
  }

  const [cohostNames, overseerNames, mainNames, supervisorNames] =
    await Promise.all([
      usernamesFromEntries(cohost.selected),
      usernamesFromEntries(overseer.selected),
      usernamesFromEntries(main.selected),
      usernamesFromEntries(supervisor.selected),
    ]);

  const resolvedHostName = queue.hostId
    ? await resolveGuildDisplayName(
        client,
        queue.guildId,
        queue.hostId,
        queue.hostName || 'Unknown',
      )
    : queue.hostName || 'Unknown';

  const fields = [
    {
      name: 'Host',
      value: queue.hostId
        ? `<@${queue.hostId}> (${queue.hostId}) \u2022 ${resolvedHostName}`
        : resolvedHostName,
    },
    {
      name: 'Trello Card Link',
      value: cardUrl,
    },
    {
      name: 'Co-Host',
      value: cohostNames.length ? cohostNames.join('\n') : 'None',
      inline: true,
    },
    {
      name: 'Overseer',
      value: overseerNames.length ? overseerNames.join('\n') : 'None',
      inline: true,
    },
  ];

  const mainRoleTitle =
    queue.sessionType === 'training'
      ? 'Trainers'
      : queue.sessionType === 'massshift'
      ? 'Attendees'
      : 'Interviewers';

  fields.push({
    name: mainRoleTitle,
    value: mainNames.length
      ? mainNames.map((n, i) => `${i + 1}. ${n}`).join('\n')
      : 'None',
  });

  if (queue.sessionType === 'training') {
    fields.push({
      name: 'Supervisors',
      value: supervisorNames.length
        ? supervisorNames.map((n, i) => `${i + 1}. ${n}`).join('\n')
        : 'None',
    });
  }

  const logStyle = getLogEmbedStyle(queue.sessionType);
  const embed = new EmbedBuilder()
    .setTitle(logStyle.title)
    .setColor(logStyle.color)
    .setFields(fields)
    .setFooter({ text: `Trello Card: ${shortId}` })
    .setTimestamp();

  if (/^https?:\/\//i.test(cardUrl)) {
    embed.setURL(cardUrl);
  }

  const logMessage = await logChannel.send({ embeds: [embed] });

  const lineup = {
    shortId,
    sessionType: queue.sessionType,
    hostId: queue.hostId || null,
    hostName: queue.hostName || null,
    sections: {
      interviewer: main.selected.map((entry) => entry.userId),
      supervisor: supervisor.selected.map((entry) => entry.userId),
      cohost: cohost.selected.map((entry) => entry.userId),
      overseer: overseer.selected.map((entry) => entry.userId),
    },
  };

  upsertSession({
    shortId,
    sessionType: queue.sessionType,
    hostId: queue.hostId || null,
    hostName: queue.hostName || null,
    guildId: queue.guildId || null,
    cardName: queue.cardName || null,
    cardUrl,
    queueChannelId: queue.channelId || null,
    queueMessageId: queue.messageId || null,
    attendeesMessageId: queue.attendeesMessageId || null,
    logChannelId: logChannel.id,
    logMessageId: logMessage.id,
    loggedAt: logMessage.createdTimestamp,
    lineup,
  });

  const supportEntries = [];
  for (const entry of main.selected) {
    supportEntries.push({ userId: entry.userId, roleKey: 'interviewer' });
  }
  for (const entry of supervisor.selected) {
    supportEntries.push({ userId: entry.userId, roleKey: 'supervisor' });
  }
  for (const entry of cohost.selected) {
    supportEntries.push({ userId: entry.userId, roleKey: 'cohost' });
  }
  for (const entry of overseer.selected) {
    supportEntries.push({ userId: entry.userId, roleKey: 'overseer' });
  }

  replaceSessionActivity({
    shortId,
    hostId: queue.hostId || null,
    sessionType: queue.sessionType,
    guildId: queue.guildId || null,
    supportEntries,
    timestamp: logMessage.createdTimestamp,
    cancelled,
  });

  if (
    recordAttendance &&
    client.priorityStore &&
    typeof client.priorityStore.recordAttendance === 'function'
  ) {
    const attendedIds = [
      ...cohost.selected,
      ...overseer.selected,
      ...main.selected,
      ...supervisor.selected,
    ]
      .map((e) => e.userId)
      .filter(Boolean)
      .filter((id) => id !== queue.hostId);

    client.priorityStore.recordAttendance(guildId, attendedIds, {
      shortId,
      cardName: queue.cardName,
      sessionType: queue.sessionType,
    });

    console.log(
      `[PRIORITY] Recorded attendance for ${attendedIds.length} user(s) (guild: ${guildId}).`,
    );
  }

  return { ok: true, shortId, logChannelId: logChannel.id, logMessageId: logMessage.id, cardUrl };
}

async function cleanupQueueForCard(client, cardOptionOrShortId) {
  const shortId = extractShortId(cardOptionOrShortId);
  if (!shortId) return;

  const queue = queues.get(shortId);
  if (!queue) return;

  const channel = await client.channels.fetch(queue.channelId).catch(() => null);
  if (channel) {
    if (queue.messageId) {
      try {
        const msg = await channel.messages.fetch(queue.messageId);
        await msg.delete().catch(() => {});
      } catch {}
    }

    if (queue.attendeesMessageId) {
      try {
        const aMsg = await channel.messages.fetch(queue.attendeesMessageId);
        await aMsg.delete().catch(() => {});
      } catch {}
    }
  }

  queues.delete(shortId);
}

async function handleQueueButtonInteraction(interaction) {
  const customId = interaction.customId;

  if (customId.startsWith('cancel_log_')) {
    const parts = customId.split('_');
    const decision = parts[2];
    const shortId = parts[3];

    if (decision === 'no') {
      try {
        await cleanupQueueForCard(interaction.client, shortId);
      } catch (err) {
        console.error('[CANCEL_LOG] Failed cleanup (no log):', err);
      }

      await interaction
        .update({
          content:
            'Okay, this cancelled session will not be logged, but the queue & attendees posts have been cleaned up.',
          components: [],
        })
        .catch(() => {});
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      return true;
    }

    try {
      const result = await logAttendeesForCard(interaction.client, shortId, {
        recordAttendance: false,
        cancelled: true,
      });

      await cleanupQueueForCard(interaction.client, shortId);

      await interaction
        .update({
          content: result?.ok
            ? 'Attendees logged and queue cleaned up for this cancelled session.'
            : 'The session was cancelled, but I could not create the cancelled-session log/activity entry. The queue was still cleaned up.',
          components: [],
        })
        .catch(() => {});
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    } catch (err) {
      console.error('[CANCEL_LOG] Error while logging cancelled session:', err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({
            content:
              'There was an error logging attendees for this cancelled session. The Trello card itself was already cancelled.',
            ephemeral: true,
          })
          .catch(() => {});
      }
    }
    return true;
  }

  if (!customId.startsWith('queue_')) return false;

  const parts = customId.split('_');
  const action = parts[1];

  try {
    if (action === 'joinmenu') {
      const shortId = parts[2];
      const queue = queues.get(shortId);
      if (!queue || queue.isClosed) {
        await interaction.reply({
          content: 'This queue is no longer active.',
          ephemeral: true,
        });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        return true;
      }

      const alreadyQueued = findUserQueueRole(queue, interaction.user.id);
      if (alreadyQueued) {
        await interaction.reply({
          content: `You are already in the **${roleLabelForQueue(queue, alreadyQueued.roleKey)}** queue.`,
          components: [buildPrivateLeaveRow(shortId)],
          ephemeral: true,
        });
        return true;
      }

      const allowedRoles = getAllowedQueueRoles(queue, interaction.member);
      if (!allowedRoles.length) {
        await interaction.reply({
          content: 'You do not have a rank that can claim a queue role for this session.',
          ephemeral: true,
        });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        return true;
      }

      const select = new StringSelectMenuBuilder()
        .setCustomId(`queue_pickrole_${shortId}`)
        .setPlaceholder('Choose a role to queue for')
        .addOptions(
          allowedRoles.map((role) => ({
            label: role.label,
            value: role.key,
          })),
        );

      await interaction.reply({
        content: 'Choose the role you want to queue for.',
        components: [new ActionRowBuilder().addComponents(select)],
        ephemeral: true,
      });
      return true;
    }

    if (action === 'pickrole') {
      const shortId = parts[2];
      const roleKey = interaction.values?.[0];
      const queue = queues.get(shortId);
      if (!queue || queue.isClosed) {
        await interaction.update({
          content: 'This queue is no longer active.',
          components: [],
        });
        return true;
      }

      const allowedRoleKeys = new Set(
        getAllowedQueueRoles(queue, interaction.member).map((role) => role.key),
      );
      if (!allowedRoleKeys.has(roleKey)) {
        await interaction.update({
          content: 'You cannot claim that role based on your current rank.',
          components: [],
        });
        return true;
      }

      const addResult = addUserToRole(queue, interaction.user.id, roleKey);
      if (!addResult.ok) {
        await interaction.update({ content: addResult.reason, components: [] });
        return true;
      }

      const roleLabel = roleLabelForQueue(queue, roleKey);

      await interaction.update({
        content: `You have been added to the **${roleLabel}** queue.`,
        components: [buildPrivateLeaveRow(shortId)],
      });
      return true;
    }

    if (action === 'leave') {
      const shortId = parts[2];
      const queue = queues.get(shortId);
      if (!queue) {
        await interaction.reply({
          content: 'This queue is no longer active.',
          ephemeral: true,
        });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        return true;
      }

      const removed = removeUserFromQueue(queue, interaction.user.id);
      const content = removed
        ? 'You have been removed from the queue.'
        : 'You are not currently in this queue.';

      if (interaction.message?.interaction || interaction.message?.flags) {
        await interaction.update({ content, components: [] }).catch(async () => {
          await interaction.reply({ content, ephemeral: true }).catch(() => {});
        });
      } else {
        await interaction.reply({ content, ephemeral: true });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      }
      return true;
    }

    if (action === 'close') {
      const shortId = parts[2];
      const queue = queues.get(shortId);
      if (!queue) {
        await interaction.reply({
          content: 'This queue is no longer active.',
          ephemeral: true,
        });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        return true;
      }

      if (queue.hostId && interaction.user.id !== queue.hostId) {
        await interaction.reply({
          content: 'Only the host can close this queue.',
          ephemeral: true,
        });
        setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
        return true;
      }

      queue.isClosed = true;
      queues.set(shortId, queue);

      try {
        const channel = await interaction.client.channels.fetch(queue.channelId);
        const message = await channel.messages.fetch(queue.messageId);

        const disabledComponents = message.components.map((row) => {
          const newRow = ActionRowBuilder.from(row);
          newRow.components = row.components.map((component) =>
            ButtonBuilder.from(component).setDisabled(true),
          );
          return newRow;
        });

        await message.edit({ components: disabledComponents });
      } catch (err) {
        console.error('[QUEUE] Failed to disable buttons:', err);
      }

      await interaction.reply({
        content: 'Queue closed. Posting attendees...',
        ephemeral: true,
      });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);

      await postLiveAttendeesForQueue(interaction.client, queue);
      return true;
    }
  } catch (error) {
    console.error('[QUEUE] Error handling button interaction:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction
        .reply({
          content: 'There was an error while handling that queue interaction.',
          ephemeral: true,
        })
        .catch(() => {});
    }
    return true;
  }

  return false;
}

async function postAttendeesForCard(interaction, cardOption) {
  const shortId = extractShortId(cardOption);
  if (!shortId) {
    await interaction.reply({
      content:
        'I could not parse that Trello card. Please provide a valid Trello card link or short ID.',
      ephemeral: true,
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  const queue = queues.get(shortId);
  if (!queue) {
    await interaction.reply({
      content:
        'There is no active queue stored for that Trello card. You must open a queue first.',
      ephemeral: true,
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  await interaction.reply({ content: 'Posting attendees...', ephemeral: true });
  setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);

  await postLiveAttendeesForQueue(interaction.client, queue);
}

module.exports = {
  openQueueForCard,
  handleQueueButtonInteraction,
  postAttendeesForCard,
  logAttendeesForCard,
  cleanupQueueForCard,
  extractShortId,
  fetchCardByShortId,
  buildStructuredLineup,
  buildEditTemplateFromLineup,
  parseEditedLineup,
  applyEditedLineup,
  __getQueue: (shortId) => queues.get(shortId) || null,
};