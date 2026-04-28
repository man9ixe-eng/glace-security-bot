// src/utils/loaManager.js
// Shared helpers for /addloa and /removeloa.

const axios = require('axios');
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const rolesConfig = require('../config/roles');
const { getLoaRecord, setLoaRecord, clearLoaRecord } = require('./loaStore');

const LOA_PREFIX = '🔕';

const MR_LOA_ROLE_ID = process.env.MR_LOA_ROLE_ID || '1495157788190576741';
const HR_LOA_ROLE_ID = process.env.HR_LOA_ROLE_ID || '1434829767911411874';
const LOA_LOG_CHANNEL_ID = process.env.LOA_LOG_CHANNEL_ID || '1498580557200621578';

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const STAFF_BOARD_ID = process.env.STAFF_JOURNEY_BOARD_ID || process.env.TRELLO_BOARD_ID;
const PROMOTIONS_LIST_ID = process.env.PROMOTIONS_LIST_ID;
const RESIGNITIONS_LIST_ID = process.env.RESIGNITIONS_LIST_ID;
const CONFIGURED_LOA_LABEL_ID = process.env.LABEL_LOA || process.env.TRELLO_LABEL_LOA_ID || process.env.LOA_LABEL_ID;

const CORPORATE_INTERN_ROLE_ID = '1036289067182207008';

const STAFF_CLASSES = {
  intern: { label: 'Intern', level: 3, loaType: 'MR', loaRoleId: MR_LOA_ROLE_ID },
  management: { label: 'Management', level: 4, loaType: 'MR', loaRoleId: MR_LOA_ROLE_ID },
  senior_management: { label: 'Senior Management', level: 5, loaType: 'MR', loaRoleId: MR_LOA_ROLE_ID },
  corporate: { label: 'Corporate', level: 6, loaType: 'HR', loaRoleId: HR_LOA_ROLE_ID },
  corporate_board: { label: 'Corporate Board', level: 6, loaType: 'HR', loaRoleId: HR_LOA_ROLE_ID },
  presidential: { label: 'Presidential', level: 7, loaType: 'HR', loaRoleId: HR_LOA_ROLE_ID },
};

function idSet(ids = []) {
  return new Set((ids || []).filter(Boolean).map(String));
}

