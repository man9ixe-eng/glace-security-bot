const { EmbedBuilder } = require('discord.js');
const { atLeastTier } = require('./permissions');
const { replaceSessionActivity } = require('./activityTracker');
const {
  createPendingEdit,
  getPendingEdit,
  getPendingEditForEditor,
  clearPendingEdit,
  getSession,
  upsertSession,
} = require('./editActivityStore');
const {
  extractShortId,
  fetchCardByShortId,
  buildStructuredLineup,
  buildEditTemplateFromLineup,
} = require('./sessionQueueManager');

const activeQueuesRef = (() => {
  try {
    const mod = require('./sessionQueueManager');
    return mod;
  } catch {
    return {};
  }
})();

function getLiveQueue(shortId) {
  try {
    return activeQueuesRef.__getQueue?.(shortId) || null;
  } catch {
    return null;
  }
}


const RECOVERY_CHANNEL_NAME_HINTS = [
  'session',
  'queue',
  'attendee',
  'attendees',
  'training',
  'interview',
  'mass',
  'log',
];

const RECOVERY_CHANNEL_LIMIT = Number(process.env.EDITACTIVITY_RECOVERY_CHANNEL_LIMIT || 35);

function getEditableSections(sessionType) {
  if (sessionType === 'training') {
    return [
      { key: 'interviewer', label: 'Trainer', aliases: ['trainer', 'trainers'] },
      { key: 'supervisor', label: 'Supervisor', aliases: ['supervisor', 'supervisors'] },
      { key: 'cohost', label: 'Co-Host', aliases: ['co-host', 'cohost', 'co host'] },
      { key: 'overseer', label: 'Overseer', aliases: ['overseer', 'overseers'] },
    ];
  }

  if (sessionType === 'massshift') {
    return [
      { key: 'interviewer', label: 'Attendees', aliases: ['attendee', 'attendees'] },
      { key: 'cohost', label: 'Co-Host', aliases: ['co-host', 'cohost', 'co host'] },
      { key: 'overseer', label: 'Overseer', aliases: ['overseer', 'overseers'] },
    ];
  }

  return [
    { key: 'interviewer', label: 'Interviewer', aliases: ['interviewer', 'interviewers'] },
    { key: 'cohost', label: 'Co-Host', aliases: ['co-host', 'cohost', 'co host'] },
    { key: 'overseer', label: 'Overseer', aliases: ['overseer', 'overseers'] },
  ];
}

function normalizeSectionName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s_]+/g, ' ')
    .replace(/[–—]/g, '-')
    .trim();
}

function emptySections() {
  return {
    interviewer: [],
    supervisor: [],
    cohost: [],
    overseer: [],
  };
}

function detectSessionTypeFromCard(card) {
  const text = `${card?.name || ''}\n${card?.desc || ''}`.toLowerCase();

  if (text.includes('interview')) return 'interview';
  if (text.includes('training')) return 'training';
  if (text.includes('mass shift') || text.includes('massshift') || text.includes('mass-shift')) {
    return 'massshift';
  }

  return null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function messageTextForSearch(message) {
  const parts = [message?.content || ''];

  for (const embed of message?.embeds || []) {
    const data = embed?.toJSON?.() || embed || {};
    if (data.title) parts.push(data.title);
    if (data.description) parts.push(data.description);
    if (data.url) parts.push(data.url);
    if (data.footer?.text) parts.push(data.footer.text);
    for (const field of data.fields || []) {
      parts.push(field.name || '', field.value || '');
    }
  }

  return parts.join('\n');
}

function messageMentionsCard(message, shortId, card) {
  const text = messageTextForSearch(message).toLowerCase();
  const targets = unique([
    shortId,
    card?.shortLink,
    card?.shortUrl,
    card?.url,
    card?.idShort ? String(card.idShort) : null,
  ])
    .map((value) => String(value).toLowerCase())
    .filter(Boolean);

  return targets.some((target) => text.includes(target));
}


function parseDiscordMessageLink(value) {
  const match = String(value || '').trim().match(/discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/i);
  if (!match) return null;
  return {
    guildId: match[1],
    channelId: match[2],
    messageId: match[3],
  };
}

async function fetchMessageFromLink(client, value, expectedGuildId = null) {
  const parsed = parseDiscordMessageLink(value);
  if (!parsed) {
    return { ok: false, error: 'That log_message does not look like a Discord message link.' };
  }

  if (expectedGuildId && parsed.guildId !== expectedGuildId) {
    return { ok: false, error: 'That log_message is from a different server.' };
  }

  const channel = await client.channels.fetch(parsed.channelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    return { ok: false, error: 'I could not access the channel from that message link.' };
  }

  const message = await channel.messages.fetch(parsed.messageId).catch(() => null);
  if (!message) {
    return { ok: false, error: 'I could not find that message. Make sure the bot can see that channel and message.' };
  }

  return { ok: true, channel, message, parsed };
}

function detectSessionTypeFromText(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('training') || text.includes('trainer')) return 'training';
  if (text.includes('interview') || text.includes('interviewer')) return 'interview';
  if (text.includes('mass shift') || text.includes('massshift') || text.includes('mass-shift')) return 'massshift';
  return null;
}

function detectSessionTypeFromMessage(message, card) {
  return detectSessionTypeFromCard(card) || detectSessionTypeFromText(messageTextForSearch(message));
}

function getConfiguredRecoveryChannelIds(preferredChannelId) {
  return unique([
    preferredChannelId,
    process.env.QUEUE_INTERVIEW_CHANNEL_ID,
    process.env.SESSION_QUEUECHANNEL_INTERVIEW_ID,
    process.env.QUEUE_TRAINING_CHANNEL_ID,
    process.env.SESSION_QUEUECHANNEL_TRAINING_ID,
    process.env.QUEUE_MASSSHIFT_CHANNEL_ID,
    process.env.SESSION_QUEUECHANNEL_MASSSHIFT_ID,
    process.env.QUEUE_MASS_SHIFT_CHANNEL_ID,
    process.env.SESSION_QUEUE_CHANNEL_ID,
    process.env.SESSION_QUEUECHANNEL_ID,
    process.env.SESSION_LOG_CHANNEL_ID,
    process.env.SESSION_ATTENDEES_LOG_CHANNEL_ID,
    process.env.ACTIVITY_LOG_CHANNEL_ID,
  ]);
}

