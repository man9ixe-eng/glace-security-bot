const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const { trelloRequest } = require('./trelloClient');
const { recordHostedSession, recordSupportSession, replaceSessionActivity } = require('./activityTracker');
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

// ✅ NEW: Dedicated session logging channel (for /logsession and cancel-log YES)
const SESSION_LOG_CHANNEL_ID = process.env.SESSION_LOG_CHANNEL_ID || null;

// Optional: if you want a separate attendees log channel, set this env var.
// Otherwise, logs fall back to the same queue channel.
// (Still supported, but SESSION_LOG_CHANNEL_ID takes priority now.)
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

/**
 * Extract Trello shortId from:
 *  - Full URL: https://trello.com/c/abcd1234/123-name
 *  - Raw shortId: abcd1234
 */
function extractShortId(cardOption) {
  if (!cardOption) return null;

  const urlMatch = cardOption.match(/trello\.com\/c\/([a-zA-Z0-9]+)/);
  if (urlMatch) return urlMatch[1];

  const idMatch = cardOption.match(/^([a-zA-Z0-9]{6,10})$/);
  if (idMatch) return idMatch[1];

  return null;
}

/**
 * Fetch full card data for a Trello shortId.
 * ✅ FIXED: trelloRequest already prefixes /1, so we use /cards/{id}
 * Also trelloRequest returns { ok, status, data }.
 */
async function fetchCardByShortId(shortId) {
  if (!shortId) return null;
  const res = await trelloRequest(`/cards/${shortId}?fields=id,name,shortUrl,desc,idBoard,idList`);
  if (!res?.ok || !res.data) return null;
  return res.data;
}

function inferSessionType(cardName = '', cardDesc = '') {
  const haystack = `${cardName} ${cardDesc}`.toLowerCase();
  if (haystack.includes('mass shift') || haystack.includes('massshift')) return 'massshift';
  if (haystack.includes('training')) return 'training';
  return 'interview';
}

function getSessionDisplayName(sessionType) {
  if (sessionType === 'training') return 'Training';
  if (sessionType === 'massshift') return 'Mass Shift';
  return 'Interview';
}

function getPrimaryRoleLabel(sessionType) {
  if (sessionType === 'training') return 'Trainer';
  if (sessionType === 'massshift') return 'Attendee';
  return 'Interviewer';
}

function getRoleLimit(queue, roleKey) {
  const sessionType = queue?.sessionType || 'interview';

  if (roleKey === 'interviewer') {
    if (sessionType === 'training') return 12;
    if (sessionType === 'massshift') return 50;
    return 12;
  }

  if (roleKey === 'supervisor') {
    return sessionType === 'training' ? ROLE_LIMITS.supervisor : 0;
  }

  return ROLE_LIMITS[roleKey] ?? 0;
}

function makeJoinButton(shortId) {
  return new ButtonBuilder()
    .setCustomId(`sessionqueue:join:${shortId}`)
    .setLabel('Join Queue')
    .setStyle(ButtonStyle.Success);
}

function makeLeaveButton(shortId) {
  return new ButtonBuilder()
    .setCustomId(`sessionqueue:leave:${shortId}`)
    .setLabel('Leave Queue')
    .setStyle(ButtonStyle.Secondary);
}

function makeCloseButton(shortId) {
  return new ButtonBuilder()
    .setCustomId(`sessionqueue:close:${shortId}`)
    .setLabel('Close Queue')
    .setStyle(ButtonStyle.Primary);
}

function makeCancelButton(shortId) {
  return new ButtonBuilder()
    .setCustomId(`sessionqueue:cancel:${shortId}`)
    .setLabel('Cancel Session')
    .setStyle(ButtonStyle.Danger);
}

function buildQueueMessage(queue) {
  const sessionLabel = getSessionDisplayName(queue.sessionType);
  const primaryRoleLabel = getPrimaryRoleLabel(queue.sessionType);
  const emoji = getHeaderEmoji(queue.sessionType);

  const lines = [
    `${emoji} **${sessionLabel} Session Queue**`,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `**Card:** ${queue.cardName || 'Unknown Card'}`,
    queue.cardUrl ? `**Trello:** ${queue.cardUrl}` : null,
    queue.hostId ? `**Host:** <@${queue.hostId}>` : `**Host:** ${queue.hostName || 'Unknown'}`,
    '',
    '**Available Roles**',
    `• ${primaryRoleLabel}`,
    queue.sessionType === 'training' ? '• Supervisor' : null,
    '• Co-Host',
    '• Overseer',
    '',
    '**Queue Status**',
    renderQueueRoleLine(queue, 'interviewer', primaryRoleLabel),
    queue.sessionType === 'training' ? renderQueueRoleLine(queue, 'supervisor', 'Supervisor') : null,
    renderQueueRoleLine(queue, 'cohost', 'Co-Host'),
    renderQueueRoleLine(queue, 'overseer', 'Overseer'),
  ].filter(Boolean);

  return lines.join('\n');
}

