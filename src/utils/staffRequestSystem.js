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
const { addLoa, removeLoa } = require('./loaManager');
const { getTier, getTierLabel } = require('./permissions');
const { TIERS } = require('../config/access');

const REQUEST_TYPES = Object.freeze([
  'resignation',
  'username_update',
  'loa',
  'loa_removal',
  'timezone_change',
]);

function portalUrl(path = '/ops') {
  const base = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return base ? `${base}${path}` : null;
}
function clean(value, max = 4000) { return String(value ?? '').trim().slice(0, max); }
function titleCase(value) {
  return clean(value, 200).replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
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
function todayMmDdYyyy() {
  const now = new Date();
  return `${String(now.getUTCMonth() + 1).padStart(2, '0')}/${String(now.getUTCDate()).padStart(2, '0')}/${now.getUTCFullYear()}`;
}
function requireFields(data, fields) {
  for (const [key, label, max = 500] of fields) {
    const value = clean(data?.[key], max);
    if (!value) return { ok: false, error: `${label} is required.` };
  }
  return { ok: true };
}

function validateLoaData(data) {
  const required = requireFields(data, [
    ['username', 'Username', 100],
    ['rank', 'Rank', 100],
    ['startDate', 'Start date', 20],
    ['endDate', 'End date', 20],
    ['reason', 'Reason', 1500],
  ]);
  if (!required.ok) return required;
  const start = parseDate(data.startDate, 'Start date');
  if (!start.ok) return start;
  const end = parseDate(data.endDate, 'End date');
  if (!end.ok) return end;
  if (start.date.getUTCDay() !== 1) return { ok: false, error: 'LOA start dates must be a Monday.' };
  if (end.date.getUTCDay() !== 0) return { ok: false, error: 'LOA end dates must be a Sunday.' };
  const diff = Math.round((end.date.getTime() - start.date.getTime()) / 86_400_000);
  if (diff < 6) return { ok: false, error: 'The LOA must end on a Sunday after its Monday start date.' };
  return {
    ok: true,
    data: {
      username: clean(data.username, 100),
      rank: clean(data.rank, 100),
      startDate: start.value,
      endDate: end.value,
      reason: clean(data.reason, 1500),
    },
  };
}
function validateTimezoneData(data) {
  const username = clean(data.username || data.requesterUsername, 100);
  const timezone = clean(data.timezone || data.requestedTimezone, 100);
  if (!username || !timezone) return { ok: false, error: 'Username and timezone are required.' };
  return { ok: true, data: { username, timezone, requestedTimezone: timezone } };
}
function validateResignationData(data) {
  const required = requireFields(data, [
    ['username', 'Username', 100],
    ['formerRank', 'Former rank', 100],
    ['newRank', 'New rank', 100],
  ]);
  if (!required.ok) return required;
  return {
    ok: true,
    data: {
      username: clean(data.username, 100),
      formerRank: clean(data.formerRank, 100),
      newRank: clean(data.newRank, 100),
      notes: clean(data.notes, 1500),
    },
  };
}
function validateUsernameUpdateData(data) {
  const required = requireFields(data, [
    ['formerUsername', 'Former username', 100],
    ['newUsername', 'New username', 100],
    ['rank', 'Rank', 100],
  ]);
  if (!required.ok) return required;
  if (clean(data.formerUsername, 100).toLowerCase() === clean(data.newUsername, 100).toLowerCase()) {
    return { ok: false, error: 'The new username must be different from the former username.' };
  }
  return {
    ok: true,
    data: {
      formerUsername: clean(data.formerUsername, 100),
      newUsername: clean(data.newUsername, 100),
      rank: clean(data.rank, 100),
    },
  };
}
function validateLoaRemovalData(data) {
  const required = requireFields(data, [
    ['username', 'Username', 100],
    ['rank', 'Rank', 100],
    ['weeksOnLoa', 'Week(s) on LOA', 100],
  ]);
  if (!required.ok) return required;
  return {
    ok: true,
    data: {
      username: clean(data.username, 100),
      rank: clean(data.rank, 100),
      weeksOnLoa: clean(data.weeksOnLoa, 100),
    },
  };
}
function validateRequestData(type, data) {
  if (type === 'loa') return validateLoaData(data);
  if (type === 'timezone_change') return validateTimezoneData(data);
  if (type === 'resignation') return validateResignationData(data);
  if (type === 'username_update') return validateUsernameUpdateData(data);
  if (type === 'loa_removal') return validateLoaRemovalData(data);
  return { ok: false, error: 'That request type is not supported.' };
}

function requestStatusFor(type, tier) {
  const numericTier = Number(tier);
  if (type === 'resignation') {
    return numericTier >= TIERS.CORPORATE ? 'pending_presidential' : 'pending_board';
  }
  return numericTier >= TIERS.CORPORATE ? 'pending_presidential' : 'pending_corporate';
}
function requestStatusForTier(tier, type = 'loa') { return requestStatusFor(type, tier); }
function reviewerLabel(status) {
  if (status === 'pending_presidential') return 'Presidential Review';
  if (status === 'pending_board') return 'Corporate Board Review';
  if (status === 'pending_corporate') return 'Corporate Review';
  return 'Completed Review';
}
function requestTypeLabel(type) {
  const labels = {
    resignation: 'Resignation',
    username_update: 'Username Update',
    loa: 'Leave of Absence',
    loa_removal: 'LOA Removal',
    timezone_change: 'Timezone Change',
  };
  return labels[type] || titleCase(type);
}
function requestColor(type) {
  return ({
    resignation: 0xdc2626,
    username_update: 0x7c3aed,
    loa: 0xc59a42,
    loa_removal: 0xf97316,
    timezone_change: 0x2563eb,
  })[type] || 0x1f4d85;
}
function reviewChannelIdFor(request) {
  if (request.status === 'pending_presidential') {
    return process.env.STAFF_REQUEST_PRESIDENTIAL_REVIEW_CHANNEL_ID
      || process.env.PRESIDENTIAL_REQUEST_REVIEW_CHANNEL_ID
      || process.env.PROMOTION_PRESIDENTIAL_REVIEW_CHANNEL_ID;
  }
  if (request.status === 'pending_board') {
    return process.env.STAFF_REQUEST_BOARD_REVIEW_CHANNEL_ID
      || process.env.RESIGNATION_REVIEW_CHANNEL_ID
      || process.env.PROMOTION_BOARD_REVIEW_CHANNEL_ID;
  }
  return process.env.STAFF_REQUEST_CORPORATE_REVIEW_CHANNEL_ID
    || process.env.CORPORATE_REQUEST_REVIEW_CHANNEL_ID
    || process.env.PROMOTION_BOARD_REVIEW_CHANNEL_ID;
}
function requestDetailsFields(request) {
  const data = request.requestData || {};
  if (request.type === 'resignation') {
    return [
      { name: 'Username', value: clean(data.username, 1024) || 'Not provided', inline: false },
      { name: 'Former Rank', value: clean(data.formerRank, 1024) || 'Not provided', inline: true },
      { name: 'New Rank', value: clean(data.newRank, 1024) || 'Not provided', inline: true },
      { name: 'Notes', value: clean(data.notes, 1024) || 'No notes provided.', inline: false },
    ];
  }
  if (request.type === 'username_update') {
    return [
      { name: 'Former Username', value: clean(data.formerUsername, 1024) || 'Not provided', inline: true },
      { name: 'New Username', value: clean(data.newUsername, 1024) || 'Not provided', inline: true },
      { name: 'Rank', value: clean(data.rank, 1024) || 'Not provided', inline: false },
    ];
  }
  if (request.type === 'timezone_change') {
    return [
      { name: 'Username', value: clean(data.username, 1024) || request.requesterTag || 'Not provided', inline: true },
      { name: 'Timezone', value: clean(data.timezone || data.requestedTimezone, 1024) || 'Not provided', inline: true },
    ];
  }
  if (request.type === 'loa_removal') {
    return [
      { name: 'Username', value: clean(data.username, 1024) || 'Not provided', inline: true },
      { name: 'Rank', value: clean(data.rank, 1024) || 'Not provided', inline: true },
      { name: 'Week(s) on LOA', value: clean(data.weeksOnLoa, 1024) || 'Not provided', inline: false },
    ];
  }
  return [
    { name: 'Username', value: clean(data.username, 1024) || request.requesterTag || 'Not provided', inline: true },
    { name: 'Rank', value: clean(data.rank, 1024) || request.requesterTierLabel || 'Not provided', inline: true },
    { name: 'LOA Dates', value: `${clean(data.startDate, 30)} through ${clean(data.endDate, 30)}`, inline: false },
    { name: 'Reason', value: clean(data.reason, 1024) || 'Not provided', inline: false },
  ];
}
function reviewComponents(request, disabled = false) {
  const pending = request.status.startsWith('pending_');
  const locked = Boolean(request.reviewClaimedById);
  const row = new ActionRowBuilder();
  if (pending && !locked && !disabled) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`ghreq:claim:${request.id}`).setLabel('Claim Review').setStyle(ButtonStyle.Primary),
    );
  } else if (pending && locked && !disabled) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`ghreq:approve:${request.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`ghreq:return:${request.id}`).setLabel('Return').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`ghreq:deny:${request.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`ghreq:release:${request.id}`).setLabel('Release Review').setStyle(ButtonStyle.Secondary),
    );
  }
  const link = portalUrl(`/ops?tab=requests&request=${encodeURIComponent(request.id)}`);
  if (link && row.components.length < 5) row.addComponents(new ButtonBuilder().setLabel('Open Staff Hub').setStyle(ButtonStyle.Link).setURL(link));
  return row.components.length ? [row] : [];
}
function reviewEmbed(request) {
  const pending = request.status.startsWith('pending_');
  const embed = new EmbedBuilder()
    .setTitle(`${pending ? 'New' : 'Updated'} ${requestTypeLabel(request.type)} Request`)
    .setDescription(`**${request.requestNumber}** is ${pending ? `ready for **${reviewerLabel(request.status)}**` : `now **${request.status.replaceAll('_', ' ')}**`}.`)
    .addFields(
      { name: 'Submitted By', value: `<@${request.requesterId}> \u00B7 ${clean(request.requesterTag, 100)}`, inline: false },
      { name: 'Staff Tier', value: clean(request.requesterTierLabel, 100) || getTierLabel(request.requesterTier), inline: true },
      { name: 'Status', value: request.status.replaceAll('_', ' '), inline: true },
      ...requestDetailsFields(request),
    )
    .setColor(requestColor(request.type))
    .setFooter({ text: 'Glace Hotels \u2022 Confidential Staff Request' })
    .setTimestamp(new Date(request.updatedAt || request.createdAt || Date.now()));
  if (request.reviewClaimedById && pending) {
    embed.addFields({ name: 'Current Reviewer', value: `<@${request.reviewClaimedById}> \u00B7 Only this reviewer may complete the decision.`, inline: false });
  }
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
    .setTitle(`${request.requestNumber} \u2022 ${actionLabel}`)
    .addFields(
      { name: 'Request', value: requestTypeLabel(request.type), inline: true },
      { name: 'Staff Member', value: `${request.requesterTag || request.requesterId} (${request.requesterId})`, inline: false },
      { name: 'Status', value: request.status.replaceAll('_', ' '), inline: true },
      { name: 'Reviewed By', value: request.reviewedByTag || 'System', inline: true },
      ...requestDetailsFields(request),
    )
    .setColor(request.status === 'approved' ? 0x16a34a : request.status === 'denied' ? 0xdc2626 : 0xc59a42)
    .setFooter({ text: 'Glace Hotels \u2022 Internal Operations Log' })
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
    : request.status === 'pending_board'
      ? (process.env.CORPORATE_BOARD_REVIEW_PING_ROLE_ID || process.env.BOARD_REVIEW_PING_ROLE_ID)
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
    .setTitle('\u2605 Glace Staff Request Center')
    .setDescription([
      '**Current Leadership Interns+ may submit the following requests.**',
      '',
      '**RESIGNATION**',
      'Username \u00B7 Former Rank \u00B7 New Rank \u00B7 Notes',
      'Intern Team through Senior Management: reviewed by Corporate Board.',
      'Corporate and Corporate Board: reviewed by Presidential.',
      '',
      '**USERNAME UPDATE**',
      'Former Username \u00B7 New Username \u00B7 Rank',
      '*You may submit a new request whenever it changes.*',
      '',
      '**LEAVE OF ABSENCE**',
      'Username \u00B7 Rank \u00B7 Start Date \u00B7 End Date \u00B7 Reason',
      '`Start date must be a MONDAY. End date must be a SUNDAY.`',
      'If you return during a week, you are still responsible for that week\'s quota.',
      '',
      '**LOA REMOVAL**',
      'Username \u00B7 Rank \u00B7 Week(s) on LOA',
      '',
      '**TIMEZONE**',
      'Username \u00B7 Timezone',
      '*You may submit a new request whenever it changes.*',
      '',
      '**Only one reviewer may react. These review buttons must not be clicked by anyone who is not reviewing.**',
      'The first reviewer is recorded and the bot blocks anyone else from completing it.',
      '**DO NOT** edit a submission after it has been claimed. Delete and submit a new one, or use the returned-request revision in the Staff Hub.',
    ].join('\n'))
    .setColor(0x1f4d85)
    .setFooter({ text: 'Glace Hotels \u2022 The future is what YOU create.' });
}
function requestPanelComponents() {
  const first = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ghreq:new:resignation').setLabel('Resignation').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ghreq:new:username').setLabel('Username Update').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ghreq:new:loa').setLabel('Leave of Absence').setStyle(ButtonStyle.Primary),
  );
  const second = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ghreq:new:loa-removal').setLabel('LOA Removal').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ghreq:new:timezone').setLabel('Timezone Change').setStyle(ButtonStyle.Primary),
  );
  const link = portalUrl('/ops?tab=requests');
  if (link) second.addComponents(new ButtonBuilder().setLabel('My Requests').setStyle(ButtonStyle.Link).setURL(link));
  return [first, second];
}
async function postRequestPanel(client, channelId) {
  const wanted = clean(channelId || process.env.STAFF_REQUEST_PANEL_CHANNEL_ID, 40);
  if (!wanted) throw new Error('STAFF_REQUEST_PANEL_CHANNEL_ID is not configured.');
  const channel = await client.channels.fetch(wanted).catch(() => null);
  if (!channel?.isTextBased?.()) throw new Error('The configured request panel channel could not be found.');
  const message = await channel.send({ embeds: [requestPanelEmbed()], components: requestPanelComponents() });
  return { channelId: channel.id, messageId: message.id };
}
function input(customId, label, { style = TextInputStyle.Short, required = true, maxLength = 100, placeholder = '', value = '' } = {}) {
  const builder = new TextInputBuilder().setCustomId(customId).setLabel(label).setStyle(style).setRequired(required).setMaxLength(maxLength);
  if (placeholder) builder.setPlaceholder(placeholder);
  if (value) builder.setValue(clean(value, maxLength));
  return new ActionRowBuilder().addComponents(builder);
}
function defaultUsername(interaction) { return interaction.member?.displayName || interaction.user.globalName || interaction.user.username; }
function defaultRank(interaction) { return getTierLabel(getTier(interaction.member)); }
function loaModal(interaction) {
  return new ModalBuilder().setCustomId('ghreq:submit:loa').setTitle('Leave of Absence Request').addComponents(
    input('username', 'Username', { value: defaultUsername(interaction) }),
    input('rank', 'Rank', { value: defaultRank(interaction) }),
    input('startDate', 'Start Date - Monday (MM/DD/YYYY)', { maxLength: 10 }),
    input('endDate', 'End Date - Sunday (MM/DD/YYYY)', { maxLength: 10 }),
    input('reason', 'Reason', { style: TextInputStyle.Paragraph, maxLength: 1000 }),
  );
}
function timezoneModal(interaction) {
  return new ModalBuilder().setCustomId('ghreq:submit:timezone').setTitle('Timezone Update').addComponents(
    input('username', 'Username', { value: defaultUsername(interaction) }),
    input('timezone', 'Timezone', { placeholder: 'Example: EST or America/New_York' }),
  );
}
function resignationModal(interaction) {
  return new ModalBuilder().setCustomId('ghreq:submit:resignation').setTitle('Resignation Submission').addComponents(
    input('username', 'Username', { value: defaultUsername(interaction) }),
    input('formerRank', 'Former Rank', { value: defaultRank(interaction) }),
    input('newRank', 'New Rank', { placeholder: 'Example: Former Staff' }),
    input('notes', 'Notes', { style: TextInputStyle.Paragraph, required: false, maxLength: 1000 }),
  );
}
function usernameUpdateModal(interaction) {
  return new ModalBuilder().setCustomId('ghreq:submit:username').setTitle('Username Update').addComponents(
    input('formerUsername', 'Former Username', { value: defaultUsername(interaction) }),
    input('newUsername', 'New Username'),
    input('rank', 'Rank', { value: defaultRank(interaction) }),
  );
}
function loaRemovalModal(interaction) {
  return new ModalBuilder().setCustomId('ghreq:submit:loa-removal').setTitle('LOA Removal Request').addComponents(
    input('username', 'Username', { value: defaultUsername(interaction) }),
    input('rank', 'Rank', { value: defaultRank(interaction) }),
    input('weeksOnLoa', 'Week(s) on LOA', { placeholder: 'Example: 2 weeks' }),
  );
}
function decisionModal(decision, requestId) {
  return new ModalBuilder().setCustomId(`ghreq:decision:${decision}:${requestId}`).setTitle(`${decision[0].toUpperCase()}${decision.slice(1)} Staff Request`).addComponents(
    input('note', decision === 'approve' ? 'Approval Note (optional)' : 'Reason / Instructions', {
      style: TextInputStyle.Paragraph,
      required: decision !== 'approve',
      maxLength: 1500,
    }),
  );
}
async function createFromDiscord(interaction, type, requestData) {
  const tier = getTier(interaction.member);
  if (tier < TIERS.INTERN) throw new Error('Only current Leadership Interns+ can submit staff requests.');
  if (!REQUEST_TYPES.includes(type)) throw new Error('That request type is not supported.');
  const validated = validateRequestData(type, requestData);
  if (!validated.ok) throw new Error(validated.error);
  const request = await store.create({
    guildId: interaction.guildId,
    type,
    requesterId: interaction.user.id,
    requesterTag: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
    requesterTier: tier,
    requesterTierLabel: getTierLabel(tier),
    status: requestStatusFor(type, tier),
    requestData: validated.data,
  }, { id: interaction.user.id, tag: interaction.member?.displayName || interaction.user.username });
  let routed = request;
  try { routed = await routeRequestToDiscord(interaction.client, request); }
  catch (error) { console.error('[STAFF REQUEST] Routing failed:', error); }
  await safeDm(interaction.client, interaction.user.id, {
    embeds: [new EmbedBuilder().setTitle(`${routed.requestNumber} Submitted`).setDescription(`Your **${requestTypeLabel(type)}** request was submitted for **${reviewerLabel(routed.status)}**. You will receive another DM when it changes.`).setColor(requestColor(type))],
  });
  return routed;
}
function canReview(member, request) {
  const tier = getTier(member);
  if (request.status === 'pending_presidential') return tier >= TIERS.PRESIDENTIAL;
  if (request.status === 'pending_board') return tier >= TIERS.CORPORATE_BOARD;
  if (request.status === 'pending_corporate') return tier >= TIERS.CORPORATE;
  return false;
}
async function applyApprovedRequest(interactionLike, request) {
  const data = request.requestData || {};
  if (request.type === 'timezone_change') {
    const profile = await store.upsertProfile(request.guildId, request.requesterId, {
      discordDisplayName: request.requesterTag,
      username: clean(data.username, 100),
      timezone: clean(data.timezone || data.requestedTimezone, 100),
      timezoneUpdatedAt: new Date().toISOString(),
    }, { id: interactionLike.user.id, tag: interactionLike.member?.displayName || interactionLike.user.username });
    return { ok: true, type: 'timezone_change', profile };
  }
  if (request.type === 'username_update') {
    const profile = await store.upsertProfile(request.guildId, request.requesterId, {
      discordDisplayName: request.requesterTag,
      previousUsername: clean(data.formerUsername, 100),
      username: clean(data.newUsername, 100),
      rank: clean(data.rank, 100),
      usernameUpdatedAt: new Date().toISOString(),
    }, { id: interactionLike.user.id, tag: interactionLike.member?.displayName || interactionLike.user.username });
    return { ok: true, type: 'username_update', profile };
  }
  if (request.type === 'resignation') {
    const profile = await store.upsertProfile(request.guildId, request.requesterId, {
      discordDisplayName: request.requesterTag,
      username: clean(data.username, 100),
      status: 'resigned',
      formerRank: clean(data.formerRank, 100),
      newRank: clean(data.newRank, 100),
      resignationNotes: clean(data.notes, 1500),
      resignedAt: new Date().toISOString(),
    }, { id: interactionLike.user.id, tag: interactionLike.member?.displayName || interactionLike.user.username });
    return { ok: true, type: 'resignation', profile, manualRoleUpdateRequired: true };
  }
  const target = interactionLike.guild.members.cache.get(request.requesterId)
    || await interactionLike.guild.members.fetch(request.requesterId).catch(() => null);
  if (!target) throw new Error('The staff member is no longer in the Glace server.');
  if (request.type === 'loa_removal') {
    const result = await removeLoa(interactionLike, target, { endDate: todayMmDdYyyy() });
    if (!result.ok) throw new Error(String(result.message || 'The LOA could not be removed.').replace(/^\u274C\s*/, ''));
    return { ok: true, type: 'loa_removal', message: clean(result.message, 3000), weeksOnLoa: clean(data.weeksOnLoa, 100) };
  }
  const result = await addLoa(interactionLike, target, {
    startDate: data.startDate,
    endDate: data.endDate,
    reviewerUsername: interactionLike.member?.displayName || interactionLike.user.username,
    reason: 'Other',
    otherReason: clean(data.reason, 1500),
  });
  if (!result.ok) throw new Error(String(result.message || 'The LOA could not be applied.').replace(/^\u274C\s*/, ''));
  return { ok: true, type: 'loa', message: clean(result.message, 3000) };
}
async function claimRequest(interaction, request) {
  if (!canReview(interaction.member, request)) throw new Error(`This request requires ${reviewerLabel(request.status)}.`);
  if (String(request.requesterId) === String(interaction.user.id)) throw new Error('You cannot review your own request.');
  const claimed = await store.claimReview(request.id, {
    id: interaction.user.id,
    tag: interaction.member?.displayName || interaction.user.username,
  });
  await updateReviewMessage(interaction.client, claimed).catch(() => false);
  return claimed;
}
async function decideRequest(interaction, request, decision, note = '') {
  if (!canReview(interaction.member, request)) throw new Error(`This request requires ${reviewerLabel(request.status)}.`);
  if (decision === 'approve' && String(request.requesterId) === String(interaction.user.id)) throw new Error('You cannot approve your own request.');
  const claimed = await claimRequest(interaction, request);
  let appliedResult = null;
  if (decision === 'approve') appliedResult = await applyApprovedRequest(interaction, claimed);
  const updated = await store.decide(claimed.id, decision, note, {
    id: interaction.user.id,
    tag: interaction.member?.displayName || interaction.user.username,
  }, appliedResult);
  await updateReviewMessage(interaction.client, updated).catch(() => false);
  await sendRequestLog(interaction.client, updated, decision === 'approve' ? 'Approved' : decision === 'return' ? 'Returned' : 'Denied');
  const statusText = decision === 'approve' ? 'approved' : decision === 'return' ? 'returned for changes' : 'denied';
  const manualNote = updated.type === 'resignation' && decision === 'approve'
    ? '\n\nYour resignation record is approved. Leadership will handle any required Discord or Roblox rank changes manually.'
    : '';
  await safeDm(interaction.client, updated.requesterId, {
    embeds: [new EmbedBuilder()
      .setTitle(`${updated.requestNumber} ${statusText}`)
      .setDescription(`Your **${requestTypeLabel(updated.type)}** request was **${statusText}**.${note ? `\n\n**Note:** ${clean(note, 1500)}` : ''}${manualNote}`)
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
    if (id === 'ghreq:new:loa') { await interaction.showModal(loaModal(interaction)); return true; }
    if (id === 'ghreq:new:timezone') { await interaction.showModal(timezoneModal(interaction)); return true; }
    if (id === 'ghreq:new:resignation') { await interaction.showModal(resignationModal(interaction)); return true; }
    if (id === 'ghreq:new:username') { await interaction.showModal(usernameUpdateModal(interaction)); return true; }
    if (id === 'ghreq:new:loa-removal') { await interaction.showModal(loaRemovalModal(interaction)); return true; }
    const claimMatch = id.match(/^ghreq:claim:(.+)$/);
    if (claimMatch) {
      await interaction.deferReply({ ephemeral: true });
      try {
        const request = await store.get(claimMatch[1], interaction.guildId);
        if (!request) throw new Error('This request could not be found.');
        const claimed = await claimRequest(interaction, request);
        await interaction.editReply(`\u2705 You claimed ${claimed.requestNumber}. Only you can complete or release this review.`);
      } catch (error) { await interaction.editReply(`\u274C ${error.message}`); }
      return true;
    }
    const releaseMatch = id.match(/^ghreq:release:(.+)$/);
    if (releaseMatch) {
      await interaction.deferReply({ ephemeral: true });
      try {
        const request = await store.get(releaseMatch[1], interaction.guildId);
        if (!request) throw new Error('This request could not be found.');
        if (String(request.reviewClaimedById || '') !== String(interaction.user.id)) throw new Error('Only the reviewer who claimed this request may release it.');
        const updated = await store.releaseReview(request.id, { id: interaction.user.id, tag: interaction.member?.displayName || interaction.user.username });
        await updateReviewMessage(interaction.client, updated).catch(() => false);
        await interaction.editReply(`\u2705 ${updated.requestNumber} is available for another reviewer.`);
      } catch (error) { await interaction.editReply(`\u274C ${error.message}`); }
      return true;
    }
    const match = id.match(/^ghreq:(approve|return|deny):(.+)$/);
    if (!match) return false;
    const [, decision, requestId] = match;
    if (decision !== 'approve') {
      await interaction.showModal(decisionModal(decision, requestId));
      return true;
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      const request = await store.get(requestId, interaction.guildId);
      if (!request) throw new Error('This request could not be found.');
      if (!request.reviewClaimedById || String(request.reviewClaimedById) !== String(interaction.user.id)) {
        throw new Error('Claim this request before approving it.');
      }
      const updated = await decideRequest(interaction, request, 'approve', '');
      await interaction.editReply(`\u2705 ${updated.requestNumber} was approved and applied.`);
    } catch (error) { await interaction.editReply(`\u274C ${error.message}`); }
    return true;
  }
  if (interaction.isModalSubmit()) {
    const submitMap = {
      'ghreq:submit:loa': ['loa', () => ({
        username: interaction.fields.getTextInputValue('username'),
        rank: interaction.fields.getTextInputValue('rank'),
        startDate: interaction.fields.getTextInputValue('startDate'),
        endDate: interaction.fields.getTextInputValue('endDate'),
        reason: interaction.fields.getTextInputValue('reason'),
      })],
      'ghreq:submit:timezone': ['timezone_change', () => ({
        username: interaction.fields.getTextInputValue('username'),
        timezone: interaction.fields.getTextInputValue('timezone'),
      })],
      'ghreq:submit:resignation': ['resignation', () => ({
        username: interaction.fields.getTextInputValue('username'),
        formerRank: interaction.fields.getTextInputValue('formerRank'),
        newRank: interaction.fields.getTextInputValue('newRank'),
        notes: interaction.fields.getTextInputValue('notes'),
      })],
      'ghreq:submit:username': ['username_update', () => ({
        formerUsername: interaction.fields.getTextInputValue('formerUsername'),
        newUsername: interaction.fields.getTextInputValue('newUsername'),
        rank: interaction.fields.getTextInputValue('rank'),
      })],
      'ghreq:submit:loa-removal': ['loa_removal', () => ({
        username: interaction.fields.getTextInputValue('username'),
        rank: interaction.fields.getTextInputValue('rank'),
        weeksOnLoa: interaction.fields.getTextInputValue('weeksOnLoa'),
      })],
    };
    if (submitMap[id]) {
      const [type, getData] = submitMap[id];
      await interaction.deferReply({ ephemeral: true });
      try {
        const request = await createFromDiscord(interaction, type, getData());
        await interaction.editReply(`\u2705 ${request.requestNumber} was submitted for ${reviewerLabel(request.status)}.`);
      } catch (error) { await interaction.editReply(`\u274C ${error.message}`); }
      return true;
    }
    const match = id.match(/^ghreq:decision:(return|deny):(.+)$/);
    if (!match) return false;
    const [, decision, requestId] = match;
    await interaction.deferReply({ ephemeral: true });
    try {
      const request = await store.get(requestId, interaction.guildId);
      if (!request) throw new Error('This request could not be found.');
      if (!request.reviewClaimedById || String(request.reviewClaimedById) !== String(interaction.user.id)) {
        throw new Error('Claim this request before returning or denying it.');
      }
      const note = interaction.fields.getTextInputValue('note');
      const updated = await decideRequest(interaction, request, decision, note);
      await interaction.editReply(`\u2705 ${updated.requestNumber} was ${decision === 'return' ? 'returned' : 'denied'}.`);
    } catch (error) { await interaction.editReply(`\u274C ${error.message}`); }
    return true;
  }
  return false;
}

module.exports = {
  REQUEST_TYPES,
  validateLoaData,
  validateTimezoneData,
  validateResignationData,
  validateUsernameUpdateData,
  validateLoaRemovalData,
  validateRequestData,
  requestStatusFor,
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