async function fetchTextChannel(client, channelId) {
  if (!channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return null;
  return channel;
}

function channelLooksRelevant(channel) {
  const name = String(channel?.name || '').toLowerCase();
  if (!name) return false;
  return RECOVERY_CHANNEL_NAME_HINTS.some((hint) => name.includes(hint));
}

async function getCandidateRecoveryChannels(client, guildId, preferredChannelId) {
  const channels = [];
  const seen = new Set();

  async function addChannel(channel) {
    if (!channel?.id || seen.has(channel.id) || !channel.isTextBased?.()) return;
    seen.add(channel.id);
    channels.push(channel);
  }

  for (const channelId of getConfiguredRecoveryChannelIds(preferredChannelId)) {
    const channel = await fetchTextChannel(client, channelId);
    if (channel) await addChannel(channel);
  }

  const guild = guildId ? await client.guilds.fetch(guildId).catch(() => null) : null;
  const guildChannels = guild ? await guild.channels.fetch().catch(() => null) : null;

  if (guildChannels?.size) {
    const relevant = [...guildChannels.values()]
      .filter((channel) => channel?.isTextBased?.())
      .filter(channelLooksRelevant)
      .sort((a, b) => {
        if (a.id === preferredChannelId) return -1;
        if (b.id === preferredChannelId) return 1;
        return String(a.name || '').localeCompare(String(b.name || ''));
      })
      .slice(0, Number.isFinite(RECOVERY_CHANNEL_LIMIT) && RECOVERY_CHANNEL_LIMIT > 0 ? RECOVERY_CHANNEL_LIMIT : 35);

    for (const channel of relevant) await addChannel(channel);
  }

  return channels;
}

async function findQueueMessageForCard(client, shortId, card, preferredChannelId, guildId) {
  const channels = await getCandidateRecoveryChannels(client, guildId, preferredChannelId);

  for (const channel of channels) {
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!messages?.size) continue;

    const matches = [...messages.values()]
      .filter((message) => messageMentionsCard(message, shortId, card))
      .filter((message) => messageTextForSearch(message).toLowerCase().includes('trello'))
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp);

    if (matches[0]) return { channel, message: matches[0] };
  }

  return null;
}

function looksLikeAttendeesPost(message) {
  const content = String(message?.content || '').toLowerCase();
  return (
    content.includes('selected attendees') ||
    content.includes('you should now join') ||
    content.includes('trainers 🔴') ||
    content.includes('interviewers 🟡') ||
    content.includes('attendees 🟣')
  );
}

async function findAttendeesPostAfterQueue(channel, queueMessage) {
  if (!channel || !queueMessage?.id) return null;

  const afterMessages = await channel.messages.fetch({ after: queueMessage.id, limit: 50 }).catch(() => null);
  const afterMatches = [...(afterMessages?.values?.() || [])]
    .filter(looksLikeAttendeesPost)
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  if (afterMatches[0]) return afterMatches[0];

  const recentMessages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const recentMatches = [...(recentMessages?.values?.() || [])]
    .filter((message) => message.createdTimestamp >= queueMessage.createdTimestamp)
    .filter(looksLikeAttendeesPost)
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  return recentMatches[0] || null;
}

function pushUnique(section, userId) {
  if (!userId) return;
  if (!section.includes(userId)) section.push(userId);
}

function parseAttendeesPostContent(content, sessionType) {
  const sections = emptySections();
  let hostId = null;
  let hostName = null;
  let currentKey = null;

  const lines = String(content || '').split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const lowered = line.toLowerCase();
    if (!line) continue;

    if (/backup/i.test(line)) {
      currentKey = null;
      continue;
    }

    if (lowered.includes('co-host:') || lowered.includes('cohost:')) {
      const id = extractDiscordUserId(line);
      if (id) pushUnique(sections.cohost, id);
      currentKey = null;
      continue;
    }

    if (lowered.includes('overseer:')) {
      const id = extractDiscordUserId(line);
      if (id) pushUnique(sections.overseer, id);
      currentKey = null;
      continue;
    }

    if (lowered.includes('host:')) {
      hostId = extractDiscordUserId(line);
      hostName = hostId ? null : line.replace(/^.*host:\s*/i, '').trim();
      currentKey = null;
      continue;
    }

    if (lowered.includes('supervisors')) {
      currentKey = 'supervisor';
      continue;
    }

    if (lowered.includes('trainers') || lowered.includes('interviewers') || lowered.includes('attendees')) {
      currentKey = 'interviewer';
      continue;
    }

    if (lowered.includes('none selected') || lowered === 'none') continue;
    if (!currentKey) continue;

    const id = extractDiscordUserId(line);
    if (id) pushUnique(sections[currentKey], id);
  }

  const hasAny = Object.values(sections).some((ids) => ids.length);
  if (!hasAny && !hostId && !hostName) return null;

  return {
    shortId: null,
    sessionType,
    hostId,
    hostName,
    sections,
  };
}

function fieldNameMatches(name, patterns) {
  const normalized = String(name || '').toLowerCase();
  return patterns.some((pattern) => normalized.includes(pattern));
}

function extractAllDiscordUserIds(text) {
  return unique(String(text || '').match(/(?:<@!?)?(\d{17,20})>?/g) || [])
    .map((raw) => {
      const match = String(raw).match(/\d{17,20}/);
      return match?.[0] || null;
    })
    .filter(Boolean);
}