function renderQueueRoleLine(queue, roleKey, label) {
  const entries = queue?.roles?.[roleKey] || [];
  const limit = getRoleLimit(queue, roleKey);
  return `• **${label}:** ${entries.length}/${limit}`;
}

async function postQueueMessage(channel, queue) {
  const row = new ActionRowBuilder().addComponents(
    makeJoinButton(queue.shortId),
    makeLeaveButton(queue.shortId),
    makeCloseButton(queue.shortId),
    makeCancelButton(queue.shortId),
  );

  const message = await channel.send({
    content: buildQueueMessage(queue),
    components: [row],
  });

  queue.messageId = message.id;
  queue.channelId = channel.id;
  return message;
}

async function updateQueueMessage(client, queue) {
  if (!queue?.channelId || !queue?.messageId) return;
  const channel = await client.channels.fetch(queue.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const message = await channel.messages.fetch(queue.messageId).catch(() => null);
  if (!message) return;

  const row = new ActionRowBuilder().addComponents(
    makeJoinButton(queue.shortId),
    makeLeaveButton(queue.shortId),
    makeCloseButton(queue.shortId),
    makeCancelButton(queue.shortId),
  );

  await message.edit({
    content: buildQueueMessage(queue),
    components: [row],
  }).catch(() => null);
}

function ensureQueueShape(queue) {
  if (!queue.roles) queue.roles = {};
  if (!Array.isArray(queue.roles.interviewer)) queue.roles.interviewer = [];
  if (!Array.isArray(queue.roles.supervisor)) queue.roles.supervisor = [];
  if (!Array.isArray(queue.roles.cohost)) queue.roles.cohost = [];
  if (!Array.isArray(queue.roles.overseer)) queue.roles.overseer = [];
}

function removeUserFromAllRoles(queue, userId) {
  ensureQueueShape(queue);
  for (const key of ['interviewer', 'supervisor', 'cohost', 'overseer']) {
    queue.roles[key] = queue.roles[key].filter((entry) => entry.userId !== userId);
  }
}

function createQueueEntry(userId, username) {
  return {
    userId,
    username,
    joinedAt: Date.now(),
  };
}

function roleDisplayName(roleKey, queue) {
  if (roleKey === 'interviewer') return getPrimaryRoleLabel(queue.sessionType);
  if (roleKey === 'supervisor') return 'Supervisor';
  if (roleKey === 'cohost') return 'Co-Host';
  if (roleKey === 'overseer') return 'Overseer';
  return roleKey;
}

function buildJoinMenu(shortId, allowedRoles, queue) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`sessionqueue:pickrole:${shortId}`)
      .setPlaceholder('Choose your role')
      .addOptions(
        allowedRoles.map((role) => ({
          label: role.label,
          value: role.key,
          description: `Join as ${role.label} for this ${getSessionDisplayName(queue.sessionType)} session`,
        })),
      ),
  );
}

function getLogEmbedStyle(sessionType) {
  if (sessionType === 'training') {
    return {
      title: 'Training Session | Log',
      color: 0xed4245,
    };
  }

  if (sessionType === 'massshift') {
    return {
      title: 'Mass Shift | Log',
      color: 0x9b59b6,
    };
  }

  return {
    title: 'Interview Session | Log',
    color: 0xfee75c,
  };
}

