'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const promotionStore = require('./promotionStore');
const { getTier, getTierLabel } = require('./permissions');
const { TIERS } = require('../config/access');

function clean(value, max = 4000) { return String(value ?? '').trim().slice(0, max); }
function portalUrl(entry) {
  const base = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return base ? `${base}/ops?tab=promotions&promotion=${encodeURIComponent(entry.id)}` : null;
}
function promotionColor(tier) {
  return ({ 3: 0xec4899, 4: 0x8b5cf6, 5: 0x22c55e, 6: 0xef4444, 7: 0xf59e0b, 8: 0xeab308 })[Number(tier)] || 0x2563eb;
}
function stageLabel(entry) {
  if (entry.status === 'board_review') return 'Corporate Board Review';
  if (entry.status === 'presidential_review') return 'Presidential Review';
  if (entry.status === 'approved_awaiting_completion') return 'Approved — Awaiting Promotion';
  if (entry.status === 'returned_to_corporate') return 'Returned to Corporate';
  if (entry.status === 'denied') return 'Denied';
  if (entry.status === 'completed') return 'Completed';
  return clean(entry.status, 100).replaceAll('_', ' ');
}
function stageChannelId(stage) {
  if (stage === 'presidential') {
    return process.env.PROMOTION_PRESIDENTIAL_REVIEW_CHANNEL_ID
      || process.env.PRESIDENTIAL_PROMOTION_REVIEW_CHANNEL_ID;
  }
  return process.env.PROMOTION_BOARD_REVIEW_CHANNEL_ID
    || process.env.CORPORATE_BOARD_PROMOTION_CHANNEL_ID;
}
function stagePingRoleId(stage) {
  return stage === 'presidential'
    ? process.env.PRESIDENTIAL_REVIEW_PING_ROLE_ID
    : process.env.CORPORATE_BOARD_REVIEW_PING_ROLE_ID;
}
function requiredPresidentialApprovals(entry) {
  return Number(entry.proposedTier) >= TIERS.CORPORATE_BOARD ? 2 : 1;
}
function reviewEmbed(entry, stage) {
  const approvals = Array.isArray(entry.presidentialApprovals) ? entry.presidentialApprovals : [];
  const embed = new EmbedBuilder()
    .setTitle(`★ Promotion Review • ${entry.submissionNumber}`)
    .setDescription(`A promotion submission is ready for **${stage === 'board' ? 'Corporate Board' : 'Presidential'} review**.`)
    .addFields(
      { name: 'Candidate', value: `${clean(entry.candidateUsername, 100) || 'Unknown'}${entry.candidateId ? ` · <@${entry.candidateId}>` : ''}`, inline: false },
      { name: 'Promotion', value: `${clean(entry.currentRank, 100)} → **${clean(entry.proposedRank, 100)}**`, inline: false },
      { name: 'Corporate Submitter', value: `${clean(entry.submittedByTag, 100)}${entry.submittedById ? ` · <@${entry.submittedById}>` : ''}`, inline: false },
      { name: 'Status', value: stageLabel(entry), inline: true },
      { name: 'Presidential Approval', value: `${approvals.length}/${requiredPresidentialApprovals(entry)} recorded`, inline: true },
      { name: 'Recommendation', value: clean(entry.reason, 1024) || 'No recommendation provided.', inline: false },
      { name: 'Strengths', value: clean(entry.strengths, 1024) || 'None provided.', inline: false },
      { name: 'Due Diligence / Evidence', value: clean(entry.evidence, 1024) || 'No evidence provided.', inline: false },
    )
    .setColor(promotionColor(entry.proposedTier))
    .setFooter({ text: 'Glace Hotels • Confidential Promotion Workflow' })
    .setTimestamp(new Date(entry.updatedAt || entry.createdAt || Date.now()));
  if (entry.concerns) embed.addFields({ name: 'Concerns Disclosed', value: clean(entry.concerns, 1024), inline: false });
  if (entry.boardAutoSkipped) embed.addFields({ name: 'Board Stage', value: clean(entry.boardAutoSkipReason, 1024) || 'Automatically routed to Presidential because no current Corporate Board members were detected.', inline: false });
  if (entry.boardDecisionReason) embed.addFields({ name: 'Board Note', value: clean(entry.boardDecisionReason, 1024), inline: false });
  if (entry.presidentialDecisionReason) embed.addFields({ name: 'Presidential Note', value: clean(entry.presidentialDecisionReason, 1024), inline: false });
  return embed;
}
function reviewComponents(entry, stage, disabled = false) {
  const row = new ActionRowBuilder();
  if (stage === 'board') {
    row.addComponents(
      new ButtonBuilder().setCustomId(`ghpromo:board:approve:${entry.id}`).setLabel('Board Approve').setStyle(ButtonStyle.Success).setDisabled(disabled),
      new ButtonBuilder().setCustomId(`ghpromo:board:return:${entry.id}`).setLabel('Return').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId(`ghpromo:board:deny:${entry.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger).setDisabled(disabled),
      new ButtonBuilder().setCustomId(`ghpromo:presidential:override:${entry.id}`).setLabel('Presidential Skip').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    );
  } else {
    row.addComponents(
      new ButtonBuilder().setCustomId(`ghpromo:presidential:approve:${entry.id}`).setLabel('Presidential Approve').setStyle(ButtonStyle.Success).setDisabled(disabled),
      new ButtonBuilder().setCustomId(`ghpromo:presidential:return:${entry.id}`).setLabel('Return').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
      new ButtonBuilder().setCustomId(`ghpromo:presidential:deny:${entry.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger).setDisabled(disabled),
    );
  }
  const link = portalUrl(entry);
  if (link) row.addComponents(new ButtonBuilder().setLabel('Open Approval Site').setStyle(ButtonStyle.Link).setURL(link));
  return [row];
}
async function safeDm(client, userId, payload) {
  if (!userId) return false;
  try {
    const user = await client.users.fetch(userId);
    await user.send(payload);
    return true;
  } catch { return false; }
}
async function hasCurrentBoardMembers(guild) {
  if (!guild) return false;
  const members = await guild.members.fetch().catch(() => guild.members.cache);
  return members.some((member) => !member.user?.bot && getTier(member) === TIERS.CORPORATE_BOARD);
}
async function postStageMessage(client, entry, stage) {
  const channelId = stageChannelId(stage);
  if (!channelId) throw new Error(`${stage === 'board' ? 'PROMOTION_BOARD_REVIEW_CHANNEL_ID' : 'PROMOTION_PRESIDENTIAL_REVIEW_CHANNEL_ID'} is not configured.`);
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) throw new Error('The configured promotion review channel could not be found.');
  const pingRole = stagePingRoleId(stage);
  const message = await channel.send({
    content: pingRole ? `<@&${pingRole}>` : undefined,
    embeds: [reviewEmbed(entry, stage)],
    components: reviewComponents(entry, stage),
    allowedMentions: pingRole ? { roles: [pingRole] } : { parse: [] },
  });
  const changes = stage === 'board'
    ? { boardReviewChannelId: channel.id, boardReviewMessageId: message.id }
    : { presidentialReviewChannelId: channel.id, presidentialReviewMessageId: message.id };
  return promotionStore.setDiscordRouting(entry.id, changes);
}
async function editStageMessage(client, entry, stage, disabled = false) {
  const channelId = stage === 'board' ? entry.boardReviewChannelId : entry.presidentialReviewChannelId;
  const messageId = stage === 'board' ? entry.boardReviewMessageId : entry.presidentialReviewMessageId;
  if (!channelId || !messageId) return false;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return false;
  await message.edit({ embeds: [reviewEmbed(entry, stage)], components: reviewComponents(entry, stage, disabled) });
  return true;
}
async function sendApprovalLog(client, entry) {
  if (entry.approvalLogMessageId) return entry;
  const channelId = process.env.PROMOTION_APPROVAL_LOG_CHANNEL_ID
    || process.env.PROMOTION_LOG_CHANNEL_ID
    || process.env.OPERATIONS_LOG_CHANNEL_ID
    || process.env.STAFF_OPERATIONS_LOG_CHANNEL_ID;
  if (!channelId) return entry;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return entry;
  const approvals = (entry.presidentialApprovals || []).map((x) => x.tag).filter(Boolean).join(', ') || 'Presidential Team';
  const message = await channel.send({
    embeds: [new EmbedBuilder()
      .setTitle(`★ ${entry.submissionNumber} Approved`)
      .setDescription(`The promotion for **${entry.candidateUsername || entry.candidateId}** to **${entry.proposedRank}** has been approved. The assigned Corporate submitter may now apply the promotion.`)
      .addFields(
        { name: 'Corporate Owner', value: entry.assignedCompletionTag || entry.submittedByTag || 'Unknown', inline: true },
        { name: 'Board Stage', value: entry.boardAutoSkipped ? 'Automatically skipped — no Board members detected' : (entry.boardDecision === 'approve' ? 'Approved' : entry.boardDecision || 'Not recorded'), inline: false },
        { name: 'Presidential Approval', value: approvals, inline: false },
      )
      .setColor(promotionColor(entry.proposedTier))
      .setFooter({ text: 'Glace Hotels • Internal Approval Log' })
      .setTimestamp(new Date())],
  });
  return promotionStore.setDiscordRouting(entry.id, { approvalLogMessageId: message.id });
}
async function notifyReviewerReceipt(client, actor, entry, decision, stage) {
  return safeDm(client, actor.id, {
    embeds: [new EmbedBuilder()
      .setTitle('Promotion Decision Receipt')
      .setDescription(`You recorded **${decision}** during **${stage === 'board' ? 'Corporate Board' : 'Presidential'} review** for ${entry.submissionNumber}.`)
      .addFields(
        { name: 'Candidate', value: entry.candidateUsername || entry.candidateId, inline: true },
        { name: 'Promotion', value: `${entry.currentRank} → ${entry.proposedRank}`, inline: false },
        { name: 'Current Status', value: stageLabel(entry), inline: true },
      )
      .setColor(promotionColor(entry.proposedTier))],
  });
}
async function notifySubmitter(client, entry, title, description) {
  return safeDm(client, entry.submittedById, {
    embeds: [new EmbedBuilder().setTitle(title).setDescription(description).setColor(promotionColor(entry.proposedTier)).setFooter({ text: `Glace Hotels • ${entry.submissionNumber}` })],
  });
}
async function routeNewPromotion(client, guild, entry) {
  let routed = entry;
  if (entry.status === 'board_review') routed = await postStageMessage(client, entry, 'board');
  else routed = await postStageMessage(client, entry, 'presidential');
  await notifySubmitter(client, routed, 'Promotion Submitted', routed.status === 'board_review'
    ? `Your promotion submission for **${routed.candidateUsername}** was sent to the Corporate Board review channel.`
    : `No current Corporate Board members were detected, so your promotion submission for **${routed.candidateUsername}** was automatically sent to Presidential review.`);
  return routed;
}
async function syncPromotionDiscord(client, entry, event, actor = {}) {
  let current = entry;
  const stage = event.startsWith('board_') ? 'board' : 'presidential';
  if (event === 'board_approve') {
    await editStageMessage(client, current, 'board', true).catch(() => false);
    if (!current.presidentialReviewMessageId) current = await postStageMessage(client, current, 'presidential');
    await notifySubmitter(client, current, 'Board Review Approved', `The Corporate Board approved ${current.submissionNumber}. It has now been sent to Presidential review.`);
    await notifyReviewerReceipt(client, actor, current, 'Board Approve', 'board');
    return current;
  }
  if (event === 'board_return' || event === 'board_deny') {
    await editStageMessage(client, current, 'board', true).catch(() => false);
    await notifySubmitter(client, current, event === 'board_return' ? 'Promotion Returned' : 'Promotion Denied', event === 'board_return'
      ? `${current.submissionNumber} was returned for changes.${current.boardDecisionReason ? `\n\n**Note:** ${current.boardDecisionReason}` : ''}`
      : `${current.submissionNumber} was denied by Corporate Board.${current.boardDecisionReason ? `\n\n**Note:** ${current.boardDecisionReason}` : ''}`);
    await notifyReviewerReceipt(client, actor, current, event === 'board_return' ? 'Return' : 'Deny', 'board');
    return current;
  }
  if (event === 'presidential_override') {
    await editStageMessage(client, current, 'board', true).catch(() => false);
    if (current.status === 'presidential_review' && !current.presidentialReviewMessageId) current = await postStageMessage(client, current, 'presidential');
    if (current.status === 'approved_awaiting_completion') {
      current = await sendApprovalLog(client, current);
      await notifySubmitter(client, current, 'Promotion Fully Approved', `${current.submissionNumber} was approved through Presidential authority. You may now promote **${current.candidateUsername}** to **${current.proposedRank}** and then verify completion in the Staff Hub.`);
    } else {
      await notifySubmitter(client, current, 'Board Stage Skipped', `${current.submissionNumber} was advanced by Presidential authority. One additional Presidential approval is still required.`);
    }
    await notifyReviewerReceipt(client, actor, current, 'Presidential Skip', 'presidential');
    return current;
  }
  if (event === 'presidential_approve') {
    const final = current.status === 'approved_awaiting_completion';
    await editStageMessage(client, current, 'presidential', final).catch(() => false);
    if (final) {
      current = await sendApprovalLog(client, current);
      await notifySubmitter(client, current, 'Promotion Fully Approved', `${current.submissionNumber} is fully approved. You may now promote **${current.candidateUsername}** to **${current.proposedRank}** and then verify completion in the Staff Hub.`);
    } else {
      await notifySubmitter(client, current, 'Presidential Approval Recorded', `One Presidential approval was recorded for ${current.submissionNumber}. Another Presidential approval is still required.`);
    }
    await notifyReviewerReceipt(client, actor, current, 'Presidential Approve', 'presidential');
    return current;
  }
  if (event === 'presidential_return' || event === 'presidential_deny') {
    await editStageMessage(client, current, 'presidential', true).catch(() => false);
    await notifySubmitter(client, current, event === 'presidential_return' ? 'Promotion Returned' : 'Promotion Denied', event === 'presidential_return'
      ? `${current.submissionNumber} was returned for changes.${current.presidentialDecisionReason ? `\n\n**Note:** ${current.presidentialDecisionReason}` : ''}`
      : `${current.submissionNumber} was denied during Presidential review.${current.presidentialDecisionReason ? `\n\n**Note:** ${current.presidentialDecisionReason}` : ''}`);
    await notifyReviewerReceipt(client, actor, current, event === 'presidential_return' ? 'Return' : 'Deny', 'presidential');
    return current;
  }
  if (event === 'completed') {
    await notifySubmitter(client, current, 'Promotion Completion Verified', `${current.submissionNumber} was verified as completed. No Staff Journey post was sent; announcements remain manual for now.`);
    await safeDm(client, actor.id, { embeds: [new EmbedBuilder().setTitle('Completion Receipt').setDescription(`You verified and completed ${current.submissionNumber} for **${current.candidateUsername}**.`).setColor(0x16a34a)] });
    return current;
  }
  return current;
}
function decisionModal(stage, decision, entryId) {
  return new ModalBuilder().setCustomId(`ghpromo:decision:${stage}:${decision}:${entryId}`).setTitle(`${stage === 'board' ? 'Board' : 'Presidential'} ${decision}`).addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason / Instructions').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1500)),
  );
}
function actor(member, user) { return { id: user.id, tag: member?.displayName || user.globalName || user.username }; }
async function processDecision(interaction, stage, decision, entry, reason = '') {
  const tier = getTier(interaction.member);
  const who = actor(interaction.member, interaction.user);
  let updated;
  if (stage === 'board') {
    if (tier < TIERS.CORPORATE_BOARD) throw new Error('Corporate Board+ is required for this stage.');
    if (String(entry.submittedById) === String(interaction.user.id)) throw new Error('You cannot provide Board approval for a promotion you submitted.');
    updated = await promotionStore.boardDecision(entry.id, decision, reason, who);
    return syncPromotionDiscord(interaction.client, updated, `board_${decision}`, who);
  }
  if (decision === 'override') {
    if (tier < TIERS.PRESIDENTIAL) throw new Error('Presidential access is required to skip Board review.');
    updated = await promotionStore.presidentialOverride(entry.id, reason, who);
    return syncPromotionDiscord(interaction.client, updated, 'presidential_override', who);
  }
  if (tier < TIERS.PRESIDENTIAL) throw new Error('Presidential access is required for this stage.');
  updated = await promotionStore.presidentialDecision(entry.id, decision, reason, who);
  return syncPromotionDiscord(interaction.client, updated, `presidential_${decision}`, who);
}
async function handlePromotionInteraction(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith('ghpromo:')) return false;
  if (!interaction.guildId || !interaction.member) {
    await interaction.reply({ content: 'This promotion workflow can only be used inside the Glace server.', ephemeral: true }).catch(() => null);
    return true;
  }
  if (interaction.isButton()) {
    const match = id.match(/^ghpromo:(board|presidential):(approve|return|deny|override):(.+)$/);
    if (!match) return false;
    const [, stage, decision, entryId] = match;
    const entry = await promotionStore.get(entryId, interaction.guildId);
    if (!entry) { await interaction.reply({ content: 'This promotion submission could not be found.', ephemeral: true }); return true; }
    if (decision === 'approve') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const updated = await processDecision(interaction, stage, decision, entry, '');
        await interaction.editReply(`✅ ${updated.submissionNumber}: ${stage === 'board' ? 'Board approval' : 'Presidential approval'} recorded. Current status: **${stageLabel(updated)}**.`);
      } catch (error) { await interaction.editReply(`❌ ${error.message}`); }
      return true;
    }
    await interaction.showModal(decisionModal(stage, decision, entry.id));
    return true;
  }
  if (interaction.isModalSubmit()) {
    const match = id.match(/^ghpromo:decision:(board|presidential):(return|deny|override):(.+)$/);
    if (!match) return false;
    const [, stage, decision, entryId] = match;
    await interaction.deferReply({ ephemeral: true });
    try {
      const entry = await promotionStore.get(entryId, interaction.guildId);
      if (!entry) throw new Error('This promotion submission could not be found.');
      const reason = interaction.fields.getTextInputValue('reason');
      const updated = await processDecision(interaction, stage, decision, entry, reason);
      await interaction.editReply(`✅ ${updated.submissionNumber} updated. Current status: **${stageLabel(updated)}**.`);
    } catch (error) { await interaction.editReply(`❌ ${error.message}`); }
    return true;
  }
  return false;
}

module.exports = {
  hasCurrentBoardMembers,
  routeNewPromotion,
  syncPromotionDiscord,
  handlePromotionInteraction,
  postStageMessage,
  editStageMessage,
};