function parseSessionLogMessage(message, sessionType) {
  const sections = emptySections();
  let hostId = null;
  let hostName = null;

  const embed = message?.embeds?.[0];
  const data = embed?.toJSON?.() || embed || null;
  if (!data) return null;

  for (const field of data.fields || []) {
    const name = String(field.name || '');
    const value = String(field.value || '');
    const ids = extractAllDiscordUserIds(value);

    if (fieldNameMatches(name, ['host']) && !fieldNameMatches(name, ['co-host', 'cohost'])) {
      hostId = ids[0] || null;
      hostName = hostId ? null : value.trim();
      continue;
    }

    if (fieldNameMatches(name, ['co-host', 'cohost'])) {
      ids.forEach((id) => pushUnique(sections.cohost, id));
      continue;
    }

    if (fieldNameMatches(name, ['overseer'])) {
      ids.forEach((id) => pushUnique(sections.overseer, id));
      continue;
    }

    if (fieldNameMatches(name, ['supervisor'])) {
      ids.forEach((id) => pushUnique(sections.supervisor, id));
      continue;
    }

    if (fieldNameMatches(name, ['trainer', 'interviewer', 'attendee'])) {
      ids.forEach((id) => pushUnique(sections.interviewer, id));
      continue;
    }
  }

  const hasAny = Object.values(sections).some((ids) => ids.length);
  if (!hasAny && !hostId && !hostName) return null;

  return {
    shortId: null,
    sessionType,
    hostId,
    hostName,
    sections,
  };
}


function parseBracketLineupMessage(content, sessionType) {
  const sections = emptySections();
  let currentKey = null;
  let sawSection = false;

  const nameToKey = new Map();
  for (const section of getEditableSections(sessionType)) {
    nameToKey.set(normalizeSectionName(section.label), section.key);
    for (const alias of section.aliases || []) nameToKey.set(normalizeSectionName(alias), section.key);
  }

  const normalized = normalizeLineupReplyInput(content, sessionType);
  for (const rawLine of normalized.split(/\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const sectionMatch = line.match(/^\[(.+)]$/);
    if (sectionMatch) {
      currentKey = nameToKey.get(normalizeSectionName(sectionMatch[1])) || null;
      if (currentKey) sawSection = true;
      continue;
    }

    if (!currentKey) continue;
    if (/^none(?:\s+selected)?\.?$/i.test(line)) continue;

    const ids = extractAllDiscordUserIds(line);
    for (const id of ids) pushUnique(sections[currentKey], id);
  }

  const hasAny = Object.values(sections).some((ids) => ids.length);
  if (!sawSection || !hasAny) return null;

  return {
    shortId: null,
    sessionType,
    hostId: null,
    hostName: null,
    sections,
  };
}

function messageLooksLikeSessionLog(message) {
  const text = messageTextForSearch(message).toLowerCase();
  return (
    text.includes('session') ||
    text.includes('trainer') ||
    text.includes('interviewer') ||
    text.includes('co-host') ||
    text.includes('overseer') ||
    text.includes('[trainer]') ||
    text.includes('[interviewer]')
  );
}

async function recoverSessionFromExactMessage({ client, shortId, card, guildId, messageLink }) {
  if (!messageLink) return null;

  const fetched = await fetchMessageFromLink(client, messageLink, guildId || null);
  if (!fetched.ok) return { error: fetched.error };

  const { channel, message } = fetched;
  const sessionType = detectSessionTypeFromMessage(message, card);
  if (!sessionType) {
    return {
      error: 'I found that message, but I could not tell if it was a training, interview, or mass shift log.',
    };
  }

  if (!messageLooksLikeSessionLog(message)) {
    return {
      error: 'I found that message, but it does not look like a session log or attendees post.',
    };
  }

  let lineup = null;
  if (message.embeds?.length) lineup = parseSessionLogMessage(message, sessionType);
  if (!lineup && message.content) lineup = parseAttendeesPostContent(message.content, sessionType);
  if (!lineup && message.content) lineup = parseBracketLineupMessage(message.content, sessionType);

  if (!lineup) {
    return {
      error: 'I found that message, but I could not read any user IDs/mentions from it.',
    };
  }

  lineup.shortId = shortId;

  const isEmbedLog = Boolean(message.embeds?.length);
  const sessionRecord = upsertSession({
    shortId,
    sessionType,
    hostId: lineup.hostId || null,
    hostName: lineup.hostName || null,
    guildId: guildId || fetched.parsed?.guildId || null,
    cardName: card?.name || null,
    cardUrl: card?.shortUrl || card?.url || null,
    logChannelId: isEmbedLog ? channel.id : null,
    logMessageId: isEmbedLog ? message.id : null,
    queueChannelId: !isEmbedLog ? channel.id : null,
    attendeesMessageId: !isEmbedLog ? message.id : null,
    loggedAt: message.createdTimestamp || Date.now(),
    recoveredAt: Date.now(),
    recoveredFromMessageLink: true,
    lineup,
  });

  return {
    source: isEmbedLog ? 'recovered-log-link' : 'recovered-attendees-link',
    lineup: sessionRecord.lineup,
    sessionType,
    hostId: lineup.hostId || null,
    hostName: lineup.hostName || null,
  };
}

async function findSessionLogForCard(client, shortId, card, preferredChannelId, guildId) {
  const channels = await getCandidateRecoveryChannels(client, guildId, preferredChannelId);

  for (const channel of channels) {
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!messages?.size) continue;

    const matches = [...messages.values()]
      .filter((message) => message.embeds?.length)
      .filter((message) => messageMentionsCard(message, shortId, card))
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp);

    if (matches[0]) return { channel, message: matches[0] };
  }

  return null;
}

