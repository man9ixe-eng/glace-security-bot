// src/utils/sessionQueueManager.js

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const { trelloRequest } = require('./trelloClient');
const { replaceSessionActivity } = require('./activityTracker');
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
  if (sessionType === 'training') return '🔴';
  if (sessionType === 'massshift') return '🟣';
  return '🟡';
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

function sortRoleEntries(entries, priorityStore, guildId) {
  return [...(entries || [])].sort((a, b) => {
    const aLast =
      priorityStore && typeof priorityStore.getLastAttendedAt === 'function'
        ? priorityStore.getLastAttendedAt(guildId, a.userId)
        : 0;
    const bLast =
      priorityStore && typeof priorityStore.getLastAttendedAt === 'function'
        ? priorityStore.getLastAttendedAt(guildId, b.userId)
        : 0;

    if (aLast !== bLast) return aLast - bLast;

    if (a.claimedAt && b.claimedAt) return a.claimedAt - b.claimedAt;
    return 0;
  });
}

function splitSelected(entries, limit, priorityStore, guildId) {
  const sorted = sortRoleEntries(entries, priorityStore, guildId);
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
    .join(' • ');
  const extra =
    backups.length > maxShow ? ` (+${backups.length - maxShow} more)` : '';
  return `🟠 Backups: ${shown}${extra}`;
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
  );
  const cohost = splitSelected(
    queue.roles.cohost || [],
    getRoleLimit(queue, 'cohost'),
    priorityStore,
    guildId,
  );
  const overseer = splitSelected(
    queue.roles.overseer || [],
    getRoleLimit(queue, 'overseer'),
    priorityStore,
    guildId,
  );
  const supervisor = splitSelected(
    queue.roles.supervisor || [],
    getRoleLimit(queue, 'supervisor'),
    priorityStore,
    guildId,
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
    '╔══════════════════════════════════════╗',
    '                              ✅  SELECTED ATTENDEES ✅',
    '╚══════════════════════════════════════╝',
    '',
    lineup.hostId
      ? `🧊 Host: <@${lineup.hostId}>`
      : `🧊 Host: ${lineup.hostName || 'Unknown'}`,
    lineup.sections.cohost?.[0]
      ? `🧊 Co-Host: <@${lineup.sections.cohost[0]}>`
      : '🧊 Co-Host: None selected',
    lineup.sections.overseer?.[0]
      ? `🧊 Overseer: <@${lineup.sections.overseer[0]}>`
      : '🧊 Overseer: None selected',
    '',
    '────────────',
    '',
  ];

  if (lineup.sessionType === 'training') {
    lines.push('🔴  Trainers 🔴');
  } else if (lineup.sessionType === 'massshift') {
    lines.push('🟣  Attendees 🟣');
  } else {
    lines.push('🟡  Interviewers 🟡');
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
    lines.push('', '🟢  Supervisors 🟢');
    supervisorList.forEach((userId, idx) => {
      lines.push(`${idx + 1}. <@${userId}>`);
    });
  }

  lines.push('', '────────────', '');
  lines.push(
    '🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.',
  );
  lines.push(
    '🧊 Failure to join on time will result in a **written warning**.',
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
    content = content.slice(0, 1940) + '\n…';
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

  const headerTop = '╔══════════════════════════════════════╗';
  const headerEmoji = getHeaderEmoji(sessionType);
  const headerTitle = `${headerEmoji} ${cfg.typeLabel} | ${hostName || 'Host'} | ${
    timeText || 'Time'
  } ${headerEmoji}`;
  const headerBottom = '╚══════════════════════════════════════╝';

  const descriptionLines = [
    headerTop,
    headerTitle,
    headerBottom,
    '',
    hostId
      ? `📌  Host: <@${hostId}> (${hostId}) • ${hostName || 'Unknown'}`
      : `📌  Host: ${hostName || 'Unknown'}`,
    startsIn ? `📌  Starts: ${startsIn}` : null,
    timeText ? `📌  Time: ${timeText}` : null,
    '',
    '💠 ROLES 💠',
    '----------------------------------------------------------------',
  ];

  if (sessionType === 'interview') {
    descriptionLines.push(
      'ℹ️  **Co-Host:** Corporate Intern+',
      'ℹ️  **Overseer:** Head Corporate+',
      'ℹ️  **Interviewer (12):** Leadership Intern+',
    );
  } else if (sessionType === 'training') {
    descriptionLines.push(
      'ℹ️  **Co-Host:** Corporate Intern+',
      'ℹ️  **Overseer:** Head Corporate+',
      'ℹ️  **Supervisor (4):** Assistant Manager+',
      'ℹ️  **Trainer (8):** Leadership Intern+',
    );
  } else if (sessionType === 'massshift') {
    descriptionLines.push(
      'ℹ️  **Co-Host:** Executive Manager+',
      'ℹ️  **Overseer:** Head Corporate+',
      'ℹ️  **Attendees (15):** Leadership Intern+',
    );
  }

  descriptionLines.push(
    '',
    '❓  HOW TO JOIN THE QUEUE ❓',
    '----------------------------------------------------------------',
    '- Check the role list above — if your rank is allowed, press **Join Queue** and choose your role from the dropdown.',
    '- You’ll get a popup that says: “You have been added to the (ROLE) Queue.”',
    '- Do NOT join until you are pinged in “Session Attendees” **15 minutes before** the session starts.',
    '- Line up on the number/role you are selected for on "Session Attendees".',
    '- You have 5 minutes after session attendees is posted to join.',
    '',
    '❓ HOW TO LEAVE THE QUEUE/INFORM LATE ARRIVAL ❓',
    '----------------------------------------------------------------',
    '- Click the "Leave Queue" button, which will show up once you join the queue.',
    '- You can only leave the queue BEFORE the session list is posted, at that point, you would have to go to #session-lounge and PING your host with a message stating you need to un-queue.',
    '- If you do not let the host know anything before **5 minutes** after an attendees post was made, you will be given a **Written Warning, and your spot could be given up.**',
    '----------------------------------------------------------------',
    '╭─────── 💠 LINKS 💠 ───────────╮',
    `〰️ Trello Card: ${cardUrl}`,
    '╰─────────────────────────────╯',
  );

  const embed = new EmbedBuilder()
    .setDescription(descriptionLines.filter(Boolean).join('\n'))
    .setColor(cfg.color || 0x6cb2eb);

  const joinRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`queue_joinmenu_${shortId}`)
      .setLabel('Join Queue')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`queue_leave_${shortId}`)
      .setLabel('Leave Queue')
      .setStyle(ButtonStyle.Danger),
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
    content: `✅ Opened queue for **${card.name}** in <#${queueChannel.id}>`,
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
  );
  const overseer = splitSelected(
    queue.roles.overseer,
    getRoleLimit(queue, 'overseer'),
    priorityStore,
    guildId,
  );
  const main = splitSelected(
    queue.roles.interviewer,
    getRoleLimit(queue, 'interviewer'),
    priorityStore,
    guildId,
  );
  const supervisor = splitSelected(
    queue.roles.supervisor,
    getRoleLimit(queue, 'supervisor'),
    priorityStore,
    guildId,
  );

  const headerTop = '╔══════════════════════════════════════╗';
  const headerTitle = '                              ✅  SELECTED ATTENDEES ✅';
  const headerBottom = '╚══════════════════════════════════════╝';

  const lines = [
    headerTop,
    headerTitle,
    headerBottom,
    '',
    queue.hostId
      ? `🧊 Host: <@${queue.hostId}>`
      : `🧊 Host: ${queue.hostName || 'Unknown'}`,
    cohost.selected[0]
      ? `🧊 Co-Host: <@${cohost.selected[0].userId}>`
      : '🧊 Co-Host: None selected',
    overseer.selected[0]
      ? `🧊 Overseer: <@${overseer.selected[0].userId}>`
      : '🧊 Overseer: None selected',
  ];

  const cohostBackups = formatBackupsLine(cohost.backups, 5);
  if (cohostBackups) lines.push(cohostBackups);

  const overseerBackups = formatBackupsLine(overseer.backups, 5);
  if (overseerBackups) lines.push(overseerBackups);

  lines.push('', '────────────', '');

  if (queue.sessionType === 'training') {
    lines.push('🔴  Trainers 🔴');
  } else if (queue.sessionType === 'massshift') {
    lines.push('🟣  Attendees 🟣');
  } else {
    lines.push('🟡  Interviewers 🟡');
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
    lines.push('', '🟢  Supervisors 🟢');

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

  lines.push('', '────────────', '');
  lines.push(
    '🧊 You should now join! Please join within **5 minutes**, or your spot will be given to someone else.',
  );
  lines.push(
    '🧊 Failure to join on time will result in a **written warning**.',
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
    msg = msg.slice(0, 1940) + '\n…';
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

  const logChannelId =
    SESSION_LOG_CHANNEL_ID ||
    SESSION_ATTENDEES_LOG_CHANNEL_ID ||
    queue.channelId;

  const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
  if (!logChannel) {
    console.warn('[LOG] Could not fetch log channel for attendees');
    return { ok: false, reason: 'missing_log_channel' };
  }

  const guildId = queue.guildId || 'global';

  const cohost = splitSelected(
    queue.roles.cohost,
    getRoleLimit(queue, 'cohost'),
    client.priorityStore,
    guildId,
  );
  const overseer = splitSelected(
    queue.roles.overseer,
    getRoleLimit(queue, 'overseer'),
    client.priorityStore,
    guildId,
  );
  const main = splitSelected(
    queue.roles.interviewer,
    getRoleLimit(queue, 'interviewer'),
    client.priorityStore,
    guildId,
  );
  const supervisor = splitSelected(
    queue.roles.supervisor,
    getRoleLimit(queue, 'supervisor'),
    client.priorityStore,
    guildId,
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
      results.push(`<@${entry.userId}> (${entry.userId}) • ${displayName}`);
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
        ? `<@${queue.hostId}> (${queue.hostId}) • ${resolvedHostName}`
        : resolvedHostName,
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
    .setTimestamp();

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
    cardUrl: queue.cardUrl || null,
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

  return { ok: true, shortId, logMessageId: logMessage.id };
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

      const roleLabel =
        roleKey === 'interviewer'
          ? queue.sessionType === 'training'
            ? 'Trainer'
            : queue.sessionType === 'massshift'
            ? 'Attendee'
            : 'Interviewer'
          : roleKey === 'cohost'
          ? 'Co-Host'
          : roleKey.charAt(0).toUpperCase() + roleKey.slice(1);

      await interaction.update({
        content: `You have been added to the **${roleLabel}** queue.`,
        components: [],
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
      await interaction.reply({
        content: removed
          ? 'You have been removed from the queue.'
          : 'You are not currently in this queue.',
        ephemeral: true,
      });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
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