function hasAnyConfiguredRole(member, ids = []) {
  const configured = idSet(ids);
  if (!member?.roles?.cache || !configured.size) return false;
  return member.roles.cache.some((role) => configured.has(String(role.id)));
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/<a?:\w+:\d+>/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAllWords(normalized, words = []) {
  return words.every((word) => normalized.includes(word));
}

function hasAnyName(member, matchers = []) {
  if (!member?.roles?.cache) return false;
  return member.roles.cache.some((role) => {
    const name = normalizeText(role.name);
    if (!name || name.includes('former') || name.includes('retired') || name.includes('alumni')) return false;
    return matchers.some((words) => hasAllWords(name, words));
  });
}

function classifyStaffMember(member) {
  if (!member) return null;

  const checks = [
    {
      key: 'presidential',
      ids: rolesConfig.PRESIDENTIAL_ROLE_IDS || [],
      matchers: [
        ['chief', 'executive', 'officer'],
        ['vice', 'president'],
        ['president'],
        ['presidential', 'team'],
      ],
      blocker: (memberToCheck) => hasAnyName(memberToCheck, [['presidential', 'intern']]),
    },
    {
      key: 'corporate_board',
      ids: rolesConfig.CORPORATE_BOARD_ROLE_IDS || [],
      matchers: [
        ['corporate', 'board'],
        ['board', 'director'],
        ['board', 'directors'],
        ['bod'],
        ['presidential', 'intern'],
      ],
    },
    {
      key: 'corporate',
      ids: rolesConfig.CORPORATE_ROLE_IDS || [],
      matchers: [
        ['junior', 'corporate'],
        ['senior', 'corporate'],
        ['head', 'corporate'],
        ['corporate', 'team'],
      ],
      blocker: (memberToCheck) => hasAnyName(memberToCheck, [['corporate', 'intern'], ['corporate', 'board']]),
    },
    {
      key: 'senior_management',
      ids: [...(rolesConfig.SENIOR_MANAGEMENT_ROLE_IDS || []), CORPORATE_INTERN_ROLE_ID],
      matchers: [
        ['senior', 'management'],
        ['executive', 'manager'],
        ['corporate', 'intern'],
      ],
    },
    {
      key: 'management',
      ids: rolesConfig.MANAGEMENT_ROLE_IDS || [],
      matchers: [
        ['management', 'team'],
        ['supervisor'],
        ['assistant', 'manager'],
        ['hotel', 'manager'],
      ],
      blocker: (memberToCheck) => hasAnyName(memberToCheck, [['senior', 'management']]),
    },
    {
      key: 'intern',
      ids: rolesConfig.INTERN_ROLE_IDS || [],
      matchers: [
        ['intern', 'team'],
        ['leadership', 'intern'],
      ],
      blocker: (memberToCheck) => hasAnyName(memberToCheck, [['corporate', 'intern'], ['presidential', 'intern']]),
    },
  ];

  for (const check of checks) {
    if (check.blocker?.(member)) continue;
    if (hasAnyConfiguredRole(member, check.ids) || hasAnyName(member, check.matchers)) {
      return { key: check.key, ...STAFF_CLASSES[check.key] };
    }
  }

  return null;
}

function canManageLoa(member) {
  if (!member?.guild) return false;
  if (member.id === member.guild.ownerId) return true;
  if (Array.isArray(rolesConfig.OWNER_IDS) && rolesConfig.OWNER_IDS.includes(member.id)) return true;

  const staffClass = classifyStaffMember(member);
  return Boolean(staffClass && staffClass.level >= 6);
}

function stripLoaPrefix(name) {
  return String(name || '')
    .replace(/^(?:\s*\u{1F515}\uFE0F?\s*)+/u, '')
    .trim();
}

function hasLoaPrefix(name) {
  return /^(?:\s*\u{1F515}\uFE0F?\s*)+/u.test(String(name || ''));
}

function cleanSavedNickname(name) {
  if (name === null || typeof name === 'undefined') return null;
  const clean = stripLoaPrefix(name);
  return clean || null;
}

function nicknameWithPrefix(name) {
  const base = stripLoaPrefix(name) || 'LOA';
  const chars = Array.from(`${LOA_PREFIX} ${base}`);
  return chars.slice(0, 32).join('');
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'Unknown';

  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return 'Less than 1 minute';

  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const parts = [];
  if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`);
  if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (minutes) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);

  return parts.join(', ');
}

function parseLoaDate(value, fieldLabel = 'Date') {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return { ok: false, message: `❌ **${fieldLabel}** must be in this format: **YYYY-MM-DD**.` };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return { ok: false, message: `❌ **${fieldLabel}** is not a valid calendar date.` };
  }

  return { ok: true, value: raw, date };
}

function isMonday(date) {
  return date instanceof Date && date.getUTCDay() === 1;
}

function compareDateOnly(a, b) {
  const left = parseLoaDate(a, 'Start Date');
  const right = parseLoaDate(b, 'End Date');
  if (!left.ok || !right.ok) return 0;
  return left.date.getTime() - right.date.getTime();
}

function formatDateOnly(dateString) {
  const parsed = parseLoaDate(dateString, 'Date');
  if (!parsed.ok) return String(dateString || 'Unknown');

  return parsed.date.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: '2-digit',
    year: 'numeric',
  });
}

function validateAddLoaOptions(options = {}) {
  const start = parseLoaDate(options.startDate, 'Start Date');
  if (!start.ok) return start;

  if (!isMonday(start.date)) {
    return { ok: false, message: '❌ **Start Date** must be a **Monday**.' };
  }

  const end = parseLoaDate(options.endDate, 'End Date');
  if (!end.ok) return end;

  if (end.date.getTime() < start.date.getTime()) {
    return { ok: false, message: '❌ **End Date** cannot be before the start date.' };
  }

  const reviewerUsername = String(options.reviewerUsername || '').trim();
  if (!reviewerUsername) {
    return { ok: false, message: '❌ Please include the **Reviewer Username** for this LOA.' };
  }

  return {
    ok: true,
    startDate: start.value,
    endDate: end.value,
    reviewerUsername,
  };
}

function validateRemoveLoaOptions(options = {}, existing = null) {
  const end = parseLoaDate(options.endDate, 'End Date');
  if (!end.ok) return end;

  if (existing?.officialStartDate) {
    const start = parseLoaDate(existing.officialStartDate, 'Start Date');
    if (start.ok && end.date.getTime() < start.date.getTime()) {
      return { ok: false, message: '❌ **End Date** cannot be before the LOA start date.' };
    }
  }

  return { ok: true, endDate: end.value };
}

async function trelloRequest(method, path, params = {}) {
  if (!TRELLO_KEY || !TRELLO_TOKEN) {
    return { ok: false, skipped: true, reason: 'Missing Trello key/token.' };
  }

  try {
    const response = await axios({
      method,
      url: `https://api.trello.com/1${path}`,
      params: {
        key: TRELLO_KEY,
        token: TRELLO_TOKEN,
        ...params,
      },
    });

    return { ok: true, data: response.data };
  } catch (err) {
    console.error('[LOA TRELLO ERROR]', err.response?.data || err.message || err);
    return { ok: false, data: err.response?.data, reason: err.message || 'Trello request failed.' };
  }
}