async function recoverSessionFromLogMessage({ client, shortId, card, guildId, preferredChannelId }) {
  const sessionType = detectSessionTypeFromCard(card);
  if (!sessionType) return null;

  const foundLog = await findSessionLogForCard(client, shortId, card, preferredChannelId, guildId);
  if (!foundLog?.channel || !foundLog?.message) return null;

  const lineup = parseSessionLogMessage(foundLog.message, sessionType);
  if (!lineup) return null;

  lineup.shortId = shortId;

  const sessionRecord = upsertSession({
    shortId,
    sessionType,
    hostId: lineup.hostId || null,
    hostName: lineup.hostName || null,
    guildId: guildId || null,
    cardName: card?.name || null,
    cardUrl: card?.shortUrl || card?.url || null,
    logChannelId: foundLog.channel.id,
    logMessageId: foundLog.message.id,
    loggedAt: foundLog.message.createdTimestamp || Date.now(),
    recoveredAt: Date.now(),
    lineup,
  });

  return {
    source: 'recovered-log',
    lineup: sessionRecord.lineup,
    sessionType,
    hostId: lineup.hostId || null,
    hostName: lineup.hostName || null,
  };
}

async function recoverSessionFromAttendeesPost({ client, shortId, card, guildId, preferredChannelId }) {
  const sessionType = detectSessionTypeFromCard(card);
  if (!sessionType) return null;

  const foundQueue = await findQueueMessageForCard(client, shortId, card, preferredChannelId, guildId);
  if (!foundQueue?.channel || !foundQueue?.message) return null;

  const attendeesMessage = await findAttendeesPostAfterQueue(foundQueue.channel, foundQueue.message);
  if (!attendeesMessage?.content) return null;

  const lineup = parseAttendeesPostContent(attendeesMessage.content, sessionType);
  if (!lineup) return null;

  lineup.shortId = shortId;

  const sessionRecord = upsertSession({
    shortId,
    sessionType,
    hostId: lineup.hostId || null,
    hostName: lineup.hostName || null,
    guildId: guildId || null,
    cardName: card?.name || null,
    cardUrl: card?.shortUrl || card?.url || null,
    queueChannelId: foundQueue.channel.id,
    queueMessageId: foundQueue.message.id,
    attendeesMessageId: attendeesMessage.id,
    recoveredAt: Date.now(),
    lineup,
  });

  return {
    source: 'recovered-attendees',
    lineup: sessionRecord.lineup,
    sessionType,
    hostId: lineup.hostId || null,
    hostName: lineup.hostName || null,
  };
}

