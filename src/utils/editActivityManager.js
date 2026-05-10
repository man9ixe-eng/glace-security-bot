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

async function resolveLineupForShortId(client, shortId) {
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
      source: saved.logMessageId ? 'log' : 'queue',
      lineup: saved.lineup,
      sessionType: saved.sessionType || saved.lineup.sessionType,
      hostId: saved.hostId || saved.lineup.hostId || null,
      hostName: saved.hostName || saved.lineup.hostName || null,
    };
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
  const resolved = await resolveLineupForShortId(interaction.client, shortId);

  if (!resolved?.lineup) {
    await interaction.editReply(
      'I could not find an active attendee post or saved log for that Trello card yet.',
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
      `**Source:** ${resolved.source === 'log' ? 'Logged Session' : 'Queue / Attendees Post'}`,
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

  const resolved = await resolveLineupForShortId(message.client, pending.shortId);
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