async function findBestActiveStaffCard(username) {
  if (!STAFF_BOARD_ID) {
    return { ok: false, skipped: true, reason: 'Missing STAFF_JOURNEY_BOARD_ID.' };
  }

  const res = await trelloRequest('GET', `/boards/${STAFF_BOARD_ID}/cards`, {
    fields: 'id,name,closed,idList,pos,idLabels,shortUrl,url',
    limit: 1000,
  });

  if (!res.ok) return res;

  const cleanUsername = normalizeText(stripLoaPrefix(username));
  if (!cleanUsername) return { ok: true, card: null };

  const matches = (Array.isArray(res.data) ? res.data : []).filter((card) => {
    const cardName = String(card.name || '');
    const prefix = cardName.includes(' - ') ? cardName.split(' - ')[0] : cardName;
    const normalizedPrefix = normalizeText(prefix);
    const normalizedCardName = normalizeText(cardName);

    return normalizedPrefix === cleanUsername || normalizedCardName.startsWith(`${cleanUsername} `);
  });

  if (!matches.length) return { ok: true, card: null };

  const activePrimary = matches
    .filter((card) => !card.closed)
    .filter((card) => !PROMOTIONS_LIST_ID || card.idList !== PROMOTIONS_LIST_ID)
    .filter((card) => !RESIGNITIONS_LIST_ID || card.idList !== RESIGNITIONS_LIST_ID)
    .sort((a, b) => (a.pos || 0) - (b.pos || 0));

  if (activePrimary.length) return { ok: true, card: activePrimary[0] };

  const openAny = matches
    .filter((card) => !card.closed)
    .sort((a, b) => (a.pos || 0) - (b.pos || 0));

  return { ok: true, card: openAny[0] || matches[0] || null };
}