async function resolveLineupForShortId(client, shortId, options = {}) {
  const liveQueue = getLiveQueue(shortId);
  if (liveQueue) {
    return {
      source: liveQueue.isClosed ? 'queue' : 'queue',
      lineup: buildStructuredLineup(liveQueue, client.priorityStore),
      sessionType: liveQueue.sessionType,
      hostId: liveQueue.hostId || null,
      hostName: liveQueue.hostName || null,
    };
  }

  if (options.messageLink) {
    const exact = await recoverSessionFromExactMessage({
      client,
      shortId,
      card: options.card || null,
      guildId: options.guildId || null,
      messageLink: options.messageLink,
    });

    if (exact?.lineup || exact?.error) return exact;
  }

  const saved = getSession(shortId);
  if (saved?.lineup) {
    return {
      source: saved.logMessageId ? 'log' : saved.recoveredAt ? 'recovered-attendees' : 'queue',
      lineup: saved.lineup,
      sessionType: saved.sessionType || saved.lineup.sessionType,
      hostId: saved.hostId || saved.lineup.hostId || null,
      hostName: saved.hostName || saved.lineup.hostName || null,
    };
  }

  if (options.card) {
    const recovered = await recoverSessionFromAttendeesPost({
      client,
      shortId,
      card: options.card,
      guildId: options.guildId || null,
      preferredChannelId: options.channelId || null,
    });

    if (recovered?.lineup) return recovered;

    const recoveredLog = await recoverSessionFromLogMessage({
      client,
      shortId,
      card: options.card,
      guildId: options.guildId || null,
      preferredChannelId: options.channelId || null,
    });

    if (recoveredLog?.lineup) return recoveredLog;
  }

  return null;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractDiscordUserId(text) {
  const raw = String(text || '');
  const mentionMatch = raw.match(/<@!?(\d{17,20})>/);
  if (mentionMatch) return mentionMatch[1];

  const idMatch = raw.match(/\b(\d{17,20})\b/);
  return idMatch?.[1] || null;
}

function cleanPossibleUsername(rawLine) {
  return String(rawLine || '')
    .replace(/^\s*(?:\d+\s*[.)\-:]|[-•*])\s*/u, '')
    .replace(/[`*_~]/g, '')
    .replace(/^@+/, '')
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .trim();
}

function memberNameMatches(member, candidate) {
  const wanted = String(candidate || '').toLowerCase().trim();
  if (!wanted) return false;

  const names = [
    member?.user?.username,
    member?.user?.globalName,
    member?.user?.tag,
    member?.displayName,
    member?.nickname,
  ]
    .filter(Boolean)
    .map((name) => String(name).toLowerCase().trim());

  return names.includes(wanted);
}

async function resolveMemberIdFromLine(guild, line) {
  if (!guild) return null;

  const userId = extractDiscordUserId(line);
  if (userId) return userId;

  const candidate = cleanPossibleUsername(line);
  if (!candidate || /^none(?:\s+selected)?\.?$/i.test(candidate)) return null;

  const cachedExact = guild.members.cache.find((member) => memberNameMatches(member, candidate));
  if (cachedExact) return cachedExact.id;

  const cachedLoose = guild.members.cache.find((member) => {
    const wanted = candidate.toLowerCase();
    return [member.user?.username, member.user?.globalName, member.displayName, member.nickname]
      .filter(Boolean)
      .some((name) => String(name).toLowerCase().includes(wanted));
  });
  if (cachedLoose) return cachedLoose.id;

  const searched = await guild.members.search({ query: candidate.slice(0, 100), limit: 10 }).catch(() => null);
  if (!searched || searched.size === 0) return null;

  const exact = searched.find((member) => memberNameMatches(member, candidate));
  if (exact) return exact.id;

  if (searched.size === 1) return searched.first().id;

  return null;
}

function looksLikeLineupReply(text, sessionType) {
  const normalized = String(text || '').toLowerCase();
  return getEditableSections(sessionType).some((section) => {
    const names = [section.label, ...(section.aliases || [])];
    return names.some((name) => normalized.includes(`[${String(name).toLowerCase()}]`));
  });
}

function normalizeLineupReplyInput(text, sessionType) {
  let normalized = String(text || '')
    .replace(/```(?:\w+)?/g, '')
    .replace(/```/g, '')
    .replace(/\r/g, '')
    .trim();

  // Make one-line edits work too, for example:
  // [Trainer] 123 [Supervisor] None [Co-Host] None [Overseer] None
  const sectionNames = [];
  for (const section of getEditableSections(sessionType)) {
    sectionNames.push(section.label, ...(section.aliases || []));
  }

  for (const name of sectionNames.filter(Boolean)) {
    const escaped = escapeRegex(String(name));
    normalized = normalized.replace(new RegExp(`\\[\\s*${escaped}\\s*\\]`, 'gi'), `\n[${name}]\n`);
  }

  return normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

async function parseLineupReply(text, sessionType, guild) {
  const allowedSections = getEditableSections(sessionType);
  const nameToKey = new Map();

  for (const section of allowedSections) {
    nameToKey.set(normalizeSectionName(section.label), section.key);
    for (const alias of section.aliases || []) {
      nameToKey.set(normalizeSectionName(alias), section.key);
    }
  }

  const result = emptySections();
  let currentSectionKey = null;
  let sawKnownSection = false;
  const unresolved = [];
  const lines = normalizeLineupReplyInput(text, sessionType).split(/\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const sectionMatch = line.match(/^\[(.+)]$/);
    if (sectionMatch) {
      currentSectionKey = nameToKey.get(normalizeSectionName(sectionMatch[1])) || null;
      if (currentSectionKey) sawKnownSection = true;
      continue;
    }

    if (!currentSectionKey) continue;
    if (/^none(?:\s+selected)?\.?$/i.test(line)) continue;

    const resolvedId = await resolveMemberIdFromLine(guild, line);
    if (resolvedId) {
      result[currentSectionKey].push(resolvedId);
    } else {
      unresolved.push(line);
    }
  }

  if (!sawKnownSection) {
    return {
      ok: false,
      error: 'I could not read that lineup. Please keep the section headers like `[Trainer]`, `[Supervisor]`, `[Co-Host]`, and `[Overseer]`.',
    };
  }

  if (unresolved.length) {
    return {
      ok: false,
      error:
        `I could not find this user from your edited message: **${unresolved[0]}**\n` +
        'Please paste their Discord user ID if Discord does not suggest them in the message box.',
    };
  }

  return { ok: true, sections: result };
}

function getReplacementPlan(oldSections, newSections, sessionType) {
  const replacementsByOldId = new Map();
  const changedSpots = [];
  const sectionRewrites = [];
  const nextSections = emptySections();

  for (const section of getEditableSections(sessionType)) {
    const oldIds = Array.isArray(oldSections?.[section.key]) ? oldSections[section.key].map(String) : [];
    const newIds = Array.isArray(newSections?.[section.key]) ? newSections[section.key].map(String) : [];

    if (oldIds.length === newIds.length) {
      nextSections[section.key] = [...oldIds];

      for (let i = 0; i < oldIds.length; i += 1) {
        const oldId = oldIds[i];
        const newId = newIds[i];
        if (oldId === newId) continue;

        const existingNewId = replacementsByOldId.get(oldId);
        if (existingNewId && existingNewId !== newId) {
          return {
            ok: false,
            error:
              `I found the same old user being changed into two different people.\n` +
              'Please run one clean edit at a time so I do not update the wrong person.',
          };
        }

        replacementsByOldId.set(oldId, newId);
        nextSections[section.key][i] = newId;
        changedSpots.push(`${section.label} #${i + 1}`);
      }

      continue;
    }

    // If the amount of lines changed, do not hard-fail anymore.
    // This can happen when Discord will not let staff mention someone, or when
    // a recovered old log did not save every user ID cleanly. In that case, we
    // rewrite only this section's user list instead of rebuilding the whole log.
    nextSections[section.key] = [...newIds];
    sectionRewrites.push(section.key);
    changedSpots.push(`${section.label} section`);

    const pairCount = Math.min(oldIds.length, newIds.length);
    for (let i = 0; i < pairCount; i += 1) {
      const oldId = oldIds[i];
      const newId = newIds[i];
      if (oldId === newId) continue;

      const existingNewId = replacementsByOldId.get(oldId);
      if (existingNewId && existingNewId !== newId) {
        return {
          ok: false,
          error:
            `I found the same old user being changed into two different people.\n` +
            'Please run one clean edit at a time so I do not update the wrong person.',
        };
      }

      replacementsByOldId.set(oldId, newId);
    }
  }

  if (!replacementsByOldId.size && !sectionRewrites.length) {
    return {
      ok: false,
      error: 'I did not see any changed users in that lineup.',
    };
  }

  return {
    ok: true,
    replacements: [...replacementsByOldId.entries()].map(([oldId, newId]) => ({ oldId, newId })),
    changedSpots,
    nextSections,
    sectionRewrites,
  };
}

function getSectionKeyForLogField(fieldName, sessionType) {
  const name = String(fieldName || '').toLowerCase();

  for (const section of getEditableSections(sessionType)) {
    const aliases = [section.label, ...(section.aliases || [])]
      .filter(Boolean)
      .map((alias) => String(alias).toLowerCase());

    if (aliases.some((alias) => name.includes(alias))) return section.key;

    if (section.key === 'interviewer' && sessionType === 'training' && name.includes('trainer')) return section.key;
    if (section.key === 'interviewer' && sessionType === 'interview' && name.includes('interviewer')) return section.key;
    if (section.key === 'interviewer' && sessionType === 'massshift' && name.includes('attendee')) return section.key;
  }

  return null;
}