function parsePriorityScore(store, guildId, userId) {
  try {
    if (!store || typeof store.getPriority !== 'function') return 0;
    const value = store.getPriority(guildId, userId);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function splitSelected(entries, limit, priorityStore, guildId) {
  const normalized = [...(entries || [])].map((entry) => ({
    ...entry,
    priorityScore: parsePriorityScore(priorityStore, guildId, entry.userId),
  }));

  normalized.sort((a, b) => {
    if (a.priorityScore !== b.priorityScore) return a.priorityScore - b.priorityScore;
    return (a.joinedAt || 0) - (b.joinedAt || 0);
  });

  return {
    selected: normalized.slice(0, limit),
    overflow: normalized.slice(limit),
  };
}

async function resolveGuildDisplayName(client, guildId, userId, fallback = 'Unknown') {
  if (!client || !guildId || !userId) return fallback;
  try {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return fallback;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return fallback;
    return member.displayName || member.user?.username || fallback;
  } catch {
    return fallback;
  }
}

async function createQueueForCard(client, channel, hostMember, cardInput) {
  const shortId = extractShortId(cardInput);
  if (!shortId) {
    throw new Error('Could not determine the Trello card short ID.');
  }

  const card = await fetchCardByShortId(shortId);
  if (!card) {
    throw new Error('Could not fetch that Trello card.');
  }

  const sessionType = inferSessionType(card.name, card.desc);

  const queue = {
    shortId,
    cardId: card.id,
    cardName: card.name,
    cardUrl: card.shortUrl,
    sessionType,
    guildId: channel.guildId,
    channelId: channel.id,
    messageId: null,
    attendeesMessageId: null,
    hostId: hostMember?.id || null,
    hostName: hostMember?.displayName || hostMember?.user?.username || 'Unknown Host',
    roles: {
      interviewer: [],
      supervisor: [],
      cohost: [],
      overseer: [],
    },
    createdAt: Date.now(),
  };

  queues.set(shortId, queue);
  await postQueueMessage(channel, queue);
  return queue;
}

async function promptJoinRole(interaction, queue) {
  const member = interaction.member;
  const allowedRoles = getAllowedQueueRoles(queue, member);

  if (!allowedRoles.length) {
    await interaction.reply({
      content: 'You are not high enough rank to join any role for this queue.',
      ephemeral: true,
    });
    return true;
  }

  await interaction.reply({
    content: 'Choose which role you want to join:',
    components: [buildJoinMenu(queue.shortId, allowedRoles, queue)],
    ephemeral: true,
  });
  return true;
}

async function handleRolePick(interaction, shortId) {
  const queue = queues.get(shortId);
  if (!queue) {
    await interaction.update({
      content: 'This queue is no longer active.',
      components: [],
    });
    return true;
  }

  const pickedRole = interaction.values?.[0];
  const allowedRoles = getAllowedQueueRoles(queue, interaction.member);
  const allowed = allowedRoles.find((role) => role.key === pickedRole);

  if (!allowed) {
    await interaction.update({
      content: 'You are not allowed to join that role.',
      components: [],
    });
    return true;
  }

  ensureQueueShape(queue);
  removeUserFromAllRoles(queue, interaction.user.id);

  const roleEntries = queue.roles[pickedRole];
  if (roleEntries.length >= QUEUE_ROLE_HARD_CAP) {
    await interaction.update({
      content: 'That role queue is already full.',
      components: [],
    });
    return true;
  }

  roleEntries.push(
    createQueueEntry(
      interaction.user.id,
      interaction.member?.displayName || interaction.user.username,
    ),
  );

  await updateQueueMessage(interaction.client, queue);
  await interaction.update({
    content: `You have been added to the **${roleDisplayName(pickedRole, queue)}** queue.`,
    components: [],
  });
  return true;
}

async function handleLeave(interaction, shortId) {
  const queue = queues.get(shortId);
  if (!queue) {
    await interaction.reply({
      content: 'This queue is no longer active.',
      ephemeral: true,
    });
    return true;
  }

  removeUserFromAllRoles(queue, interaction.user.id);
  await updateQueueMessage(interaction.client, queue);
  await interaction.reply({
    content: 'You have been removed from the queue.',
    ephemeral: true,
  });
  return true;
}

async function handleClose(interaction, shortId) {
  const queue = queues.get(shortId);
  if (!queue) {
    await interaction.reply({
      content: 'This queue is no longer active.',
      ephemeral: true,
    });
    return true;
  }

  if (interaction.user.id !== queue.hostId) {
    await interaction.reply({
      content: 'Only the session host can close the queue.',
      ephemeral: true,
    });
    return true;
  }

  const guildId = queue.guildId || 'global';
  const cohost = splitSelected(
    queue.roles.cohost,
    getRoleLimit(queue, 'cohost'),
    interaction.client.priorityStore,
    guildId,
  );
  const overseer = splitSelected(
    queue.roles.overseer,
    getRoleLimit(queue, 'overseer'),
    interaction.client.priorityStore,
    guildId,
  );
  const main = splitSelected(
    queue.roles.interviewer,
    getRoleLimit(queue, 'interviewer'),
    interaction.client.priorityStore,
    guildId,
  );
  const supervisor = splitSelected(
    queue.roles.supervisor,
    getRoleLimit(queue, 'supervisor'),
    interaction.client.priorityStore,
    guildId,
  );

  const primaryRoleLabel = getPrimaryRoleLabel(queue.sessionType);
  const attendeesLines = [
    `## ${getSessionDisplayName(queue.sessionType)} Session Attendees`,
    '',
    `**Host:** ${queue.hostId ? `<@${queue.hostId}>` : queue.hostName || 'Unknown'}`,
    '',
    `**${primaryRoleLabel}s**`,
    main.selected.length
      ? main.selected.map((entry, index) => `${index + 1}. <@${entry.userId}>`).join('\n')
      : 'None',
  ];

  if (queue.sessionType === 'training') {
    attendeesLines.push(
      '',
      '**Supervisors**',
      supervisor.selected.length
        ? supervisor.selected.map((entry, index) => `${index + 1}. <@${entry.userId}>`).join('\n')
        : 'None',
    );
  }

  attendeesLines.push(
    '',
    '**Co-Host**',
    cohost.selected.length ? cohost.selected.map((entry) => `<@${entry.userId}>`).join('\n') : 'None',
    '',
    '**Overseer**',
    overseer.selected.length ? overseer.selected.map((entry) => `<@${entry.userId}>`).join('\n') : 'None',
  );

  const message = await interaction.channel.send({
    content: attendeesLines.join('\n'),
  });

  queue.attendeesMessageId = message.id;

  const row = new ActionRowBuilder().addComponents(makeCancelButton(shortId));

  await interaction.update({
    content: `Queue closed. Attendees posted: ${message.url}`,
    components: [row],
  });

  return true;
}

async function handleCancel(interaction, shortId) {
  const queue = queues.get(shortId);
  if (!queue) {
    await interaction.reply({
      content: 'This queue is no longer active.',
      ephemeral: true,
    });
    return true;
  }

  if (interaction.user.id !== queue.hostId) {
    await interaction.reply({
      content: 'Only the session host can cancel this session.',
      ephemeral: true,
    });
    return true;
  }

  const result = await logAttendeesForCard(interaction.client, shortId, {
    recordAttendance: false,
    cancelled: true,
  });

  if (!result?.ok) {
    await interaction.update({
      content: 'The session was cancelled, but I could not log the attendees for it.',
      components: [],
    }).catch(() => {});
    return true;
  }

  await cleanupQueueForCard(interaction.client, shortId);

  await interaction.update({
    content: 'The session has been cancelled and logged.',
    components: [],
  }).catch(() => {});

  return true;
}

async function handleComponent(interaction) {
  const customId = interaction.customId || '';

  if (customId.startsWith('sessionqueue:join:')) {
    const shortId = customId.split(':').pop();
    const queue = queues.get(shortId);
    if (!queue) {
      await interaction.reply({
        content: 'This queue is no longer active.',
        ephemeral: true,
      });
      return true;
    }
    return promptJoinRole(interaction, queue);
  }

  if (customId.startsWith('sessionqueue:leave:')) {
    const shortId = customId.split(':').pop();
    return handleLeave(interaction, shortId);
  }

  if (customId.startsWith('sessionqueue:close:')) {
    const shortId = customId.split(':').pop();
    return handleClose(interaction, shortId);
  }

  if (customId.startsWith('sessionqueue:cancel:')) {
    const shortId = customId.split(':').pop();
    return handleCancel(interaction, shortId);
  }

  if (customId.startsWith('sessionqueue:pickrole:')) {
    const shortId = customId.split(':').pop();
    return handleRolePick(interaction, shortId);
  }

  return false;
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

  const [cohostNames, overseerNames, mainNames, supervisorNames] = await Promise.all([
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

  const mainRoleTitle =
    queue.sessionType === 'training'
      ? 'Trainers'
      : queue.sessionType === 'massshift'
      ? 'Attendees'
      : 'Interviewers';

  const logStyle = getLogEmbedStyle(queue.sessionType);

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
    {
      name: mainRoleTitle,
      value: mainNames.length
        ? mainNames.map((n, i) => `${i + 1}. ${n}`).join('\n')
        : 'None',
    },
  ];

  if (queue.sessionType === 'training') {
    fields.push({
      name: 'Supervisors',
      value: supervisorNames.length
        ? supervisorNames.map((n, i) => `${i + 1}. ${n}`).join('\n')
        : 'None',
    });
  }

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
  }

  return { ok: true, shortId, logMessageId: logMessage.id };
}

async function cleanupQueueForCard(client, cardOptionOrShortId) {
  const shortId = extractShortId(cardOptionOrShortId);
  if (!shortId) return false;

  const queue = queues.get(shortId);
  if (!queue) {
    const stored = getSession(shortId);
    return Boolean(stored);
  }

  if (queue.channelId && queue.messageId) {
    const channel = await client.channels.fetch(queue.channelId).catch(() => null);
    if (channel?.isTextBased?.()) {
      const queueMessage = await channel.messages.fetch(queue.messageId).catch(() => null);
      if (queueMessage) await queueMessage.delete().catch(() => null);

      if (queue.attendeesMessageId) {
        const attendeesMessage = await channel.messages.fetch(queue.attendeesMessageId).catch(() => null);
        if (attendeesMessage) await attendeesMessage.delete().catch(() => null);
      }
    }
  }

  queues.delete(shortId);
  return true;
}

module.exports = {
  createQueueForCard,
  handleComponent,
  logAttendeesForCard,
  cleanupQueueForCard,
  extractShortId,
  queues,
};