async function findOrCreateLoaLabel() {
  if (!STAFF_BOARD_ID) {
    return { ok: false, skipped: true, reason: 'Missing STAFF_JOURNEY_BOARD_ID.' };
  }

  if (CONFIGURED_LOA_LABEL_ID) return { ok: true, labelId: CONFIGURED_LOA_LABEL_ID };

  const listLabels = await trelloRequest('GET', `/boards/${STAFF_BOARD_ID}/labels`, {
    fields: 'id,name,color',
    limit: 1000,
  });

  if (!listLabels.ok) return listLabels;

  const existing = (Array.isArray(listLabels.data) ? listLabels.data : []).find(
    (label) => normalizeText(label.name) === 'loa',
  );

  if (existing?.id) return { ok: true, labelId: existing.id };

  const created = await trelloRequest('POST', '/labels', {
    idBoard: STAFF_BOARD_ID,
    name: 'LOA',
    color: 'black',
  });

  if (!created.ok || !created.data?.id) return created;
  return { ok: true, labelId: created.data.id };
}

async function addLoaLabelToStaffCard(username, commentText) {
  const cardResult = await findBestActiveStaffCard(username);
  if (!cardResult.ok || !cardResult.card) {
    return {
      ok: false,
      card: null,
      warning: cardResult.skipped
        ? `Trello skipped: ${cardResult.reason}`
        : 'No matching Staff Journey card was found.',
    };
  }

  const labelResult = await findOrCreateLoaLabel();
  if (!labelResult.ok || !labelResult.labelId) {
    return { ok: false, card: cardResult.card, warning: labelResult.reason || 'LOA label could not be found or created.' };
  }

  const alreadyHasLabel = Array.isArray(cardResult.card.idLabels)
    && cardResult.card.idLabels.map(String).includes(String(labelResult.labelId));

  if (!alreadyHasLabel) {
    await trelloRequest('POST', `/cards/${cardResult.card.id}/idLabels`, { value: labelResult.labelId });
  }

  if (commentText) {
    await trelloRequest('POST', `/cards/${cardResult.card.id}/actions/comments`, { text: commentText });
  }

  return { ok: true, card: cardResult.card, labelId: labelResult.labelId };
}

async function removeLoaLabelFromStaffCard(username, storedCardId, commentText) {
  let card = null;

  if (storedCardId) {
    const byId = await trelloRequest('GET', `/cards/${storedCardId}`, {
      fields: 'id,name,closed,idList,pos,idLabels,shortUrl,url',
    });
    if (byId.ok && byId.data?.id) card = byId.data;
  }

  if (!card) {
    const found = await findBestActiveStaffCard(username);
    if (!found.ok || !found.card) {
      return {
        ok: false,
        card: null,
        warning: found.skipped ? `Trello skipped: ${found.reason}` : 'No matching Staff Journey card was found.',
      };
    }
    card = found.card;
  }

  const labelResult = await findOrCreateLoaLabel();
  if (!labelResult.ok || !labelResult.labelId) {
    return { ok: false, card, warning: labelResult.reason || 'LOA label could not be found.' };
  }

  await trelloRequest('DELETE', `/cards/${card.id}/idLabels/${labelResult.labelId}`);

  if (commentText) {
    await trelloRequest('POST', `/cards/${card.id}/actions/comments`, { text: commentText });
  }

  return { ok: true, card, labelId: labelResult.labelId };
}

async function ensureBotCanManageRoles(guild) {
  const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { ok: false, message: '❌ I need the **Manage Roles** permission to update LOA roles.' };
  }

  const mrRole = guild.roles.cache.get(MR_LOA_ROLE_ID) || null;
  const hrRole = guild.roles.cache.get(HR_LOA_ROLE_ID) || null;
  const missing = [];
  if (!mrRole) missing.push('MR LOA');
  if (!hrRole) missing.push('HR LOA');

  if (missing.length) {
    return { ok: false, message: `❌ I could not find the ${missing.join(' and ')} role in this server.` };
  }

  const problem = [mrRole, hrRole].find((role) => role.position >= botMember.roles.highest.position);
  if (problem) {
    return { ok: false, message: `❌ I cannot manage **${problem.name}**. Move my bot role above it, then try again.` };
  }

  return { ok: true, botMember, mrRole, hrRole };
}