function formatLogSectionValue(ids) {
  const cleanIds = Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
  if (!cleanIds.length) return 'None';
  return cleanIds.map((id, index) => `${index + 1}. <@${id}> (${id})`).join('\n');
}

function formatPlainSectionList(ids) {
  const cleanIds = Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
  if (!cleanIds.length) return 'None';
  return cleanIds.map((id, index) => `${index + 1}. <@${id}>`).join('\n');
}

function rewriteSimpleBracketSections(content, lineup, rewriteKeys = []) {
  if (!content || !lineup?.sessionType || !rewriteKeys?.length) return content;

  let output = String(content);
  const sections = getEditableSections(lineup.sessionType);
  const rewriteSet = new Set(rewriteKeys.map(String));

  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    if (!rewriteSet.has(section.key)) continue;

    const currentNames = [section.label, ...(section.aliases || [])].filter(Boolean).map(escapeRegex);
    const futureNames = sections
      .filter((other) => other.key !== section.key)
      .flatMap((other) => [other.label, ...(other.aliases || [])])
      .filter(Boolean)
      .map(escapeRegex);

    const headerPattern = `\\[\\s*(?:${currentNames.join('|')})\\s*\\]`;
    const nextHeaderPattern = futureNames.length ? `(?=\\n\\s*\\[\\s*(?:${futureNames.join('|')})\\s*\\])` : '$';
    const sectionRegex = new RegExp(`${headerPattern}[\\s\\S]*?${nextHeaderPattern}`, 'i');
    const replacement = `[${section.label}]\n${formatPlainSectionList(lineup.sections?.[section.key] || [])}\n`;

    if (sectionRegex.test(output)) {
      output = output.replace(sectionRegex, replacement);
    }
  }

  return output.trim();
}

function buildDirectReplacementSections(oldSections, oldUserId, newUserId) {
  const next = emptySections();
  let found = false;

  for (const key of Object.keys(next)) {
    const ids = Array.isArray(oldSections?.[key]) ? oldSections[key].map(String) : [];
    next[key] = ids.map((id) => {
      if (id === String(oldUserId)) {
        found = true;
        return String(newUserId);
      }
      return id;
    });
  }

  return { found, sections: next };
}

function replaceIdsInSections(oldSections, replacements) {
  const map = new Map(replacements.map((entry) => [entry.oldId, entry.newId]));
  const next = emptySections();

  for (const key of Object.keys(next)) {
    const seen = new Set();
    const ids = Array.isArray(oldSections?.[key]) ? oldSections[key].map(String) : [];

    for (const id of ids) {
      const replacement = map.get(id) || id;
      if (seen.has(replacement)) continue;
      seen.add(replacement);
      next[key].push(replacement);
    }
  }

  return next;
}

async function getGuildDisplayName(client, guildId, userId) {
  if (!guildId || !userId) return `Unknown (${userId})`;

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  const member = await guild?.members.fetch(userId).catch(() => null);
  return member?.displayName || member?.user?.globalName || member?.user?.username || `Unknown (${userId})`;
}

function replaceUserText(value, replacementDetails) {
  if (typeof value !== 'string' || !value.length) return value;

  let output = value;

  for (const replacement of replacementDetails) {
    const oldId = escapeRegex(replacement.oldId);
    const newId = replacement.newId;
    const newName = replacement.newName || `Unknown (${newId})`;

    const richLogPattern = new RegExp(
      `<@!?${oldId}>\\s*(?:\\(\\s*${oldId}\\s*\\))?(?:\\s*•\\s*[^\\n\\r]*)?`,
      'g',
    );

    output = output.replace(richLogPattern, (match) => {
      if (match.includes('•') || match.includes('(')) {
        return `<@${newId}> (${newId}) • ${newName}`;
      }
      return `<@${newId}>`;
    });

    output = output
      .replace(new RegExp(`<@!?${oldId}>`, 'g'), `<@${newId}>`)
      .replace(new RegExp(`\\b${oldId}\\b`, 'g'), newId);
  }

  return output;
}

async function editStoredMessages(client, sessionRecord, replacementDetails, lineup = null, sectionRewrites = []) {
  const edits = {
    attendees: false,
    log: false,
  };
  const rewriteKeys = new Set((sectionRewrites || []).map(String));

  if (sessionRecord?.attendeesMessageId && sessionRecord?.queueChannelId) {
    const channel = await client.channels.fetch(sessionRecord.queueChannelId).catch(() => null);
    const message = await channel?.messages.fetch(sessionRecord.attendeesMessageId).catch(() => null);

    if (message?.content) {
      let newContent = message.content;
      if (replacementDetails.length) {
        newContent = replaceUserText(newContent, replacementDetails);
      }
      if (lineup && rewriteKeys.size) {
        newContent = rewriteSimpleBracketSections(newContent, lineup, [...rewriteKeys]);
      }

      if (newContent !== message.content) {
        await message.edit({ content: newContent }).catch((err) => {
          console.error('[EDITACTIVITY] Failed to edit attendees message:', err);
        });
        edits.attendees = true;
      }
    }
  }

  if (sessionRecord?.logMessageId && sessionRecord?.logChannelId) {
    const channel = await client.channels.fetch(sessionRecord.logChannelId).catch(() => null);
    const message = await channel?.messages.fetch(sessionRecord.logMessageId).catch(() => null);

    if (message?.embeds?.length) {
      let changed = false;
      const editedEmbeds = message.embeds.map((existingEmbed) => {
        const json = existingEmbed.toJSON();

        if (json.title) {
          const nextTitle = replaceUserText(json.title, replacementDetails);
          if (nextTitle !== json.title) changed = true;
          json.title = nextTitle;
        }
        if (json.description) {
          const nextDescription = replaceUserText(json.description, replacementDetails);
          if (nextDescription !== json.description) changed = true;
          json.description = nextDescription;
        }

        if (Array.isArray(json.fields)) {
          json.fields = json.fields.map((field) => {
            const sectionKey = lineup?.sessionType ? getSectionKeyForLogField(field.name, lineup.sessionType) : null;
            const nextField = { ...field };

            const nextName = replaceUserText(nextField.name, replacementDetails);
            if (nextName !== nextField.name) changed = true;
            nextField.name = nextName;

            if (sectionKey && rewriteKeys.has(sectionKey)) {
              nextField.value = formatLogSectionValue(lineup.sections?.[sectionKey] || []);
              changed = true;
            } else {
              const nextValue = replaceUserText(nextField.value, replacementDetails);
              if (nextValue !== nextField.value) changed = true;
              nextField.value = nextValue;
            }

            return nextField;
          });
        }

        if (json.footer?.text) {
          const nextFooterText = replaceUserText(json.footer.text, replacementDetails);
          if (nextFooterText !== json.footer.text) changed = true;
          json.footer = {
            ...json.footer,
            text: nextFooterText,
          };
        }

        return EmbedBuilder.from(json);
      });

      if (changed) {
        await message.edit({ embeds: editedEmbeds }).catch((err) => {
          console.error('[EDITACTIVITY] Failed to edit log message:', err);
        });
        edits.log = true;
      }
    }
  }

  return edits;
}

