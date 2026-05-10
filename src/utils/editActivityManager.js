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

function getCandidateQueueChannelIds(preferredChannelId) {
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
    process.env.SESSION_ATTENDEES_LOG_CHANNEL_ID,
  ]);
}

async function fetchTextChannel(client, channelId) {
  if (!channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return null;
  return channel;
}

async function findQueueMessageForCard(client, shortId, card, preferredChannelId) {
  const channelIds = getCandidateQueueChannelIds(preferredChannelId);

  for (const channelId of channelIds) {
    const channel = await fetchTextChannel(client, channelId);
    if (!channel) continue;

    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!messages?.size) continue;

    const matches = [...messages.values()]
      .filter((message) => messageMentionsCard(message, shortId, card))
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

async function recoverSessionFromAttendeesPost({ client, shortId, card, guildId, preferredChannelId }) {
  const sessionType = detectSessionTypeFromCard(card);
  if (!sessionType) return null;

  const foundQueue = await findQueueMessageForCard(client, shortId, card, preferredChannelId);
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
  return getEditableSections(sessionType).some((section) =>
    section.aliases.some((alias) => normalized.includes(`[${alias}]`)),
  );
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
  const lines = String(text || '').split(/\r?\n/);

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
        'Please use their @mention or paste their Discord user ID if Discord does not suggest them.',
    };
  }

  return { ok: true, sections: result };
}

function getReplacementPlan(oldSections, newSections, sessionType) {
  const replacementsByOldId = new Map();
  const changedSpots = [];

  for (const section of getEditableSections(sessionType)) {
    const oldIds = Array.isArray(oldSections?.[section.key]) ? oldSections[section.key].map(String) : [];
    const newIds = Array.isArray(newSections?.[section.key]) ? newSections[section.key].map(String) : [];

    if (oldIds.length !== newIds.length) {
      return {
        ok: false,
        error:
          `The **${section.label}** section has a different amount of people than the original editor message.\n` +
          'For now, only replace the wrong user mention/username and keep the same number of lines.',
      };
    }

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
      changedSpots.push(`${section.label} #${i + 1}`);
    }
  }

  if (!replacementsByOldId.size) {
    return {
      ok: false,
      error: 'I did not see any changed users in that lineup.',
    };
  }

  return {
    ok: true,
    replacements: [...replacementsByOldId.entries()].map(([oldId, newId]) => ({ oldId, newId })),
    changedSpots,
  };
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

async function editStoredMessages(client, sessionRecord, replacementDetails) {
  const edits = {
    attendees: false,
    log: false,
  };

  if (sessionRecord?.attendeesMessageId && sessionRecord?.queueChannelId) {
    const channel = await client.channels.fetch(sessionRecord.queueChannelId).catch(() => null);
    const message = await channel?.messages.fetch(sessionRecord.attendeesMessageId).catch(() => null);

    if (message?.content) {
      const newContent = replaceUserText(message.content, replacementDetails);
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
      const editedEmbeds = message.embeds.map((existingEmbed) => {
        const json = existingEmbed.toJSON();

        if (json.title) json.title = replaceUserText(json.title, replacementDetails);
        if (json.description) json.description = replaceUserText(json.description, replacementDetails);

        if (Array.isArray(json.fields)) {
          json.fields = json.fields.map((field) => ({
            ...field,
            name: replaceUserText(field.name, replacementDetails),
            value: replaceUserText(field.value, replacementDetails),
          }));
        }

        if (json.footer?.text) {
          json.footer = {
            ...json.footer,
            text: replaceUserText(json.footer.text, replacementDetails),
          };
        }

        return EmbedBuilder.from(json);
      });

      await message.edit({ embeds: editedEmbeds }).catch((err) => {
        console.error('[EDITACTIVITY] Failed to edit log message:', err);
      });
      edits.log = true;
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

  const sections = replaceIdsInSections(oldLineup.sections || {}, plan.replacements);
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

  const messageEdits = await editStoredMessages(client, sessionRecord, replacementDetails);

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
  const shortId = extractShortId(cardInput);
  if (!shortId) {
    await interaction.reply({
      content: 'I could not parse that Trello card link or short ID.',
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
  });

  if (!resolved?.lineup) {
    await interaction.editReply(
      'I could not find saved edit data for that Trello card, and I could not recover the attendees post from this channel. Try running `/editactivity` in the same channel where the queue/attendees post was made. If this is a very old log from before edit tracking was saved, I cannot safely match it to the card yet.',
    );
    return;
  }

  const lineup = {
    ...resolved.lineup,
    sessionType: resolved.sessionType || resolved.lineup.sessionType,
    hostId: resolved.lineup.hostId || resolved.hostId || null,
    hostName: resolved.lineup.hostName || resolved.hostName || null,
  };

  const template = buildEditTemplateFromLineup(lineup);
  const embed = new EmbedBuilder()
    .setColor(resolved.source === 'log' ? 0xf44336 : 0x6cb2eb)
    .setTitle('Edit Activity | Current Lineup')
    .setDescription([
      `**Session:** ${card?.name || shortId}`,
      `**Source:** ${resolved.source === 'log' ? 'Logged Session' : resolved.source === 'recovered-attendees' ? 'Recovered Attendees Post' : 'Queue / Attendees Post'}`,
      `**Host:** ${lineup.hostId ? `<@${lineup.hostId}>` : lineup.hostName || 'Unknown'}`,
      '',
      'Reply to this message, or send your corrected lineup as your next message in this channel.',
      'Only change the wrong user mention/username/ID. Keep the section headers and the same number of lines.',
      'If Discord will not suggest someone, paste their Discord user ID instead.',
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
      changes,
      '',
      'I only updated the saved user mentions/IDs. The log format was left alone.',
    ].join('\n'),
  });

  return true;
}

module.exports = {
  startEditActivity,
  handleEditActivityReply,
};