function buildLoaLogEmbed(details, warnings = []) {
  const completed = details.status === 'Removed';
  const embed = new EmbedBuilder()
    .setColor(completed ? 0x22c55e : 0xf59e0b)
    .setTitle(completed ? '🔕 LOA Log • Removed' : '🔕 LOA Log • Active')
    .setDescription(`${details.target} ${completed ? 'has been removed from LOA.' : 'has been placed on LOA.'}`)
    .addFields(
      { name: 'User', value: `${details.target.user.tag}\n<@${details.target.id}>`, inline: true },
      { name: completed ? 'Removed By' : 'Added By', value: `${details.actionBy.tag}\n<@${details.actionBy.id}>`, inline: true },
      { name: 'Reviewer Username', value: String(details.reviewerUsername || 'Not provided'), inline: true },
      { name: 'LOA Type', value: String(details.loaType || 'Unknown'), inline: true },
      { name: 'Team', value: String(details.staffClassLabel || 'Unknown'), inline: true },
      { name: 'Status', value: completed ? 'Removed' : 'Active', inline: true },
      { name: 'Start Date', value: formatDateOnly(details.officialStartDate), inline: true },
      { name: completed ? 'Final End Date' : 'Planned End Date', value: formatDateOnly(details.officialEndDate), inline: true },
      {
        name: 'Role Duration',
        value: completed ? String(details.duration || 'Unknown') : 'Still on LOA',
        inline: true,
      },
    )
    .setFooter({ text: 'Glace Hotels | LOA System' })
    .setTimestamp(details.timestamp || new Date());

  if (details.startedAt) {
    const startedAtDate = details.startedAt instanceof Date ? details.startedAt : new Date(details.startedAt);
    if (!Number.isNaN(startedAtDate.getTime())) {
      embed.addFields({ name: 'LOA Role Added', value: `<t:${Math.floor(startedAtDate.getTime() / 1000)}:F>`, inline: false });
    }
  }

  if (completed && details.endedAt) {
    const endedAtDate = details.endedAt instanceof Date ? details.endedAt : new Date(details.endedAt);
    if (!Number.isNaN(endedAtDate.getTime())) {
      embed.addFields({ name: 'LOA Role Removed', value: `<t:${Math.floor(endedAtDate.getTime() / 1000)}:F>`, inline: false });
    }
  }

  if (details.trelloCardName) {
    embed.addFields({
      name: 'Trello Card',
      value: details.trelloCardUrl ? `[${details.trelloCardName}](${details.trelloCardUrl})` : details.trelloCardName,
      inline: false,
    });
  }

  if (warnings.length) {
    embed.addFields({ name: 'Warnings', value: warnings.map((w) => `⚠️ ${w}`).join('\n').slice(0, 1024), inline: false });
  }

  return embed;
}

async function sendLoaLog(client, details, warnings = []) {
  try {
    const channel = await client.channels.fetch(LOA_LOG_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased?.()) {
      return { ok: false, warning: 'Could not find the LOA log channel.' };
    }

    const message = await channel.send({ embeds: [buildLoaLogEmbed(details, warnings)] });
    return { ok: true, messageId: message.id, channelId: channel.id };
  } catch (err) {
    console.error('[LOA] Failed to send LOA log:', err);
    return { ok: false, warning: 'Could not send the LOA log message.' };
  }
}

async function editOrSendLoaLog(client, record, details, warnings = []) {
  try {
    const channel = await client.channels.fetch(record?.logChannelId || LOA_LOG_CHANNEL_ID).catch(() => null);
    if (channel?.isTextBased?.() && record?.logMessageId) {
      const message = await channel.messages.fetch(record.logMessageId).catch(() => null);
      if (message) {
        await message.edit({ embeds: [buildLoaLogEmbed(details, warnings)] });
        return { ok: true, edited: true, messageId: message.id, channelId: channel.id };
      }
    }
  } catch (err) {
    console.error('[LOA] Failed to edit existing LOA log:', err);
  }

  const sent = await sendLoaLog(client, details, warnings);
  return { ...sent, edited: false };
}