function updateLiveQueue(shortId, sections) {
  const queue = getLiveQueue(shortId);
  if (!queue?.roles) return;

  for (const key of ['interviewer', 'supervisor', 'cohost', 'overseer']) {
    queue.roles[key] = (sections[key] || []).map((userId) => ({
      userId,
      claimedAt: Date.now(),
    }));
  }
}

async function applyReplyBasedEdit({ client, shortId, oldLineup, newSections, editorId, guildId }) {
  const sessionType = oldLineup.sessionType;
  const plan = getReplacementPlan(oldLineup.sections || {}, newSections, sessionType);
  if (!plan.ok) return plan;

  const sections = plan.nextSections || replaceIdsInSections(oldLineup.sections || {}, plan.replacements);
  const existingRecord = getSession(shortId) || {};

  const lineup = {
    ...oldLineup,
    shortId,
    sessionType,
    sections,
    editedBy: editorId,
    editedAt: Date.now(),
  };

  const sessionRecord = upsertSession({
    ...existingRecord,
    shortId,
    sessionType,
    hostId: lineup.hostId || null,
    hostName: lineup.hostName || null,
    guildId: existingRecord.guildId || guildId || null,
    lineup,
  });

  updateLiveQueue(shortId, sections);

  const replacementDetails = [];
  for (const replacement of plan.replacements) {
    replacementDetails.push({
      ...replacement,
      newName: await getGuildDisplayName(client, sessionRecord.guildId || guildId, replacement.newId),
    });
  }

  const messageEdits = await editStoredMessages(
    client,
    sessionRecord,
    replacementDetails,
    lineup,
    plan.sectionRewrites || [],
  );

  if (sessionRecord.logMessageId) {
    const supportEntries = [];
    for (const userId of lineup.sections.interviewer || []) supportEntries.push({ userId, roleKey: 'interviewer' });
    for (const userId of lineup.sections.supervisor || []) supportEntries.push({ userId, roleKey: 'supervisor' });
    for (const userId of lineup.sections.cohost || []) supportEntries.push({ userId, roleKey: 'cohost' });
    for (const userId of lineup.sections.overseer || []) supportEntries.push({ userId, roleKey: 'overseer' });

    replaceSessionActivity({
      shortId,
      hostId: lineup.hostId || null,
      sessionType: lineup.sessionType,
      guildId: sessionRecord.guildId || guildId || null,
      supportEntries,
      timestamp: sessionRecord.loggedAt || Date.now(),
      cancelled: false,
    });
  }

  return {
    ok: true,
    lineup,
    replacements: replacementDetails,
    changedSpots: plan.changedSpots,
    messageEdits,
  };
}

