const { EmbedBuilder } = require('discord.js');
const { atLeastTier } = require('./permissions');
const { createPendingEdit, getPendingEdit, clearPendingEdit, getSession } = require('./editActivityStore');
const {
  extractShortId,
  fetchCardByShortId,
  buildStructuredLineup,
  buildEditTemplateFromLineup,
  parseEditedLineup,
  applyEditedLineup,
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
      sessionType: saved.sessionType,
      hostId: saved.hostId || null,
      hostName: saved.hostName || null,
    };
  }

  return null;
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

  if (!resolved) {
    await interaction.editReply(
      'I could not find an active attendee post or saved log for that Trello card yet.',
    );
    return;
  }

  const template = buildEditTemplateFromLineup(resolved.lineup);
  const embed = new EmbedBuilder()
    .setColor(resolved.source === 'log' ? 0xf44336 : 0x6cb2eb)
    .setTitle('Edit Activity | Current Lineup')
    .setDescription([
      `**Session:** ${card?.name || shortId}`,
      `**Source:** ${resolved.source === 'log' ? 'Logged Session' : 'Queue / Attendees Post'}`,
      `**Host:** ${resolved.hostId ? `<@${resolved.hostId}>` : resolved.hostName || 'Unknown'}`,
      '',
      'Reply to this message with the **FULL corrected lineup** using the exact format below.',
      'Use `None` for empty sections.',
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
    `✅ Editor opened in ${interaction.channel}. Reply to the new message with your corrected lineup.`,
  );
}

async function handleEditActivityReply(message) {
  if (!message.reference?.messageId) return false;
  if (message.author?.bot) return false;

  const pending = getPendingEdit(message.reference.messageId);
  if (!pending) return false;

  if (pending.channelId !== message.channelId) return false;

  if (pending.editorUserId !== message.author.id) {
    await message.reply({
      content: 'Only the staff member who opened `/editactivity` can submit the edited lineup.',
    });
    return true;
  }

  const saved = getSession(pending.shortId);
  const sessionType = saved?.sessionType || (getLiveQueue(pending.shortId)?.sessionType ?? null);
  if (!sessionType) {
    await message.reply({
      content: 'I could not determine the session type for this edit anymore. Please run `/editactivity` again.',
    });
    clearPendingEdit(message.reference.messageId);
    return true;
  }

  const parsed = parseEditedLineup(message.content, sessionType);
  if (!parsed.ok) {
    await message.reply({ content: `❌ ${parsed.error}` });
    return true;
  }

  const applied = await applyEditedLineup(message.client, pending.shortId, parsed.sections, message.author.id);
  if (!applied.ok) {
    await message.reply({ content: `❌ ${applied.error}` });
    return true;
  }

  clearPendingEdit(message.reference.messageId);

  await message.reply({
    content: [
      '✅ **Activity updated successfully.**',
      `**Trello:** ${pending.shortId}`,
      '',
      '```',
      buildEditTemplateFromLineup(applied.lineup),
      '```',
    ].join('\n'),
  });

  return true;
}

module.exports = {
  startEditActivity,
  handleEditActivityReply,
};