async function addLoa(interaction, target, options = {}) {
  const warnings = [];
  const validated = validateAddLoaOptions(options);
  if (!validated.ok) return { ok: false, message: validated.message };

  if (!canManageLoa(interaction.member)) {
    return { ok: false, message: '❌ Only Corporate+ can use LOA commands.' };
  }

  const staffClass = classifyStaffMember(target);
  if (!staffClass) {
    return { ok: false, message: '❌ I could not tell what staff team this member is in.' };
  }

  const roleCheck = await ensureBotCanManageRoles(interaction.guild);
  if (!roleCheck.ok) return { ok: false, message: roleCheck.message };

  const loaRole = interaction.guild.roles.cache.get(staffClass.loaRoleId);
  const otherLoaRoleId = staffClass.loaRoleId === MR_LOA_ROLE_ID ? HR_LOA_ROLE_ID : MR_LOA_ROLE_ID;
  const otherLoaRole = interaction.guild.roles.cache.get(otherLoaRoleId);

  const existing = getLoaRecord(interaction.guild.id, target.id);
  const startedAt = existing?.startedAt || new Date().toISOString();
  const cleanDisplayName = stripLoaPrefix(target.displayName);
  const originalNickname = existing
    ? cleanSavedNickname(existing.originalNickname)
    : cleanSavedNickname(target.nickname);
  const originalDisplayName = existing
    ? stripLoaPrefix(existing.originalDisplayName || cleanDisplayName)
    : cleanDisplayName;
  const newNickname = nicknameWithPrefix(cleanDisplayName);

  try {
    if (otherLoaRole && target.roles.cache.has(otherLoaRole.id)) {
      await target.roles.remove(otherLoaRole, `/addloa sync used by ${interaction.user.tag} (${interaction.user.id})`);
    }
    if (!target.roles.cache.has(loaRole.id)) {
      await target.roles.add(loaRole, `/addloa used by ${interaction.user.tag} (${interaction.user.id})`);
    }
  } catch (err) {
    console.error('[LOA] Role update failed:', err);
    return { ok: false, message: '❌ I could not update their LOA role. Check my role position and permissions.' };
  }

  try {
    if (target.manageable && target.displayName !== newNickname) {
      await target.setNickname(newNickname, `/addloa used by ${interaction.user.tag} (${interaction.user.id})`);
    } else if (!target.manageable) {
      warnings.push('I added the LOA role, but I could not change their nickname because their role is too high.');
    }
  } catch (err) {
    console.error('[LOA] Nickname update failed:', err);
    warnings.push('I added the LOA role, but I could not update their nickname.');
  }

  const trello = await addLoaLabelToStaffCard(cleanDisplayName, [
    '**LOA Added**',
    `**User:** ${cleanDisplayName}`,
    `**Discord:** ${target.user.tag} (${target.id})`,
    `**Reviewer Username:** ${validated.reviewerUsername}`,
    `**Start Date:** ${formatDateOnly(validated.startDate)}`,
    `**Planned End Date:** ${formatDateOnly(validated.endDate)}`,
    `**Added By:** ${interaction.user.tag} (${interaction.user.id})`,
    `**Logged At:** ${new Date(startedAt).toLocaleString('en-US', { timeZone: 'America/New_York' })} EST`,
  ].join('\n'));

  if (!trello.ok && trello.warning) warnings.push(trello.warning);

  const record = setLoaRecord(interaction.guild.id, target.id, {
    startedAt,
    officialStartDate: validated.startDate,
    officialEndDate: validated.endDate,
    reviewerUsername: validated.reviewerUsername,
    loaType: staffClass.loaType,
    loaRoleId: staffClass.loaRoleId,
    staffClassKey: staffClass.key,
    staffClassLabel: staffClass.label,
    originalNickname,
    originalDisplayName,
    staffCardId: trello.card?.id || existing?.staffCardId || null,
    staffCardName: trello.card?.name || existing?.staffCardName || null,
    staffCardUrl: trello.card?.shortUrl || trello.card?.url || existing?.staffCardUrl || null,
    addedById: interaction.user.id,
    addedByTag: interaction.user.tag,
  });

  const logResult = await sendLoaLog(interaction.client, {
    target,
    actionBy: interaction.user,
    status: 'Active',
    startedAt,
    timestamp: new Date(),
    officialStartDate: validated.startDate,
    officialEndDate: validated.endDate,
    reviewerUsername: validated.reviewerUsername,
    loaType: staffClass.loaType,
    staffClassLabel: staffClass.label,
    trelloCardName: trello.card?.name || record.staffCardName || null,
    trelloCardUrl: trello.card?.shortUrl || trello.card?.url || record.staffCardUrl || null,
  }, warnings);

  if (logResult.ok) {
    setLoaRecord(interaction.guild.id, target.id, {
      ...record,
      logChannelId: logResult.channelId,
      logMessageId: logResult.messageId,
    });
  } else if (logResult.warning) {
    warnings.push(logResult.warning);
  }

  return {
    ok: true,
    message: [
      `✅ Added LOA for ${target}.`,
      `Start Date: **${formatDateOnly(validated.startDate)}**`,
      `End Date: **${formatDateOnly(validated.endDate)}**`,
      `Reviewer Username: **${validated.reviewerUsername}**`,
      `Role: <@&${staffClass.loaRoleId}>`,
      `Team: **${staffClass.label}**`,
      trello.ok ? `Trello: added **LOA** label to **${trello.card.name}**.` : null,
      logResult.ok ? `Logged in <#${LOA_LOG_CHANNEL_ID}>.` : null,
      warnings.length ? `⚠️ ${warnings.join('\n⚠️ ')}` : null,
    ].filter(Boolean).join('\n'),
  };
}

