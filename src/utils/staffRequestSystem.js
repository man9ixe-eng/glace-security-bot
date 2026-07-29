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
const store = require('./staffRequestStore');
const { addLoa } = require('./loaManager');
const { getTier, getTierLabel } = require('./permissions');
const { TIERS } = require('../config/access');

function portalUrl(path = '/ops') {
  const base = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return base ? `${base}${path}` : null;
}
function clean(value, max = 4000) { return String(value ?? '').trim().slice(0, max); }
function parseDate(value, label) {
  const raw = clean(value, 20);
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return { ok: false, error: `${label} must use MM/DD/YYYY.` };
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { ok: false, error: `${label} is not a valid calendar date.` };
  }
  return { ok: true, value: `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`, date };
}
function validateLoaData(data) {
  const start = parseDate(data.startDate, 'Start date');
  if (!start.ok) return start;
  const end = parseDate(data.endDate, 'End date');
  if (!end.ok) return end;
  if (start.date.getUTCDay() !== 1) return { ok: false, error: 'LOA start dates must be a Monday.' };
  if (end.date.getUTCDay() !== 0) return { ok: false, error: 'LOA end dates must be a Sunday.' };
  const diff = Math.round((end.date.getTime() - start.date.getTime()) / 86_400_000);
  if (diff < 6) return { ok: false, error: 'The LOA must end on a Sunday after its Monday start date.' };
  const allowedReasons = new Set(['Personal', 'School/Work', 'Sick', 'Mental Health', 'Vacation', 'Other']);
  const reason = clean(data.reason, 100);
  if (!allowedReasons.has(reason)) return { ok: false, error: 'Reason must be Personal, School/Work, Sick, Mental Health, Vacation, or Other.' };
  const details = clean(data.details, 1500);
  if (reason === 'Other' && !details) return { ok: false, error: 'Please explain the reason when choosing Other.' };
  return { ok: true, data: { startDate: start.value, endDate: end.value, reason, details } };
}
function validateTimezoneData(data) {
  const currentTimezone = clean(data.currentTimezone, 100);
  const requestedTimezone = clean(data.requestedTimezone, 100);
  const reason = clean(data.reason, 1500);
  if (!currentTimezone || !requestedTimezone || !reason) return { ok: false, error: 'Current timezone, requested timezone, and reason are required.' };
  if (currentTimezone.toLowerCase() === requestedTimezone.toLowerCase()) return { ok: false, error: 'The requested timezone must be different from the current timezone.' };
  return { ok: true, data: { currentTimezone, requestedTimezone, reason } };
}
function requestStatusForTier(tier) {
  return Number(tier) >= TIERS.CORPORATE ? 'pending_presidential' : 'pending_corporate';
}
function reviewerLabel(status) {
  return status === 'pending_presidential' ? 'Presidential Review' : 'Corporate Review';
}
function requestTypeLabel(type) {
  return type === 'timezone_change' ? 'Timezone Change' : 'Leave of Absence';
}
function requestColor(type) { return type === 'timezone_change' ? 0x2563eb : 0xc59a42; }
function reviewChannelIdFor(request) {
  if (request.status === 'pending_presidential') {
    return process.env.STAFF_REQUEST_PRESIDENTIAL_REVIEW_CHANNEL_ID
      || process.env.PRESIDENTIAL_REQUEST_REVIEW_CHANNEL_ID
      || process.env.PROMOTION_PRESIDENTIAL_REVIEW_CHANNEL_ID;
  }
  return process.env.STAFF_REQUEST_CORPORATE_REVIEW_CHANNEL_ID
    || process.env.CORPORATE_REQUEST_REVIEW_CHANNEL_ID
    || process.env.PROMOTION_BOARD_REVIEW_CHANNEL_ID;
}
function requestDetailsFields(request) {
  const data = request.requestData || {};
  if (request.type === 'timezone_change') {
    return [
      { name: 'Current Timezone', value: clean(data.currentTimezone, 1024) || 'Not provided', inline: true },
      { name: 'Requested Timezone', value: clean(data.requestedTimezone, 1024) || 'Not provided', inline: true },
      { name: 'Reason', value: clean(data.reason, 1024) || 'Not provided', inline: false },
    ];
  }
  return [
    { name: 'LOA Dates', value: `${clean(data.startDate, 30)} through ${clean(data.endDate, 30)}`, inline: false },
    { name: 'Reason', value: clean(data.reason, 100) || 'Not provided', inline: true },
    { name: 'Details', value: clean(data.details, 1024) || 'No additional details.', inline: false },
  ];
}
function reviewComponents(request, disabled = false) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ghreq:approve:${request.id}`).setLabel('Approve').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`ghreq:return:${request.id}`).setLabel('Return').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`ghreq:deny:${request.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
  const link = portalUrl(`/ops?tab=requests&request=${encodeURIComponent(request.id)}`);
  if (link) row.addComponents(new ButtonBuilder().setLabel('Open Staff Hub').setStyle(ButtonStyle.Link).setURL(link));
  return [row];
}
function reviewEmbed(request) {
  const pending = request.status.startsWith('pending_');
  const embed = new EmbedBuilder()
    .setTitle(`${pending ? 'New' : 'Updated'} ${requestTypeLabel(request.type)} Request`)
    .setDescription(`**${request.requestNumber}** is ready for **${reviewerLabel(request.status)}**.`)
    .addFields(
      { name: 'Submitted By', value: `<@${request.requesterId}> · ${clean(request.requesterTag, 100)}`, inline: false },
      { name: 'Staff Tier', value: clean(request.requesterTierLabel, 100) || getTierLabel(request.requesterTier), inline: true },
      { name: 'Status', value: request.status.replaceAll('_', ' '), inline: true },
      ...requestDetailsFields(request),
    )
    .setColor(requestColor(request.type))
    .setFooter({ text: 'Glace Hotels • Confidential Staff Request' })
    .setTimestamp(new Date(request.updatedAt || request.createdAt || Date.now()));
  if (request.decisionNote) embed.addFields({ name: 'Decision Note', value: clean(request.decisionNote, 1024), inline: false });
  return embed;
}
async function safeDm(client, userId, payload) {
  if (!userId) return false;
  try {
    const user = await client.users.fetch(userId);
    await user.send(payload);
    return true;
  } catch { return false; }
}
async function sendRequestLog(client, request, actionLabel) {
  const channelId = process.env.STAFF_REQUEST_LOG_CHANNEL_ID || process.env.OPERATIONS_LOG_CHANNEL_ID || process.env.STAFF_OPERATIONS_LOG_CHANNEL_ID;
  if (!channelId) return false;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;
  const embed = new EmbedBuilder()
    .setTitle(`${request.requestNumber} • ${actionLabel}`)
    .addFields(
      { name: 'Request', value: requestTypeLabel(request.type), inline: true },
      { name: 'Staff Member', value: `${request.requesterTag || request.requesterId} (${request.requesterId})`, inline: false },
      { name: 'Status', value: request.status.replaceAll('_', ' '), inline: true },
      { name: 'Reviewed By', value: request.reviewedByTag || 'System', inline: true },
      ...requestDetailsFields(request),
    )
    .setColor(request.status === 'approved' ? 0x16a34a : request.status === 'denied' ? 0xdc2626 : 0xc59a42)
    .setFooter({ text: 'Glace Hotels • Internal Operations Log' })
    .setTimestamp(new Date());
  await channel.send({ embeds: [embed] });
  return true;
}
async function routeRequestToDiscord(client, request) {
  const channelId = reviewChannelIdFor(request);
  if (!channelId) throw new Error(`No ${reviewerLabel(request.status)} channel is configured.`);
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) throw new Error('The configured staff request review channel could not be found.');
  const mentionRole = request.status === 'pending_presidential'
    ? process.env.PRESIDENTIAL_REVIEW_PING_ROLE_ID
    : process.env.CORPORATE_REVIEW_PING_ROLE_ID;
  const message = await channel.send({
    content: mentionRole ? `<@&${mentionRole}>` : undefined,
    embeds: [reviewEmbed(request)],
    components: reviewComponents(request),
    allowedMentions: mentionRole ? { roles: [mentionRole] } : { parse: [] },
  });
  return store.setReviewMessage(request.id, channel.id, message.id);
}
async function updateReviewMessage(client, request) {
  if (!request.reviewChannelId || !request.reviewMessageId) return false;
  const channel = await client.channels.fetch(request.reviewChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;
  const message = await channel.messages.fetch(request.reviewMessageId).catch(() => null);
  if (!message) return false;
  await message.edit({ embeds: [reviewEmbed(request)], components: reviewComponents(request, !request.status.startsWith('pending_')) });
  return true;
}
function requestPanelEmbed() {
  return new EmbedBuilder()
    .setTitle('★ Glace Staff Request Center')
    .setDescription([
      '**Current Leadership Interns+** can submit requests below.',
      '',
      '• **Leave of Absence** — must begin on a Monday and end on a Sunday.',
      '• **Timezone Change** — submit your current timezone, requested timezone, and reason.',
      '',
      'Requests are routed privately to the correct leadership team. You will receive a DM when the status changes.',
    ].join('\n'))
    .setColor(0x1f4d85)
    .setFooter({ text: 'Glace Hotels • The future is what YOU create.' });
}
function requestPanelComponents() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ghreq:new:loa').setLabel('Request LOA').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ghreq:new:timezone').setLabel('Change Timezone').setStyle(ButtonStyle.Secondary),
  );
  const link = portalUrl('/ops?tab=requests');
  if (link) row.addComponents(new ButtonBuilder().setLabel('My Requests').setStyle(ButtonStyle.Link).setURL(link));
  return [row];
}
async function postRequestPanel(client, channelId) {
  const wanted = clean(channelId || process.env.STAFF_REQUEST_PANEL_CHANNEL_ID, 40);
  if (!wanted) throw new Error('STAFF_REQUEST_PANEL_CHANNEL_ID is not configured.');
  const channel = await client.channels.fetch(wanted).catch(() => null);
  if (!channel?.isTextBased?.()) throw new Error('The configured request panel channel could not be found.');
  const message = await channel.send({ embeds: [requestPanelEmbed()], components: requestPanelComponents() });
  return { channelId: channel.id, messageId: message.id };
}
function loaModal() {
  return new ModalBuilder().setCustomId('ghreq:submit:loa').setTitle('Glace LOA Request').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('startDate').setLabel('Start Date — Monday (MM/DD/YYYY)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('endDate').setLabel('End Date — Sunday (MM/DD/YYYY)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason Category').setPlaceholder('Personal, School/Work, Sick, Mental Health, Vacation, or Other').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('details').setLabel('Additional Details').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)),
  );
}
function timezoneModal() {
  return new ModalBuilder().setCustomId('ghreq:submit:timezone').setTitle('Timezone Change Request').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('currentTimezone').setLabel('Current Timezone').setPlaceholder('Example: EST / America-New_York').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('requestedTimezone').setLabel('Requested Timezone').setPlaceholder('Example: CST / America-Chicago').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason for Change').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)),
  );
}
function decisionModal(decision, requestId) {
  return new ModalBuilder().setCustomId(`ghreq:decision:${decision}:${requestId}`).setTitle(`${decision[0].toUpperCase()}${decision.slice(1)} Staff Request`).addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId('note').setLabel(decision === 'approve' ? 'Approval Note (optional)' : 'Reason / Instructions')
      .setStyle(TextInputStyle.Paragraph).setRequired(decision !== 'approve').setMaxLength(1500)),
  );
}
async function createFromDiscord(interaction, type, requestData) {
  const tier = getTier(interaction.member);
  if (tier < TIERS.INTERN) throw new Error('Only current Leadership Interns+ can submit staff requests.');
  const validated = type === 'loa' ? validateLoaData(requestData) : validateTimezoneData(requestData);
  if (!validated.ok) throw new Error(validated.error);
  const request = await store.create({
    guildId: interaction.guildId,
    type,
    requesterId: interaction.user.id,
    requesterTag: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
    requesterTier: tier,
    requesterTierLabel: getTierLabel(tier),
    status: requestStatusForTier(tier),
    requestData: validated.data,
  }, { id: interaction.user.id, tag: interaction.member?.displayName || interaction.user.username });
  let routed = request;
  try { routed = await routeRequestToDiscord(interaction.client, request); }
  catch (error) {
    console.error('[STAFF REQUEST] Routing failed:', error);
  }
  await safeDm(interaction.client, interaction.user.id, {
    embeds: [new EmbedBuilder().setTitle(`${routed.requestNumber} Submitted`).setDescription(`Your **${requestTypeLabel(type)}** request was submitted for **${reviewerLabel(routed.status)}**. You will receive another DM when it changes.`).setColor(requestColor(type))],
  });
  return routed;
}
function canReview(member, request) {
  const tier = getTier(member);
  if (request.status === 'pending_presidential') return tier >= TIERS.PRESIDENTIAL;
  if (request.status === 'pending_corporate') return tier >= TIERS.CORPORATE;
  return false;
}
async function applyApprovedRequest(interactionLike, request) {
  if (request.type === 'timezone_change') {
    const data = request.requestData || {};
    const profile = await store.upsertProfile(request.guildId, request.requesterId, {
      discordDisplayName: request.requesterTag,
      timezone: clean(data.requestedTimezone, 100),
      previousTimezone: clean(data.currentTimezone, 100),
      timezoneUpdatedAt: new Date().toISOString(),
    }, { id: interactionLike.user.id, tag: interactionLike.member?.displayName || interactionLike.user.username });
    return { ok: true, type: 'timezone_change', profile };
  }
  const target = interactionLike.guild.members.cache.get(request.requesterId)
    || await interactionLike.guild.members.fetch(request.requesterId).catch(() => null);
  if (!target) throw new Error('The staff member is no longer in the Glace server.');
  const data = request.requestData || {};
  const result = await addLoa(interactionLike, target, {
    startDate: data.startDate,
    endDate: data.endDate,
    reviewerUsername: interactionLike.member?.displayName || interactionLike.user.username,
    reason: data.reason,
    otherReason: data.reason === 'Other' ? data.details : '',
  });
  if (!result.ok) throw new Error(String(result.message || 'The LOA could not be applied.').replace(/^❌\s*/, ''));
  return { ok: true, type: 'loa', message: clean(result.message, 3000) };
}
async function decideRequest(interaction, request, decision, note = '') {
  if (!canReview(interaction.member, request)) throw new Error(`This request requires ${reviewerLabel(request.status)}.`);
  if (decision === 'approve' && String(request.requesterId) === String(interaction.user.id)) throw new Error('You cannot approve your own request.');
  let appliedResult = null;
  if (decision === 'approve') appliedResult = await applyApprovedRequest(interaction, request);
  const updated = await store.decide(request.id, decision, note, {
    id: interaction.user.id,
    tag: interaction.member?.displayName || interaction.user.username,
  }, appliedResult);
  await updateReviewMessage(interaction.client, updated).catch(() => false);
  await sendRequestLog(interaction.client, updated, decision === 'approve' ? 'Approved' : decision === 'return' ? 'Returned' : 'Denied');
  const statusText = decision === 'approve' ? 'approved' : decision === 'return' ? 'returned for changes' : 'denied';
  await safeDm(interaction.client, updated.requesterId, {
    embeds: [new EmbedBuilder()
      .setTitle(`${updated.requestNumber} ${statusText}`)
      .setDescription(`Your **${requestTypeLabel(updated.type)}** request was **${statusText}**.${note ? `\n\n**Note:** ${clean(note, 1500)}` : ''}`)
      .setColor(decision === 'approve' ? 0x16a34a : decision === 'deny' ? 0xdc2626 : 0xc59a42)],
  });
  await safeDm(interaction.client, interaction.user.id, {
    embeds: [new EmbedBuilder()
      .setTitle('Decision Receipt')
      .setDescription(`You **${statusText}** ${updated.requestNumber} for **${updated.requesterTag}**.`)
      .addFields({ name: 'Request Type', value: requestTypeLabel(updated.type), inline: true }, { name: 'Recorded Status', value: updated.status.replaceAll('_', ' '), inline: true })
      .setColor(decision === 'approve' ? 0x16a34a : decision === 'deny' ? 0xdc2626 : 0xc59a42)],
  });
  return updated;
}
async function handleStaffRequestInteraction(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith('ghreq:')) return false;
  if (!interaction.guildId || !interaction.member) {
    await interaction.reply({ content: 'This request system can only be used inside the Glace server.', ephemeral: true }).catch(() => null);
    return true;
  }
  if (interaction.isButton()) {
    if (id === 'ghreq:new:loa') { await interaction.showModal(loaModal()); return true; }
    if (id === 'ghreq:new:timezone') { await interaction.showModal(timezoneModal()); return true; }
    const match = id.match(/^ghreq:(approve|return|deny):(.+)$/);
    if (!match) return false;
    const [, decision, requestId] = match;
    const request = await store.get(requestId, interaction.guildId);
    if (!request) { await interaction.reply({ content: 'This request could not be found.', ephemeral: true }); return true; }
    if (!canReview(interaction.member, request)) { await interaction.reply({ content: `This request requires ${reviewerLabel(request.status)}.`, ephemeral: true }); return true; }
    if (decision === 'approve') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const updated = await decideRequest(interaction, request, 'approve', '');
        await interaction.editReply(`✅ ${updated.requestNumber} was approved and applied.`);
      } catch (error) { await interaction.editReply(`❌ ${error.message}`); }
      return true;
    }
    await interaction.showModal(decisionModal(decision, request.id));
    return true;
  }
  if (interaction.isModalSubmit()) {
    if (id === 'ghreq:submit:loa') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const request = await createFromDiscord(interaction, 'loa', {
          startDate: interaction.fields.getTextInputValue('startDate'),
          endDate: interaction.fields.getTextInputValue('endDate'),
          reason: interaction.fields.getTextInputValue('reason'),
          details: interaction.fields.getTextInputValue('details'),
        });
        await interaction.editReply(`✅ ${request.requestNumber} was submitted for ${reviewerLabel(request.status)}.`);
      } catch (error) { await interaction.editReply(`❌ ${error.message}`); }
      return true;
    }
    if (id === 'ghreq:submit:timezone') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const request = await createFromDiscord(interaction, 'timezone_change', {
          currentTimezone: interaction.fields.getTextInputValue('currentTimezone'),
          requestedTimezone: interaction.fields.getTextInputValue('requestedTimezone'),
          reason: interaction.fields.getTextInputValue('reason'),
        });
        await interaction.editReply(`✅ ${request.requestNumber} was submitted for ${reviewerLabel(request.status)}.`);
      } catch (error) { await interaction.editReply(`❌ ${error.message}`); }
      return true;
    }
    const match = id.match(/^ghreq:decision:(return|deny):(.+)$/);
    if (!match) return false;
    const [, decision, requestId] = match;
    await interaction.deferReply({ ephemeral: true });
    try {
      const request = await store.get(requestId, interaction.guildId);
      if (!request) throw new Error('This request could not be found.');
      const note = interaction.fields.getTextInputValue('note');
      const updated = await decideRequest(interaction, request, decision, note);
      await interaction.editReply(`✅ ${updated.requestNumber} was ${decision === 'return' ? 'returned' : 'denied'}.`);
    } catch (error) { await interaction.editReply(`❌ ${error.message}`); }
    return true;
  }
  return false;
}

module.exports = {
  validateLoaData,
  validateTimezoneData,
  requestStatusForTier,
  reviewerLabel,
  requestTypeLabel,
  routeRequestToDiscord,
  updateReviewMessage,
  postRequestPanel,
  decideRequest,
  handleStaffRequestInteraction,
  createFromDiscord,
};
