// src/utils/loaManager.js
// Shared helpers for /addloa and /removeloa.

const axios = require('axios');
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const rolesConfig = require('../config/roles');
const { getLoaRecord, setLoaRecord, clearLoaRecord, listActiveLoas } = require('./loaStore');

const LOA_PREFIX = '\uD83D\uDD15';

const MR_LOA_ROLE_ID = process.env.MR_LOA_ROLE_ID || '1495157788190576741';
const HR_LOA_ROLE_ID = process.env.HR_LOA_ROLE_ID || '1434829767911411874';
const LOA_LOG_CHANNEL_ID = process.env.CURRENT_LOAS_CHANNEL_ID || process.env.LOA_LOG_CHANNEL_ID || '1498580557200621578';
const LOA_PENDING_EMOJI = process.env.LOA_PENDING_EMOJI || '\uD83D\uDFE1';
const LOA_ENDED_EMOJI = process.env.LOA_ENDED_EMOJI || '\uD83D\uDFE2';

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
  corporate_board: { label: 'Corporate Board', level: 7, loaType: 'HR', loaRoleId: HR_LOA_ROLE_ID },
  presidential: { label: 'Presidential', level: 8, loaType: 'HR', loaRoleId: HR_LOA_ROLE_ID },
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


function diffCalendarDays(startDateString, endDateString) {
  const start = parseLoaDate(startDateString, 'Start Date');
  const end = parseLoaDate(endDateString, 'End Date');
  if (!start.ok || !end.ok) return null;

  const msPerDay = 86_400_000;
  const diff = Math.floor((end.date.getTime() - start.date.getTime()) / msPerDay);
  if (!Number.isFinite(diff) || diff < 0) return null;
  return Math.max(1, diff || 1);
}

function formatCalendarDuration(startDateString, endDateString) {
  const days = diffCalendarDays(startDateString, endDateString);
  if (!days) return 'Unknown';

  const weeks = Math.floor(days / 7);
  const remainingDays = days % 7;
  const parts = [];

  if (weeks) parts.push(`${weeks} week${weeks === 1 ? '' : 's'}`);
  if (remainingDays) parts.push(`${remainingDays} day${remainingDays === 1 ? '' : 's'}`);

  if (!parts.length) return `${days} day${days === 1 ? '' : 's'}`;
  return `${parts.join(', ')} (${days} day${days === 1 ? '' : 's'})`;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function normalizeDateValue(month, day, year) {
  return `${pad2(month)}/${pad2(day)}/${year}`;
}

function parseLoaDate(value, fieldLabel = 'Date') {
  const raw = String(value || '').trim();

  // Commands should use MM/DD/YYYY, but this also understands old saved YYYY-MM-DD
  // records so /removeloa can still clean up older LOAs safely.
  let month;
  let day;
  let year;

  const slashMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const legacyDashMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (slashMatch) {
    month = Number(slashMatch[1]);
    day = Number(slashMatch[2]);
    year = Number(slashMatch[3]);
  } else if (legacyDashMatch) {
    year = Number(legacyDashMatch[1]);
    month = Number(legacyDashMatch[2]);
    day = Number(legacyDashMatch[3]);
  } else {
    return { ok: false, message: `\u274C **${fieldLabel}** must be in this format: **MM/DD/YYYY**.` };
  }

  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return { ok: false, message: `\u274C **${fieldLabel}** is not a valid calendar date.` };
  }

  return { ok: true, value: normalizeDateValue(month, day, year), date, raw };
}

function isMonday(date) {
  return date instanceof Date && date.getUTCDay() === 1;
}

function isSunday(date) {
  return date instanceof Date && date.getUTCDay() === 0;
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
  return parsed.value;
}

const LOA_REASONS = new Set([
  'Personal',
  'School/Work',
  'Sick',
  'Mental Health',
  'Vacation',
  'Other',
]);

function formatLoaReason(reason, otherReason = '') {
  const selected = String(reason || '').trim();
  const other = String(otherReason || '').trim();

  if (!LOA_REASONS.has(selected)) {
    return { ok: false, message: '\u274C Please choose a valid **Reason** option.' };
  }

  if (selected === 'Other') {
    if (!other) {
      return { ok: false, message: '\u274C Since you chose **Other**, please fill in **other_reason**.' };
    }
    return { ok: true, value: `Other: ${other}` };
  }

  return { ok: true, value: selected };
}