async function removeLoa(interaction, target, options = {}) {
  const warnings = [];

  if (!canManageLoa(interaction.member)) {
    return { ok: false, message: '❌ Only Corporate+ can use LOA commands.' };
  }

  const existing = getLoaRecord(interaction.guild.id, target.id);
  const validated = validateRemoveLoaOptions(options, existing);
  if (!validated.ok) return { ok: false, message: validated.message };

  const roleCheck = await ensureBotCanManageRoles(interaction.guild);
  if (!roleCheck.ok) return { ok: false, message: roleCheck.message };

  const startedAt = existing?.startedAt ? new Date(existing.startedAt) : null;
  const endedAt = new Date();
  const duration = startedAt ? formatDuration(endedAt.getTime() - startedAt.getTime()) : 'Unknown';

  try {
    const rolesToRemove = [MR_LOA_ROLE_ID, HR_LOA_ROLE_ID]
      .map((id) => interaction.guild.roles.cache.get(id))
      .filter((role) => role && target.roles.cache.has(role.id));

    if (rolesToRemove.length) {
      await target.roles.remove(rolesToRemove, `/removeloa used by ${interaction.user.tag} (${interaction.user.id})`);
    }
  } catch (err) {
    console.error('[LOA] Role removal failed:', err);
    return { ok: false, message: '❌ I could not remove their LOA role. Check my role position and permissions.' };
  }

  const fallbackName = stripLoaPrefix(target.displayName);
  const savedOriginalNickname = existing ? cleanSavedNickname(existing.originalNickname) : undefined;
  const nicknameToRestore = existing
    ? savedOriginalNickname
    : (fallbackName || null);

  try {
    if (target.manageable) {
      const shouldChangeNickname = hasLoaPrefix(target.nickname)
        || hasLoaPrefix(target.displayName)
        || target.nickname !== nicknameToRestore;

      if (shouldChangeNickname) {
        await target.setNickname(nicknameToRestore, `/removeloa used by ${interaction.user.tag} (${interaction.user.id})`);
      }
    } else {
      warnings.push('I removed the LOA role, but I could not change their nickname because their role is too high.');
    }
  } catch (err) {
    console.error('[LOA] Nickname revert failed:', err);
    warnings.push('I removed the LOA role, but I could not revert their nickname.');
  }

  const trelloName = stripLoaPrefix(existing?.originalDisplayName || fallbackName);
  const officialStartDate = existing?.officialStartDate || 'Unknown';
  const oldEndDate = existing?.officialEndDate || null;
  const endDateChanged = oldEndDate && oldEndDate !== validated.endDate;

  const trello = await removeLoaLabelFromStaffCard(trelloName, existing?.staffCardId, [
    '**LOA Removed**',
    `**User:** ${trelloName}`,
    `**Discord:** ${target.user.tag} (${target.id})`,
    existing?.reviewerUsername ? `**Reviewer Username:** ${existing.reviewerUsername}` : null,
    officialStartDate !== 'Unknown' ? `**Start Date:** ${formatDateOnly(officialStartDate)}` : '**Start Date:** Unknown',
    `**Final End Date:** ${formatDateOnly(validated.endDate)}`,
    endDateChanged ? `**Previous End Date:** ${formatDateOnly(oldEndDate)}` : null,
    `**Removed By:** ${interaction.user.tag} (${interaction.user.id})`,
    `**Role Duration:** ${duration}`,
    `**Removed At:** ${endedAt.toLocaleString('en-US', { timeZone: 'America/New_York' })} EST`,
  ].filter(Boolean).join('\n'));

  if (!trello.ok && trello.warning) warnings.push(trello.warning);

  const logResult = await editOrSendLoaLog(interaction.client, existing, {
    target,
    actionBy: interaction.user,
    status: 'Removed',
    startedAt,
    endedAt,
    timestamp: endedAt,
    duration,
    officialStartDate,
    officialEndDate: validated.endDate,
    reviewerUsername: existing?.reviewerUsername || 'Not provided',
    loaType: existing?.loaType || 'Unknown',
    staffClassLabel: existing?.staffClassLabel || classifyStaffMember(target)?.label || 'Unknown',
    trelloCardName: trello.card?.name || existing?.staffCardName || null,
    trelloCardUrl: trello.card?.shortUrl || trello.card?.url || existing?.staffCardUrl || null,
  }, warnings);

  if (!logResult.ok && logResult.warning) warnings.push(logResult.warning);

  clearLoaRecord(interaction.guild.id, target.id);

  return {
    ok: true,
    message: [
      `✅ Removed LOA for ${target}.`,
      `Final End Date: **${formatDateOnly(validated.endDate)}**`,
      endDateChanged ? `Updated the log end date from **${formatDateOnly(oldEndDate)}** to **${formatDateOnly(validated.endDate)}**.` : null,
      `LOA Role Duration: **${duration}**`,
      trello.ok ? `Trello: removed **LOA** label from **${trello.card.name}**.` : null,
      logResult.ok
        ? `${logResult.edited ? 'Updated' : 'Sent'} the LOA log in <#${LOA_LOG_CHANNEL_ID}>.`
        : null,
      warnings.length ? `⚠️ ${warnings.join('\n⚠️ ')}` : null,
    ].filter(Boolean).join('\n'),
  };
}

module.exports = {
  addLoa,
  removeLoa,
  classifyStaffMember,
  canManageLoa,
  stripLoaPrefix,
  MR_LOA_ROLE_ID,
  HR_LOA_ROLE_ID,
  LOA_LOG_CHANNEL_ID,
};