async function startEditActivity(interaction) {
  if (!atLeastTier(interaction.member, 6)) {
    await interaction.reply({
      content: 'You must be **Corporate Team+** to use `/editactivity`.',
      ephemeral: true,
    });
    return;
  }

  const cardInput = interaction.options.getString('card', true);
  const currentUser = interaction.options.getUser('current_user');
  const correctUser = interaction.options.getUser('correct_user');
  const logMessageLink = interaction.options.getString('log_message');
  const shortId = extractShortId(cardInput);
  if (!shortId) {
    await interaction.reply({
      content: 'I could not parse that Trello card link or short ID.',
      ephemeral: true,
    });
    return;
  }

  if ((currentUser && !correctUser) || (!currentUser && correctUser)) {
    await interaction.reply({
      content: 'Please choose both **current_user** and **correct_user**, or leave both blank to use the message editor.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const card = await fetchCardByShortId(shortId).catch(() => null);
  const resolved = await resolveLineupForShortId(interaction.client, shortId, {
    card,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    messageLink: logMessageLink || null,
  });

  if (resolved?.error) {
    await interaction.editReply(`I could not use that log message yet: ${resolved.error}`);
    return;
  }

  if (!resolved?.lineup) {
    await interaction.editReply(
      [
        'I could not find saved edit data for that Trello card, and I could not recover the attendees post or session log from recent queue/log channels.',
        '',
        'For older logs made before Trello card links were saved, run it like this:',
        '`/editactivity card:<trello card> log_message:<message link from #session-logs>`',
        '',
        'After that, I can open the editor and save the link between that card and log.',
      ].join('\n'),
    );
    return;
  }

  const lineup = {
    ...resolved.lineup,
    sessionType: resolved.sessionType || resolved.lineup.sessionType,
    hostId: resolved.lineup.hostId || resolved.hostId || null,
    hostName: resolved.lineup.hostName || resolved.hostName || null,
  };

  if (currentUser && correctUser) {
    const direct = buildDirectReplacementSections(
      lineup.sections || {},
      currentUser.id,
      correctUser.id,
    );

    if (!direct.found) {
      await interaction.editReply(
        `I found the Trello card, but I could not find <@${currentUser.id}> in the saved lineup/log for this card. Open the message editor without the user options if the recovered log is missing IDs.`,
      );
      return;
    }

    const applied = await applyReplyBasedEdit({
      client: interaction.client,
      shortId,
      oldLineup: lineup,
      newSections: direct.sections,
      editorId: interaction.user.id,
      guildId: interaction.guildId,
    });

    if (!applied.ok) {
      await interaction.editReply(`❌ ${applied.error}`);
      return;
    }

    await interaction.editReply([
      '✅ **Activity updated successfully.**',
      `**Trello:** ${shortId}`,
      `**Changed:** <@${currentUser.id}> → <@${correctUser.id}>`,
      '',
      'I only updated the saved user mention/ID and kept the log format alone.',
    ].join('\n'));
    return;
  }

  const template = buildEditTemplateFromLineup(lineup);
  const embed = new EmbedBuilder()
    .setColor(resolved.source === 'log' ? 0xf44336 : 0x6cb2eb)
    .setTitle('Edit Activity | Current Lineup')
    .setDescription([
      `**Session:** ${card?.name || shortId}`,
      `**Source:** ${resolved.source === 'log' ? 'Logged Session' : resolved.source === 'recovered-log' ? 'Recovered Session Log' : resolved.source === 'recovered-log-link' ? 'Recovered Session Log Link' : resolved.source === 'recovered-attendees-link' ? 'Recovered Attendees Link' : resolved.source === 'recovered-attendees' ? 'Recovered Attendees Post' : 'Queue / Attendees Post'}`,
      `**Host:** ${lineup.hostId ? `<@${lineup.hostId}>` : lineup.hostName || 'Unknown'}`,
      '',
      'Reply to this message, or send your corrected lineup as your next message in this channel.',
      'Change the wrong user mention/username/ID under the correct section.',
      'If Discord will not suggest someone in your message, paste their Discord user ID instead, or use `/editactivity` with the optional current_user and correct_user fields.',
    ].join('\n'));

  const prompt = await interaction.channel.send({
    embeds: [embed],
    content: ['```', template, '```'].join('\n'),
  });

  createPendingEdit({
    promptMessageId: prompt.id,
    editorUserId: interaction.user.id,
    channelId: interaction.channelId,
    shortId,
  });

  await interaction.editReply(
    `✅ Editor opened. Reply to the new message with your corrected lineup, or send the corrected lineup as your next message here.`,
  );
}

async function handleEditActivityReply(message) {
  if (message.author?.bot) return false;

  let pending = null;
  let clearPromptMessageId = null;

  if (message.reference?.messageId) {
    pending = getPendingEdit(message.reference.messageId);
    clearPromptMessageId = message.reference.messageId;
  }

  if (!pending) {
    pending = getPendingEditForEditor(message.channelId, message.author.id);
    clearPromptMessageId = pending?.promptMessageId || null;
  }

  if (!pending) return false;
  if (pending.channelId !== message.channelId) return false;

  if (pending.editorUserId !== message.author.id) {
    await message.reply({
      content: 'Only the staff member who opened `/editactivity` can submit the edited lineup.',
    });
    return true;
  }

  const card = await fetchCardByShortId(pending.shortId).catch(() => null);
  const resolved = await resolveLineupForShortId(message.client, pending.shortId, {
    card,
    guildId: message.guildId,
    channelId: message.channelId,
  });
  const sessionType = resolved?.sessionType || resolved?.lineup?.sessionType || getSession(pending.shortId)?.sessionType;

  if (!sessionType || !resolved?.lineup) {
    await message.reply({
      content: 'I could not determine the saved lineup for this edit anymore. Please run `/editactivity` again.',
    });
    if (clearPromptMessageId) clearPendingEdit(clearPromptMessageId);
    return true;
  }

  // If the user did not reply directly to the editor prompt, only catch messages that look like the editor template.
  if (!message.reference?.messageId && !looksLikeLineupReply(message.content, sessionType)) {
    return false;
  }

  const parsed = await parseLineupReply(message.content, sessionType, message.guild);
  if (!parsed.ok) {
    await message.reply({ content: `❌ ${parsed.error}` });
    return true;
  }

  const lineup = {
    ...resolved.lineup,
    shortId: pending.shortId,
    sessionType,
    hostId: resolved.lineup.hostId || resolved.hostId || null,
    hostName: resolved.lineup.hostName || resolved.hostName || null,
  };

  const applied = await applyReplyBasedEdit({
    client: message.client,
    shortId: pending.shortId,
    oldLineup: lineup,
    newSections: parsed.sections,
    editorId: message.author.id,
    guildId: message.guildId,
  });

  if (!applied.ok) {
    await message.reply({ content: `❌ ${applied.error}` });
    return true;
  }

  if (clearPromptMessageId) clearPendingEdit(clearPromptMessageId);

  const changes = applied.replacements
    .map((entry) => `<@${entry.oldId}> → <@${entry.newId}>`)
    .join('\n');

  await message.reply({
    content: [
      '✅ **Activity updated successfully.**',
      `**Trello:** ${pending.shortId}`,
      `**Changed spots:** ${applied.changedSpots.join(', ')}`,
      '',
      changes || 'Section updated from the edited lineup.',
      '',
      'I only updated the saved user mention/ID fields and kept the activity format smooth.',
    ].join('\n'),
  });

  return true;
}

module.exports = {
  startEditActivity,
  handleEditActivityReply,
};