function parseStaffJourneyCardName(cardName) {
  const raw = String(cardName || '').trim();
  const match = raw.match(/^(.+?)\s+-\s+(.+)$/);
  if (!match) return null;

  const usernamePart = stripLoaPrefix(match[1]).trim();
  const datePart = String(match[2] || '').trim();

  // Staff Journey cards must look like: USERNAME - MM/DD/YYYY.
  // This blocks milestone cards like "USERNAME - Milestone 1" from being selected.
  const dateLike = /^\d{2}\/\d{2}\/\d{4}$/.test(datePart);
  if (!usernamePart || !dateLike) return null;

  return { usernamePart, datePart };
}

function validateAddLoaOptions(options = {}) {
  const start = parseLoaDate(options.startDate, 'Start Date');
  if (!start.ok) return start;
  if (String(options.startDate || '').trim() !== start.value) {
    return { ok: false, message: '\u274C **Start Date** must be in this exact format: **MM/DD/YYYY**.' };
  }

  if (!isMonday(start.date)) {
    return { ok: false, message: '\u274C **Start Date** must be a **Monday**.' };
  }

  const end = parseLoaDate(options.endDate, 'End Date');
  if (!end.ok) return end;
  if (String(options.endDate || '').trim() !== end.value) {
    return { ok: false, message: '\u274C **End Date** must be in this exact format: **MM/DD/YYYY**.' };
  }

  if (end.date.getTime() < start.date.getTime()) {
    return { ok: false, message: '\u274C **End Date** cannot be before the start date.' };
  }
  if (!isSunday(end.date)) {
    return { ok: false, message: '\u274C **End Date** must be a **Sunday**.' };
  }

  const reviewerUsername = String(options.reviewerUsername || '').trim();
  if (!reviewerUsername) {
    return { ok: false, message: '\u274C Please include the **Reviewer Username** for this LOA.' };
  }

  const reason = formatLoaReason(options.reason, options.otherReason);
  if (!reason.ok) return reason;

  return {
    ok: true,
    startDate: start.value,
    endDate: end.value,
    reviewerUsername,
    reason: reason.value,
  };
}

function validateRemoveLoaOptions(options = {}, existing = null) {
  const end = parseLoaDate(options.endDate, 'End Date');
  if (!end.ok) return end;
  if (String(options.endDate || '').trim() !== end.value) {
    return { ok: false, message: '\u274C **End Date** must be in this exact format: **MM/DD/YYYY**.' };
  }

  if (existing?.officialStartDate) {
    const start = parseLoaDate(existing.officialStartDate, 'Start Date');
    if (start.ok && end.date.getTime() < start.date.getTime()) {
      return { ok: false, message: '\u274C **End Date** cannot be before the LOA start date.' };
    }
  }

  return { ok: true, endDate: end.value };
}

function validateExtendLoaOptions(options = {}, existing = null) {
  const end = parseLoaDate(options.newEndDate, 'New Planned End Date');
  if (!end.ok) return end;
  if (String(options.newEndDate || '').trim() !== end.value) {
    return { ok: false, message: '\u274C **New Planned End Date** must be in this exact format: **MM/DD/YYYY**.' };
  }
  if (!isSunday(end.date)) {
    return { ok: false, message: '\u274C **New Planned End Date** must be a **Sunday**.' };
  }

  if (existing?.officialStartDate) {
    const start = parseLoaDate(existing.officialStartDate, 'Start Date');
    if (start.ok && end.date.getTime() < start.date.getTime()) {
      return { ok: false, message: '\u274C **New Planned End Date** cannot be before the LOA start date.' };
    }
  }

  const reason = String(options.reason || '').trim();
  if (!reason) {
    return { ok: false, message: '\u274C Please include an extension reason.' };
  }

  return { ok: true, newEndDate: end.value, reason };
}

async function trelloRequest(method, path, params = {}) {
  if (!TRELLO_KEY || !TRELLO_TOKEN) {
    return { ok: false, skipped: true, reason: 'Missing Trello key/token.' };
  }

  try {
    const response = await axios({
      method,
      url: `https://api.trello.com/1${path}`,
      timeout: 10000,
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
    const parsed = parseStaffJourneyCardName(card.name);
    if (!parsed) return false;

    return normalizeText(parsed.usernamePart) === cleanUsername;
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

async function addLoaLabelToStaffCard(username, _commentText) {
  const cardResult = await findBestActiveStaffCard(username);
  if (!cardResult.ok || !cardResult.card) {
    return {
      ok: false,
      card: null,
      warning: cardResult.skipped
        ? `Trello skipped: ${cardResult.reason}`
        : 'No matching Staff Journey card with the format **USERNAME - DATE** was found.',
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

  return { ok: true, card: cardResult.card, labelId: labelResult.labelId };
}

async function removeLoaLabelFromStaffCard(username, storedCardId, _commentText) {
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
        warning: found.skipped ? `Trello skipped: ${found.reason}` : 'No matching Staff Journey card with the format **USERNAME - DATE** was found.',
      };
    }
    card = found.card;
  }

  const labelResult = await findOrCreateLoaLabel();
  if (!labelResult.ok || !labelResult.labelId) {
    return { ok: false, card, warning: labelResult.reason || 'LOA label could not be found.' };
  }

  await trelloRequest('DELETE', `/cards/${card.id}/idLabels/${labelResult.labelId}`);

  return { ok: true, card, labelId: labelResult.labelId };
}

async function ensureBotCanManageRoles(guild) {
  const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { ok: false, message: '\u274C I need the **Manage Roles** permission to update LOA roles.' };
  }

  const mrRole = guild.roles.cache.get(MR_LOA_ROLE_ID) || null;
  const hrRole = guild.roles.cache.get(HR_LOA_ROLE_ID) || null;
  const missing = [];
  if (!mrRole) missing.push('MR LOA');
  if (!hrRole) missing.push('HR LOA');

  if (missing.length) {
    return { ok: false, message: `\u274C I could not find the ${missing.join(' and ')} role in this server.` };
  }

  const problem = [mrRole, hrRole].find((role) => role.position >= botMember.roles.highest.position);
  if (problem) {
    return { ok: false, message: `\u274C I cannot manage **${problem.name}**. Move my bot role above it, then try again.` };
  }

  return { ok: true, botMember, mrRole, hrRole };
}

function safeFieldValue(value, fallback = 'Not provided') {
  const text = String(value || '').trim();
  return text ? text.slice(0, 1024) : fallback;
}

function getEmbedField(embed, nameOptions = []) {
  const wanted = new Set(nameOptions.map((name) => normalizeText(name)));
  const field = (embed?.fields || []).find((f) => wanted.has(normalizeText(f.name)));
  return field ? String(field.value || '').trim() : null;
}

function parseLoaLogMessage(message) {
  const embed = message?.embeds?.[0];
  if (!embed) return null;

  const title = String(embed.title || '');
  const footer = String(embed.footer?.text || '');
  const looksLikeLoa = normalizeText(title).includes('loa log') || normalizeText(footer).includes('loa system');
  if (!looksLikeLoa) return null;

  const userValue = getEmbedField(embed, ['User']) || '';
  const mentionMatch = userValue.match(/<@!?(\d+)>/);
  const idMatch = userValue.match(/\b\d{15,25}\b/);
  const userId = mentionMatch?.[1] || idMatch?.[0] || null;

  const statusValue = getEmbedField(embed, ['Status']) || '';
  const normalizedStatus = normalizeText(`${title} ${statusValue}`);
  const isEnded = normalizedStatus.includes('removed')
    || normalizedStatus.includes('ended')
    || normalizedStatus.includes('completed')
    || normalizedStatus.includes('complete');

  return {
    userId,
    isEnded,
    status: isEnded ? 'Removed' : 'Pending',
    officialStartDate: getEmbedField(embed, ['Start Date']) || null,
    officialEndDate: getEmbedField(embed, ['Planned End Date', 'Final End Date', 'End Date']) || null,
    reviewerUsername: getEmbedField(embed, ['Reviewer Username']) || null,
    reason: getEmbedField(embed, ['Reason']) || null,
    loaType: getEmbedField(embed, ['LOA Type']) || null,
    staffClassLabel: getEmbedField(embed, ['Team']) || null,
    extensionsText: getEmbedField(embed, ['Extension History', 'Extensions']) || null,
  };
}

async function findActiveLoaLogMessage(client, userId) {
  try {
    const channel = await client.channels.fetch(LOA_LOG_CHANNEL_ID).catch(() => null);
    if (!channel?.isTextBased?.()) return null;

    let before;
    for (let page = 0; page < 5; page += 1) {
      const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
      if (!messages?.size) break;

      const sorted = [...messages.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
      const found = sorted.find((message) => {
        const parsed = parseLoaLogMessage(message);
        return parsed?.userId === String(userId) && !parsed.isEnded;
      });

      if (found) return { message: found, channel, parsed: parseLoaLogMessage(found) };
      before = sorted[sorted.length - 1]?.id;
      if (!before || messages.size < 100) break;
    }
  } catch (err) {
    console.error('[LOA] Failed to find active LOA log message:', err);
  }

  return null;
}

async function buildRecordFromActiveLog(client, guildId, target) {
  const activeLog = await findActiveLoaLogMessage(client, target.id);
  if (!activeLog) return null;

  return {
    guildId: String(guildId),
    userId: String(target.id),
    logChannelId: activeLog.channel.id,
    logMessageId: activeLog.message.id,
    officialStartDate: activeLog.parsed.officialStartDate,
    officialEndDate: activeLog.parsed.officialEndDate,
    reviewerUsername: activeLog.parsed.reviewerUsername,
    reason: activeLog.parsed.reason,
    loaType: activeLog.parsed.loaType,
    staffClassLabel: activeLog.parsed.staffClassLabel,
    extensionsText: activeLog.parsed.extensionsText,
    originalDisplayName: stripLoaPrefix(target.displayName),
    originalNickname: cleanSavedNickname(target.nickname),
    recoveredFromLog: true,
  };
}

function normalizeExtensions(extensions) {
  if (!extensions) return [];
  if (Array.isArray(extensions)) {
    return extensions
      .map((entry) => ({
        oldEndDate: entry.oldEndDate || null,
        newEndDate: entry.newEndDate || null,
        reason: String(entry.reason || '').trim(),
        extendedByTag: entry.extendedByTag || null,
        extendedAt: entry.extendedAt || null,
      }))
      .filter((entry) => entry.newEndDate || entry.reason);
  }

  return String(extensions)
    .split('\n')
    .map((line) => line.replace(/^[-\u2022]\s*/, '').trim())
    .filter(Boolean)
    .map((line) => ({ reason: line }));
}

function formatExtensionHistory(extensions = []) {
  const entries = normalizeExtensions(extensions);
  if (!entries.length) return null;

  return entries
    .slice(-5)
    .map((entry, index) => {
      const oldPart = entry.oldEndDate ? `${formatDateOnly(entry.oldEndDate)} \u2192 ` : '';
      const newPart = entry.newEndDate ? formatDateOnly(entry.newEndDate) : 'Updated';
      const reasonPart = entry.reason ? ` \u2014 ${entry.reason}` : '';
      return `${index + 1}. ${oldPart}${newPart}${reasonPart}`;
    })
    .join('\n')
    .slice(0, 1024);
}

async function applyLoaReaction(message, status) {
  if (!message?.react) return;

  const completed = status === 'Removed';
  const addEmoji = completed ? LOA_ENDED_EMOJI : LOA_PENDING_EMOJI;
  const removeEmoji = completed ? LOA_PENDING_EMOJI : LOA_ENDED_EMOJI;

  try {
    const existingRemove = message.reactions.cache.find((reaction) => reaction.emoji.name === removeEmoji);
    if (existingRemove) {
      await existingRemove.users.remove(message.client.user.id).catch(() => null);
    }
  } catch (err) {
    console.error('[LOA] Failed to remove old LOA reaction:', err);
  }

  try {
    const alreadyReacted = message.reactions.cache.find((reaction) => reaction.emoji.name === addEmoji);
    if (!alreadyReacted) {
      await message.react(addEmoji);
    }
  } catch (err) {
    console.error('[LOA] Failed to add LOA reaction:', err);
  }
}

function buildLoaLogEmbed(details, warnings = []) {
  const completed = details.status === 'Removed';
  const statusEmoji = completed ? LOA_ENDED_EMOJI : LOA_PENDING_EMOJI;
  const statusText = completed ? 'Ended' : 'Pending';
  const duration = formatCalendarDuration(details.officialStartDate, details.officialEndDate);

  const embed = new EmbedBuilder()
    .setColor(completed ? 0x22c55e : 0xf59e0b)
    .setTitle(completed ? `${LOA_ENDED_EMOJI} LOA Log \u2022 Ended` : `${LOA_PENDING_EMOJI} LOA Log \u2022 Pending`)
    .setDescription(`${details.target} ${completed ? 'has ended their LOA.' : 'has an active LOA request.'}`)
    .addFields(
      { name: 'User', value: `${details.target.user.tag}\n<@${details.target.id}>`, inline: true },
      { name: completed ? 'Removed By' : 'Added By', value: `${details.actionBy.tag}\n<@${details.actionBy.id}>`, inline: true },
      { name: 'Reviewer Username', value: safeFieldValue(details.reviewerUsername), inline: true },
      { name: 'Reason', value: safeFieldValue(details.reason), inline: true },
      { name: 'LOA Type', value: safeFieldValue(details.loaType, 'Unknown'), inline: true },
      { name: 'Team', value: safeFieldValue(details.staffClassLabel, 'Unknown'), inline: true },
      { name: 'Status', value: `${statusEmoji} ${statusText}`, inline: true },
      { name: 'Start Date', value: formatDateOnly(details.officialStartDate), inline: true },
      { name: completed ? 'Final End Date' : 'Planned End Date', value: formatDateOnly(details.officialEndDate), inline: true },
      { name: 'LOA Duration', value: duration, inline: true },
    )
    .setFooter({ text: 'Glace Hotels | LOA System' })
    .setTimestamp(details.timestamp || new Date());

  const extensionsText = formatExtensionHistory(details.extensions || details.extensionsText);
  if (extensionsText) {
    embed.addFields({ name: 'Extension History', value: extensionsText, inline: false });
  }

  if (details.trelloCardName) {
    embed.addFields({
      name: 'Trello Card',
      value: details.trelloCardUrl ? `[${details.trelloCardName}](${details.trelloCardUrl})` : details.trelloCardName,
      inline: false,
    });
  }

  if (warnings.length) {
    embed.addFields({ name: 'Warnings', value: warnings.map((w) => `\u26A0\uFE0F ${w}`).join('\n').slice(0, 1024), inline: false });
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
    await applyLoaReaction(message, details.status);
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
        await applyLoaReaction(message, details.status);
        return { ok: true, edited: true, messageId: message.id, channelId: channel.id };
      }
    }
  } catch (err) {
    console.error('[LOA] Failed to edit existing LOA log:', err);
  }

  const activeLog = await findActiveLoaLogMessage(client, details.target.id);
  if (activeLog?.message) {
    await activeLog.message.edit({ embeds: [buildLoaLogEmbed(details, warnings)] });
    await applyLoaReaction(activeLog.message, details.status);
    return { ok: true, edited: true, messageId: activeLog.message.id, channelId: activeLog.channel.id };
  }

  const sent = await sendLoaLog(client, details, warnings);
  return { ...sent, edited: false };
}

async function addLoa(interaction, target, options = {}) {
  const warnings = [];
  const validated = validateAddLoaOptions(options);
  if (!validated.ok) return { ok: false, message: validated.message };

  if (!canManageLoa(interaction.member)) {
    return { ok: false, message: '\u274C Only Corporate+ can use LOA commands.' };
  }

  const staffClass = classifyStaffMember(target);
  if (!staffClass) {
    return { ok: false, message: '\u274C I could not tell what staff team this member is in.' };
  }

  const roleCheck = await ensureBotCanManageRoles(interaction.guild);
  if (!roleCheck.ok) return { ok: false, message: roleCheck.message };

  const loaRole = interaction.guild.roles.cache.get(staffClass.loaRoleId);
  const otherLoaRoleId = staffClass.loaRoleId === MR_LOA_ROLE_ID ? HR_LOA_ROLE_ID : MR_LOA_ROLE_ID;
  const otherLoaRole = interaction.guild.roles.cache.get(otherLoaRoleId);

  const stored = getLoaRecord(interaction.guild.id, target.id);
  const recovered = stored ? null : await buildRecordFromActiveLog(interaction.client, interaction.guild.id, target);
  const existing = stored || recovered;
  const isUpdatingExistingLoa = Boolean(existing?.logMessageId);

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
    return { ok: false, message: '\u274C I could not update their LOA role. Check my role position and permissions.' };
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

  const trello = await addLoaLabelToStaffCard(
    cleanDisplayName,
    `LOA - ${formatDateOnly(validated.startDate)} - ${formatDateOnly(validated.endDate)} - Pending`,
  );

  if (!trello.ok && trello.warning) warnings.push(trello.warning);

  const baseRecord = {
    ...(existing || {}),
    officialStartDate: validated.startDate,
    officialEndDate: validated.endDate,
    reviewerUsername: validated.reviewerUsername,
    reason: validated.reason,
    loaType: staffClass.loaType,
    loaRoleId: staffClass.loaRoleId,
    staffClassKey: staffClass.key,
    staffClassLabel: staffClass.label,
    originalNickname,
    originalDisplayName,
    staffCardId: trello.card?.id || existing?.staffCardId || null,
    staffCardName: trello.card?.name || existing?.staffCardName || null,
    staffCardUrl: trello.card?.shortUrl || trello.card?.url || existing?.staffCardUrl || null,
    addedById: existing?.addedById || interaction.user.id,
    addedByTag: existing?.addedByTag || interaction.user.tag,
  };

  const record = setLoaRecord(interaction.guild.id, target.id, baseRecord);

  const logResult = await editOrSendLoaLog(interaction.client, record, {
    target,
    actionBy: interaction.user,
    status: 'Pending',
    timestamp: new Date(),
    officialStartDate: validated.startDate,
    officialEndDate: validated.endDate,
    reviewerUsername: validated.reviewerUsername,
    reason: validated.reason,
    loaType: staffClass.loaType,
    staffClassLabel: staffClass.label,
    extensions: record.extensions || [],
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
      `${isUpdatingExistingLoa ? '\u2705 Updated the active LOA for' : '\u2705 Added LOA for'} ${target}.`,
      `Start Date: **${formatDateOnly(validated.startDate)}**`,
      `Planned End Date: **${formatDateOnly(validated.endDate)}**`,
      `Duration: **${formatCalendarDuration(validated.startDate, validated.endDate)}**`,
      `Reviewer Username: **${validated.reviewerUsername}**`,
      `Reason: **${validated.reason}**`,
      `Role: <@&${staffClass.loaRoleId}>`,
      `Team: **${staffClass.label}**`,
      trello.ok ? `Trello: added **LOA** label to **${trello.card.name}**.` : null,
      logResult.ok ? `${logResult.edited ? 'Updated' : 'Sent'} the LOA log in <#${LOA_LOG_CHANNEL_ID}>.` : null,
      warnings.length ? `\u26A0\uFE0F ${warnings.join('\n\u26A0\uFE0F ')}` : null,
    ].filter(Boolean).join('\n'),
  };
}

async function removeLoa(interaction, target, options = {}) {
  const warnings = [];

  if (!canManageLoa(interaction.member)) {
    return { ok: false, message: '\u274C Only Corporate+ can use LOA commands.' };
  }

  const stored = getLoaRecord(interaction.guild.id, target.id);
  const recovered = stored ? null : await buildRecordFromActiveLog(interaction.client, interaction.guild.id, target);
  const existing = stored || recovered;

  if (!existing?.logMessageId) {
    return { ok: false, message: '\u274C I could not find an active LOA log for this member. Please check if they currently have an active LOA post.' };
  }

  const validated = validateRemoveLoaOptions(options, existing);
  if (!validated.ok) return { ok: false, message: validated.message };

  const roleCheck = await ensureBotCanManageRoles(interaction.guild);
  if (!roleCheck.ok) return { ok: false, message: roleCheck.message };

  try {
    const rolesToRemove = [MR_LOA_ROLE_ID, HR_LOA_ROLE_ID]
      .map((id) => interaction.guild.roles.cache.get(id))
      .filter((role) => role && target.roles.cache.has(role.id));

    if (rolesToRemove.length) {
      await target.roles.remove(rolesToRemove, `/removeloa used by ${interaction.user.tag} (${interaction.user.id})`);
    }
  } catch (err) {
    console.error('[LOA] Role removal failed:', err);
    return { ok: false, message: '\u274C I could not remove their LOA role. Check my role position and permissions.' };
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
  const duration = formatCalendarDuration(officialStartDate, validated.endDate);

  const trello = await removeLoaLabelFromStaffCard(
    trelloName,
    existing?.staffCardId,
    `LOA - ${formatDateOnly(officialStartDate)} - ${formatDateOnly(validated.endDate)} - Ended`,
  );

  if (!trello.ok && trello.warning) warnings.push(trello.warning);

  const logResult = await editOrSendLoaLog(interaction.client, existing, {
    target,
    actionBy: interaction.user,
    status: 'Removed',
    timestamp: new Date(),
    duration,
    officialStartDate,
    officialEndDate: validated.endDate,
    reviewerUsername: existing?.reviewerUsername || 'Not provided',
    reason: existing?.reason || 'Not provided',
    loaType: existing?.loaType || 'Unknown',
    staffClassLabel: existing?.staffClassLabel || classifyStaffMember(target)?.label || 'Unknown',
    extensions: existing?.extensions || existing?.extensionsText || [],
    trelloCardName: trello.card?.name || existing?.staffCardName || null,
    trelloCardUrl: trello.card?.shortUrl || trello.card?.url || existing?.staffCardUrl || null,
  }, warnings);

  if (!logResult.ok && logResult.warning) warnings.push(logResult.warning);

  clearLoaRecord(interaction.guild.id, target.id, {
    officialEndDate: validated.endDate,
    endedById: interaction.user.id,
    endedByTag: interaction.user.tag,
    endedAt: new Date().toISOString(),
  });

  return {
    ok: true,
    message: [
      `\u2705 Removed LOA for ${target}.`,
      `Start Date: **${formatDateOnly(officialStartDate)}**`,
      `Final End Date: **${formatDateOnly(validated.endDate)}**`,
      endDateChanged ? `Updated the log end date from **${formatDateOnly(oldEndDate)}** to **${formatDateOnly(validated.endDate)}**.` : null,
      `LOA Duration: **${duration}**`,
      trello.ok ? `Trello: removed **LOA** label from **${trello.card.name}**.` : null,
      logResult.ok
        ? `${logResult.edited ? 'Updated' : 'Sent'} the LOA log in <#${LOA_LOG_CHANNEL_ID}>.`
        : null,
      warnings.length ? `\u26A0\uFE0F ${warnings.join('\n\u26A0\uFE0F ')}` : null,
    ].filter(Boolean).join('\n'),
  };
}

async function extendLoa(interaction, target, options = {}) {
  const warnings = [];

  if (!canManageLoa(interaction.member)) {
    return { ok: false, message: '\u274C Only Corporate+ can use LOA commands.' };
  }

  const stored = getLoaRecord(interaction.guild.id, target.id);
  const recovered = stored ? null : await buildRecordFromActiveLog(interaction.client, interaction.guild.id, target);
  const existing = stored || recovered;

  if (!existing?.logMessageId) {
    return { ok: false, message: '\u274C I could not find an active LOA log for this member. Please check if they currently have an active LOA post.' };
  }

  const validated = validateExtendLoaOptions(options, existing);
  if (!validated.ok) return { ok: false, message: validated.message };

  const oldEndDate = existing.officialEndDate || null;
  const extensions = normalizeExtensions(existing.extensions || existing.extensionsText);
  extensions.push({
    oldEndDate,
    newEndDate: validated.newEndDate,
    reason: validated.reason,
    extendedById: interaction.user.id,
    extendedByTag: interaction.user.tag,
    extendedAt: new Date().toISOString(),
  });

  const staffClass = classifyStaffMember(target);
  const updatedRecord = setLoaRecord(interaction.guild.id, target.id, {
    ...existing,
    officialEndDate: validated.newEndDate,
    extensions,
    lastExtendedById: interaction.user.id,
    lastExtendedByTag: interaction.user.tag,
  });

  const trelloName = stripLoaPrefix(existing?.originalDisplayName || target.displayName);
  const trello = await addLoaLabelToStaffCard(
    trelloName,
    `LOA Extended - ${formatDateOnly(oldEndDate || 'Unknown')} \u2192 ${formatDateOnly(validated.newEndDate)} - ${validated.reason}`,
  );

  if (!trello.ok && trello.warning) warnings.push(trello.warning);

  const logResult = await editOrSendLoaLog(interaction.client, updatedRecord, {
    target,
    actionBy: interaction.user,
    status: 'Pending',
    timestamp: new Date(),
    officialStartDate: updatedRecord.officialStartDate,
    officialEndDate: validated.newEndDate,
    reviewerUsername: updatedRecord.reviewerUsername || 'Not provided',
    reason: updatedRecord.reason || 'Not provided',
    loaType: updatedRecord.loaType || staffClass?.loaType || 'Unknown',
    staffClassLabel: updatedRecord.staffClassLabel || staffClass?.label || 'Unknown',
    extensions,
    trelloCardName: trello.card?.name || updatedRecord.staffCardName || null,
    trelloCardUrl: trello.card?.shortUrl || trello.card?.url || updatedRecord.staffCardUrl || null,
  }, warnings);

  if (logResult.ok) {
    setLoaRecord(interaction.guild.id, target.id, {
      ...updatedRecord,
      logChannelId: logResult.channelId,
      logMessageId: logResult.messageId,
    });
  } else if (logResult.warning) {
    warnings.push(logResult.warning);
  }

  return {
    ok: true,
    message: [
      `\u2705 Extended LOA for ${target}.`,
      oldEndDate ? `Old Planned End Date: **${formatDateOnly(oldEndDate)}**` : null,
      `New Planned End Date: **${formatDateOnly(validated.newEndDate)}**`,
      `Updated Duration: **${formatCalendarDuration(updatedRecord.officialStartDate, validated.newEndDate)}**`,
      `Reason: **${validated.reason}**`,
      logResult.ok ? `Updated the LOA log in <#${LOA_LOG_CHANNEL_ID}>.` : null,
      warnings.length ? `\u26A0\uFE0F ${warnings.join('\n\u26A0\uFE0F ')}` : null,
    ].filter(Boolean).join('\n'),
  };
}

const portalLoaCache = new Map();

async function listCurrentLoasForPortal(client, guildId, { force = false } = {}) {
  const key = String(guildId || '');
  const cached = portalLoaCache.get(key);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.records;

  const stored = listActiveLoas(guildId);
  const channel = await client.channels.fetch(LOA_LOG_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased?.()) {
    portalLoaCache.set(key, { expiresAt: Date.now() + 30_000, records: stored });
    return stored;
  }

  const latestByUser = new Map();
  let before;
  for (let page = 0; page < 5; page += 1) {
    const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!messages?.size) break;
    const sorted = [...messages.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    for (const message of sorted) {
      const parsed = parseLoaLogMessage(message);
      if (!parsed?.userId || latestByUser.has(parsed.userId)) continue;
      latestByUser.set(parsed.userId, { parsed, message });
    }
    before = sorted[sorted.length - 1]?.id;
    if (!before || messages.size < 100) break;
  }

  const guild = client.guilds.cache.get(String(guildId)) || null;
  const records = [];
  for (const [userId, item] of latestByUser) {
    if (item.parsed.isEnded) continue;
    const member = guild?.members?.cache?.get(userId) || null;
    records.push({
      guildId: String(guildId),
      userId,
      originalDisplayName: member ? stripLoaPrefix(member.displayName) : `Discord User ${userId}`,
      officialStartDate: item.parsed.officialStartDate,
      officialEndDate: item.parsed.officialEndDate,
      reviewerUsername: item.parsed.reviewerUsername,
      reason: item.parsed.reason,
      loaType: item.parsed.loaType,
      staffClassLabel: item.parsed.staffClassLabel,
      extensionsText: item.parsed.extensionsText,
      logChannelId: channel.id,
      logMessageId: item.message.id,
      createdAt: item.message.createdAt?.toISOString?.() || new Date(item.message.createdTimestamp).toISOString(),
      updatedAt: item.message.editedAt?.toISOString?.() || item.message.createdAt?.toISOString?.() || new Date().toISOString(),
      source: 'discord_current_loa_log',
    });
  }

  const seen = new Set(latestByUser.keys());
  for (const record of stored) {
    if (!seen.has(String(record.userId))) records.push(record);
  }

  records.sort((a, b) => String(a.officialEndDate || '').localeCompare(String(b.officialEndDate || '')));
  portalLoaCache.set(key, { expiresAt: Date.now() + 60_000, records });
  return records;
}

module.exports = {
  addLoa,
  removeLoa,
  extendLoa,
  classifyStaffMember,
  canManageLoa,
  stripLoaPrefix,
  MR_LOA_ROLE_ID,
  HR_LOA_ROLE_ID,
  LOA_LOG_CHANNEL_ID,
  LOA_PENDING_EMOJI,
  LOA_ENDED_EMOJI,
  listCurrentLoasForPortal,
};
