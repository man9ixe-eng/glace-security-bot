const fs = require('node:fs');
const path = require('node:path');
const rolesConfig = require('../config/roles');

let quotaSettings;
try {
  quotaSettings = require('./quotaSettings');
} catch {
  quotaSettings = null;
}

const DATA_PATH = path.join(__dirname, '..', 'data', 'activityLogs.json');
const TIME_ZONE = 'America/New_York';
const SESSION_LOG_CHANNEL_ID =
  process.env.SESSION_LOG_CHANNEL_ID || '1452217561935777884';

function ensureStore() {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(
      DATA_PATH,
      JSON.stringify(
        {
          hostedSessions: [],
          supportSessions: [],
          meta: {
            currentWeekKey: getWeekKeyForDate(new Date()),
            previousWeekKey: null,
            lastMaintenanceAt: Date.now(),
            lastBackfillAt: 0,
          },
        },
        null,
        2,
      ),
    );
  }
}

function normalizeStoreShape(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return {
      hostedSessions: [],
      supportSessions: [],
      meta: {
        currentWeekKey: getWeekKeyForDate(new Date()),
        previousWeekKey: null,
        lastMaintenanceAt: Date.now(),
        lastBackfillAt: 0,
      },
    };
  }

  if (!Array.isArray(parsed.hostedSessions)) parsed.hostedSessions = [];
  if (!Array.isArray(parsed.supportSessions)) parsed.supportSessions = [];

  if (Array.isArray(parsed.sessions) && parsed.hostedSessions.length === 0) {
    parsed.hostedSessions = parsed.sessions.map((entry) => ({
      userId: entry.userId,
      shortId: entry.shortId,
      sessionType: entry.sessionType,
      guildId: entry.guildId || null,
      timestamp: entry.timestamp || Date.now(),
      cancelled: Boolean(entry.cancelled),
    }));
  }

  if (!parsed.meta || typeof parsed.meta !== 'object') {
    parsed.meta = {};
  }

  if (!parsed.meta.currentWeekKey) {
    parsed.meta.currentWeekKey = getWeekKeyForDate(new Date());
  }

  if (!Object.prototype.hasOwnProperty.call(parsed.meta, 'previousWeekKey')) {
    parsed.meta.previousWeekKey = null;
  }

  if (!parsed.meta.lastMaintenanceAt) {
    parsed.meta.lastMaintenanceAt = Date.now();
  }

  if (!parsed.meta.lastBackfillAt) {
    parsed.meta.lastBackfillAt = 0;
  }

  return parsed;
}

function readStore() {
  ensureStore();
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    return normalizeStoreShape(JSON.parse(raw));
  } catch {
    return normalizeStoreShape({});
  }
}

function writeStore(data) {
  ensureStore();
  fs.writeFileSync(DATA_PATH, JSON.stringify(normalizeStoreShape(data), null, 2));
}

function getRoleIds(key) {
  const value = rolesConfig[key];
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function hasAnyRoleId(member, ids) {
  return ids.some((id) => member.roles.cache.has(id));
}

function normalizeRoleName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/<a?:\w+:\d+>/g, ' ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function roleNameIsActiveTeamName(name) {
  if (name.includes('former')) return false;
  if (name.includes('retired')) return false;
  if (name.includes('alumni')) return false;
  return true;
}

function hasRoleNameKeywords(member, requiredKeywords, { requireTeam = false } = {}) {
  if (!member?.roles?.cache) return false;

  const keywords = requiredKeywords.map((keyword) => normalizeRoleName(keyword));

  return member.roles.cache.some((role) => {
    const name = normalizeRoleName(role.name);
    if (!roleNameIsActiveTeamName(name)) return false;
    if (requireTeam && !name.includes('team')) return false;
    return keywords.every((keyword) => name.includes(keyword));
  });
}

function hasTeamRoleName(member, requiredKeywords) {
  return hasRoleNameKeywords(member, requiredKeywords, { requireTeam: true });
}

function hasCorporateBoardRoleName(member) {
  if (!member?.roles?.cache) return false;

  return member.roles.cache.some((role) => {
    const name = normalizeRoleName(role.name);
    if (!roleNameIsActiveTeamName(name)) return false;

    const compact = name.replace(/\s+/g, '');

    return (
      compact.includes('bod') ||
      name.includes('corporate board') ||
      name.includes('board of director') ||
      name.includes('board of directors') ||
      (name.includes('board') && name.includes('director')) ||
      (name.includes('board') && name.includes('directors'))
    );
  });
}

function getQuotaConfig() {
  const fallback = {
    intern: {
      label: 'Intern',
      mode: 'regular',
      total: 2,
      minInterview: 1,
      minTraining: 1,
      hostedTotal: 0,
      cohostTotal: 0,
      minOverseer: 0,
      shiftMinutes: 0,
    },
    management: {
      label: 'Management',
      mode: 'regular',
      total: 3,
      minInterview: 1,
      minTraining: 1,
      hostedTotal: 0,
      cohostTotal: 0,
      minOverseer: 0,
      shiftMinutes: 0,
    },
    senior_management: {
      label: 'Senior Management',
      mode: 'regular',
      total: 4,
      minInterview: 2,
      minTraining: 2,
      hostedTotal: 0,
      cohostTotal: 0,
      minOverseer: 0,
      shiftMinutes: 0,
    },
    corporate_intern: {
      label: 'Corporate Intern',
      mode: 'regular_and_cohost',
      // 2 non-cohost/support sessions (1 interview + 1 training) + 2 co-hosted sessions.
      total: 2,
      minInterview: 1,
      minTraining: 1,
      hostedTotal: 0,
      cohostTotal: 2,
      cohostInterview: 1,
      cohostTraining: 1,
      minOverseer: 0,
      shiftMinutes: 0,
    },
    junior_corporate: {
      label: 'Corporate',
      mode: 'hosted_and_cohost',
      total: 0,
      minInterview: 0,
      minTraining: 0,
      hostedTotal: 2,
      hostedInterview: 1,
      hostedTraining: 1,
      cohostTotal: 2,
      cohostInterview: 1,
      cohostTraining: 1,
      minOverseer: 0,
      shiftMinutes: 0,
    },
    head_corporate: {
      label: 'Head Corporate',
      mode: 'hosted_and_cohost',
      total: 0,
      minInterview: 0,
      minTraining: 0,
      hostedTotal: 2,
      hostedInterview: 1,
      hostedTraining: 1,
      cohostTotal: 2,
      cohostInterview: 1,
      cohostTraining: 1,
      minOverseer: 0,
      shiftMinutes: 0,
    },
    corporate_board: {
      label: 'Corporate Board',
      mode: 'hosted_and_overseer',
      total: 0,
      minInterview: 0,
      minTraining: 0,
      hostedTotal: 2,
      hostedInterview: 1,
      hostedTraining: 1,
      cohostTotal: 0,
      minOverseer: 2,
      overseerInterview: 1,
      overseerTraining: 1,
      shiftMinutes: 0,
    },
    presidential: {
      label: 'Presidential',
      mode: 'hosted_and_overseer',
      total: 0,
      minInterview: 0,
      minTraining: 0,
      hostedTotal: 1,
      hostedInterview: 0,
      hostedTraining: 0,
      cohostTotal: 0,
      minOverseer: 1,
      overseerInterview: 0,
      overseerTraining: 0,
      shiftMinutes: 0,
    },
  };

  let stored = {};
  if (quotaSettings && typeof quotaSettings.getAllQuotas === 'function') {
    stored = quotaSettings.getAllQuotas() || {};
  }

  const merge = (key, sourceKey = key) => ({
    ...fallback[key],
    ...(stored[sourceKey] || {}),
  });

  const juniorCorporate = {
    ...fallback.junior_corporate,
    ...(stored.junior_corporate || stored.corporate || {}),
    label: fallback.junior_corporate.label,
    mode: 'hosted_and_cohost',
  };

  return {
    intern: { ...merge('intern'), mode: 'regular' },
    management: { ...merge('management'), mode: 'regular' },
    senior_management: { ...merge('senior_management'), mode: 'regular' },
    corporate_intern: { ...merge('corporate_intern'), mode: 'regular_and_cohost' },
    junior_corporate: juniorCorporate,
    head_corporate: { ...merge('head_corporate'), mode: 'hosted_and_cohost' },
    corporate_board: { ...merge('corporate_board'), mode: 'hosted_and_overseer' },
    presidential: { ...merge('presidential'), mode: 'hosted_and_overseer' },
  };
}

function buildRoleDisplayConfig() {
  return {
    intern: ['interviewer', 'trainer', 'helper', 'spectator'],
    management: ['supervisor', 'interviewer', 'trainer', 'helper', 'spectator'],
    senior_management: ['supervisor', 'interviewer', 'trainer', 'helper', 'spectator'],
    corporate_intern: ['cohost', 'supervisor', 'interviewer', 'trainer', 'helper', 'spectator'],
    junior_corporate: ['host', 'cohost', 'supervisor', 'interviewer', 'trainer', 'helper', 'spectator'],
    head_corporate: ['overseer', 'host', 'cohost', 'supervisor', 'interviewer', 'trainer', 'helper', 'spectator'],
    corporate_board: ['overseer', 'host', 'cohost', 'supervisor', 'interviewer', 'trainer', 'helper', 'spectator'],
    presidential: ['overseer', 'host', 'cohost', 'supervisor', 'interviewer', 'trainer', 'helper', 'spectator'],
  };
}

function getQuotaProfileForMember(member) {
  if (!member || !member.roles) return null;

  const quotas = getQuotaConfig();
  const roleDisplayConfig = buildRoleDisplayConfig();

  const isPresidentialIntern = () =>
    hasRoleNameKeywords(member, ['presidential', 'intern']) ||
    hasRoleNameKeywords(member, ['presidential', 'intern', 'team']);

  const profiles = [
    {
      key: 'corporate_board',
      label: quotas.corporate_board?.label || 'Corporate Board',
      ids: [
        ...getRoleIds('CORPORATE_BOARD_ROLE_IDS'),
        ...getRoleIds('BOARD_OF_DIRECTOR_ROLE_IDS'),
        ...getRoleIds('BOD_ROLE_IDS'),
        ...getRoleIds('PRESIDENTIAL_INTERN_ROLE_IDS'),
      ],
      nameCheck: () =>
        hasCorporateBoardRoleName(member) ||
        hasTeamRoleName(member, ['corporate', 'board']) ||
        isPresidentialIntern(),
      quota: quotas.corporate_board,
      isCorporatePlus: true,
      isCorporateInternPlus: true,
      visibleRoleKeys: roleDisplayConfig.corporate_board,
    },
    {
      key: 'presidential',
      label: quotas.presidential?.label || 'Presidentials',
      ids: getRoleIds('PRESIDENTIAL_ROLE_IDS'),
      nameCheck: () => hasTeamRoleName(member, ['presidential']) && !isPresidentialIntern(),
      quota: quotas.presidential,
      isCorporatePlus: true,
      isCorporateInternPlus: true,
      visibleRoleKeys: roleDisplayConfig.presidential,
    },
    {
      key: 'head_corporate',
      label: quotas.head_corporate?.label || 'Head Corporate+',
      ids: getRoleIds('HEAD_CORPORATE_ROLE_IDS'),
      nameCheck: () => hasTeamRoleName(member, ['head', 'corporate']),
      quota: quotas.head_corporate,
      isCorporatePlus: true,
      isCorporateInternPlus: true,
      visibleRoleKeys: roleDisplayConfig.head_corporate,
    },
    {
      key: 'junior_corporate',
      label: quotas.junior_corporate?.label || 'Junior Corporate+',
      ids: getRoleIds('CORPORATE_ROLE_IDS'),
      nameCheck: () =>
        hasTeamRoleName(member, ['junior', 'corporate']) ||
        hasTeamRoleName(member, ['senior', 'corporate']) ||
        (hasTeamRoleName(member, ['corporate']) && !hasTeamRoleName(member, ['corporate', 'intern'])),
      quota: quotas.junior_corporate,
      isCorporatePlus: true,
      isCorporateInternPlus: true,
      visibleRoleKeys: roleDisplayConfig.junior_corporate,
    },
    {
      key: 'corporate_intern',
      label: quotas.corporate_intern?.label || 'Corporate Interns',
      ids: [...getRoleIds('CORPORATE_INTERN_ROLE_IDS'), '1036289067182207008'],
      nameCheck: () => hasTeamRoleName(member, ['corporate', 'intern']),
      quota: quotas.corporate_intern,
      isCorporatePlus: false,
      isCorporateInternPlus: true,
      visibleRoleKeys: roleDisplayConfig.corporate_intern,
    },
    {
      key: 'senior_management',
      label: quotas.senior_management?.label || 'Senior Management',
      ids: getRoleIds('SENIOR_MANAGEMENT_ROLE_IDS'),
      nameCheck: () => hasTeamRoleName(member, ['senior', 'management']),
      quota: quotas.senior_management,
      isCorporatePlus: false,
      isCorporateInternPlus: false,
      visibleRoleKeys: roleDisplayConfig.senior_management,
    },
    {
      key: 'management',
      label: quotas.management?.label || 'Management',
      ids: getRoleIds('MANAGEMENT_ROLE_IDS'),
      nameCheck: () => hasTeamRoleName(member, ['management']),
      quota: quotas.management,
      isCorporatePlus: false,
      isCorporateInternPlus: false,
      visibleRoleKeys: roleDisplayConfig.management,
    },
    {
      key: 'intern',
      label: quotas.intern?.label || 'Interns',
      ids: getRoleIds('INTERN_ROLE_IDS'),
      nameCheck: () => hasTeamRoleName(member, ['intern']),
      quota: quotas.intern,
      isCorporatePlus: false,
      isCorporateInternPlus: false,
      visibleRoleKeys: roleDisplayConfig.intern,
    },
  ];

  for (const profile of profiles) {
    if ((profile.ids.length && hasAnyRoleId(member, profile.ids)) || profile.nameCheck()) {
      return profile;
    }
  }

  return null;
}

function getTimeZoneParts(date, timeZone = TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
    weekday: 'short',
  });

  const parts = formatter.formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }

  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const hour = Number(map.hour) === 24 ? 0 : Number(map.hour);

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: weekdayMap[map.weekday],
  };
}

function zonedLocalToUtc(
  { year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0 },
  timeZone = TIME_ZONE,
) {
  const targetLocalMs = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  let guess = targetLocalMs;

  for (let i = 0; i < 4; i += 1) {
    const actual = getTimeZoneParts(new Date(guess), timeZone);
    const actualLocalMs = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
      0,
    );
    guess += targetLocalMs - actualLocalMs;
  }

  return guess;
}

function addDaysToLocalDate(year, month, day, offsetDays) {
  const utc = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

function getWeekRange(offsetWeeks = 0, timeZone = TIME_ZONE) {
  return getWeekRangeForDate(
    new Date(Date.now() + offsetWeeks * 7 * 24 * 60 * 60 * 1000),
    timeZone,
  );
}

function getWeekRangeForDate(date, timeZone = TIME_ZONE) {
  const parts = getTimeZoneParts(date, timeZone);

  const localNoonUtc = zonedLocalToUtc(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: 12,
      minute: 0,
      second: 0,
      millisecond: 0,
    },
    timeZone,
  );

  const localNoon = new Date(localNoonUtc);
  const localWeekday = getTimeZoneParts(localNoon, timeZone).weekday;
  const daysSinceMonday = localWeekday === 0 ? 6 : localWeekday - 1;

  const mondayLocal = addDaysToLocalDate(
    parts.year,
    parts.month,
    parts.day,
    -daysSinceMonday,
  );

  const sundayLocal = addDaysToLocalDate(
    mondayLocal.year,
    mondayLocal.month,
    mondayLocal.day,
    6,
  );

  const startMs = zonedLocalToUtc(
    {
      ...mondayLocal,
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0,
    },
    timeZone,
  );

  const endMs = zonedLocalToUtc(
    {
      ...sundayLocal,
      hour: 23,
      minute: 59,
      second: 59,
      millisecond: 999,
    },
    timeZone,
  );

  return {
    startMs,
    endMs,
    startLocal: mondayLocal,
    endLocal: sundayLocal,
  };
}

function getWeekKeyForDate(date, timeZone = TIME_ZONE) {
  const range = getWeekRangeForDate(date, timeZone);
  return `${range.startLocal.year}-${String(range.startLocal.month).padStart(2, '0')}-${String(range.startLocal.day).padStart(2, '0')}`;
}


function runWeeklyMaintenance() {
  // Activity is now read directly from #session-logs/#sessions-logs.
  // This is intentionally a no-op so old stored activity cannot create hidden counts.
  return {
    currentWeekKey: getWeekKeyForDate(new Date(), TIME_ZONE),
    previousWeekKey: getWeekKeyForDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), TIME_ZONE),
    source: 'session-logs',
  };
}

function recordHostedSession() {
  // No persistent activity storage. #session-logs is the source of truth.
  return true;
}

function recordSupportSession() {
  // No persistent activity storage. #session-logs is the source of truth.
  return true;
}

function replaceSessionActivity() {
  // /editactivity updates the actual log message. Activity reads that log message directly.
  return true;
}

function extractIdsFromFieldValue(value) {
  const text = String(value || '');
  const ids = new Set();

  const mentionMatches = [...text.matchAll(/<@!?(\d{17,20})>/g)];
  for (const match of mentionMatches) ids.add(match[1]);

  const rawMatches = [...text.matchAll(/\b(\d{17,20})\b/g)];
  for (const match of rawMatches) ids.add(match[1]);

  return [...ids];
}

function embedToPlainObject(embed) {
  return embed?.toJSON?.() || embed || {};
}

function detectSessionTypeFromEmbed(embed) {
  const data = embedToPlainObject(embed);
  const title = String(data.title || '').toLowerCase();
  const description = String(data.description || '').toLowerCase();
  const footer = String(data.footer?.text || '').toLowerCase();
  const fields = Array.isArray(data.fields)
    ? data.fields.map((field) => `${field.name || ''} ${field.value || ''}`).join('\n').toLowerCase()
    : '';
  const text = `${title}\n${description}\n${footer}\n${fields}`;

  if (text.includes('mass shift') || text.includes('massshift') || text.includes('mass-shift')) return 'mass_shift';
  if (text.includes('interview')) return 'interview';
  if (text.includes('training') || text.includes('trainer')) return 'training';

  return null;
}

function embedLooksCancelled(embed) {
  const data = embedToPlainObject(embed);
  const parts = [data.title, data.description, data.footer?.text];
  for (const field of data.fields || []) {
    parts.push(field.name, field.value);
  }
  const text = parts.filter(Boolean).join('\n').toLowerCase();
  return text.includes('cancelled') || text.includes('canceled') || text.includes('not counted');
}

function normalizeFieldName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapFieldNameToRoleKey(fieldName, sessionType = null) {
  const name = normalizeFieldName(fieldName);

  if (!name) return null;
  if (name.includes('trello') || name.includes('card link') || name === 'session') return null;
  if (name.includes('co-host') || name.includes('cohost') || name.includes('co host')) return 'cohost';
  if (name.includes('overseer')) return 'overseer';
  if (name.includes('supervisor')) return 'supervisor';
  if (name.includes('helper')) return 'helper';
  if (name.includes('spectator')) return 'spectator';
  if (name.includes('trainer')) return 'trainer';
  if (name.includes('interviewer')) return 'interviewer';
  if (name.includes('attendee')) return sessionType === 'mass_shift' ? 'attendee' : 'attendee';
  if (name === 'host' || (name.includes('host') && !name.includes('co'))) return null;

  return null;
}

function isHostField(fieldName) {
  const name = normalizeFieldName(fieldName);
  return (name === 'host' || name.endsWith(' host') || name.includes('host')) &&
    !name.includes('co-host') &&
    !name.includes('cohost') &&
    !name.includes('co host');
}

function messageTextForActivitySearch(message) {
  const parts = [message?.content || ''];

  for (const embed of message?.embeds || []) {
    const data = embedToPlainObject(embed);
    parts.push(data.title || '', data.description || '', data.url || '', data.footer?.text || '');
    for (const field of data.fields || []) parts.push(field.name || '', field.value || '');
  }

  return parts.join('\n');
}

function extractTrelloShortIdFromText(text) {
  const value = String(text || '');
  const urlMatch = value.match(/trello\.com\/c\/([A-Za-z0-9]+)/i);
  if (urlMatch) return urlMatch[1];

  const footerMatch = value.match(/trello\s*card\s*:?\s*([A-Za-z0-9_-]{4,})/i);
  if (footerMatch) return footerMatch[1];

  return null;
}

function getSessionKeyForLogMessage(message, embed, embedIndex = 0) {
  const data = embedToPlainObject(embed);
  const text = [
    message?.content || '',
    data.title || '',
    data.description || '',
    data.url || '',
    data.footer?.text || '',
    ...(data.fields || []).flatMap((field) => [field.name || '', field.value || '']),
  ].join('\n');

  const shortId = extractTrelloShortIdFromText(text);
  return shortId ? `trello:${shortId}` : `message:${message.id}:${embedIndex}`;
}

function parseActivityFromLogMessage(message) {
  const entries = [];
  if (!message?.embeds?.length) return entries;

  for (let embedIndex = 0; embedIndex < message.embeds.length; embedIndex += 1) {
    const embed = message.embeds[embedIndex];
    const data = embedToPlainObject(embed);
    const sessionType = detectSessionTypeFromEmbed(data);
    if (!sessionType) continue;
    if (embedLooksCancelled(data)) continue;

    const sessionKey = getSessionKeyForLogMessage(message, data, embedIndex);
    const timestamp = message.createdTimestamp || Date.now();
    const guildId = message.guildId || null;
    const hostedSeen = new Set();
    const supportSeen = new Set();

    for (const field of data.fields || []) {
      const fieldName = String(field.name || '');
      const ids = extractIdsFromFieldValue(field.value);
      if (!ids.length) continue;

      if (isHostField(fieldName)) {
        for (const userId of ids) {
          const key = `${sessionKey}:host:${userId}`;
          if (hostedSeen.has(key)) continue;
          hostedSeen.add(key);
          entries.push({
            type: 'hosted',
            userId,
            shortId: sessionKey,
            sessionType,
            guildId,
            timestamp,
            cancelled: false,
          });
        }
        continue;
      }

      const roleKey = mapFieldNameToRoleKey(fieldName, sessionType);
      if (!roleKey) continue;

      for (const userId of ids) {
        const key = `${sessionKey}:${roleKey}:${userId}`;
        if (supportSeen.has(key)) continue;
        supportSeen.add(key);
        entries.push({
          type: 'support',
          userId,
          shortId: sessionKey,
          sessionType,
          roleKey,
          guildId,
          timestamp,
          cancelled: false,
        });
      }
    }
  }

  return entries;
}

const SESSION_LOG_CHANNEL_NAMES = ['session-logs', 'sessions-logs'];
const ACTIVITY_LOG_SCAN_LIMIT = Number(process.env.ACTIVITY_SESSION_LOG_SCAN_LIMIT || 2500);
const ACTIVITY_CACHE_TTL_MS = Number(process.env.ACTIVITY_SESSION_LOG_CACHE_MS || 2500);
const activityScanCache = new Map();

function getConfiguredSessionLogChannelIds() {
  return [
    process.env.SESSION_LOG_CHANNEL_ID,
    process.env.SESSION_ATTENDEES_LOG_CHANNEL_ID,
    process.env.ACTIVITY_LOG_CHANNEL_ID,
    SESSION_LOG_CHANNEL_ID,
  ].filter(Boolean);
}

async function fetchTextChannel(client, channelId) {
  if (!client || !channelId) return null;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return null;
  return channel;
}

async function resolveSessionLogChannels(client, guildId = null) {
  const channels = [];
  const seen = new Set();

  async function addChannel(channel) {
    if (!channel?.id || seen.has(channel.id) || !channel.isTextBased?.()) return;
    seen.add(channel.id);
    channels.push(channel);
  }

  for (const channelId of getConfiguredSessionLogChannelIds()) {
    const channel = await fetchTextChannel(client, channelId);
    if (channel) await addChannel(channel);
  }

  const guild = guildId ? await client.guilds.fetch(guildId).catch(() => null) : null;
  const guildChannels = guild ? await guild.channels.fetch().catch(() => null) : null;

  if (guildChannels?.size) {
    const exactLogs = [...guildChannels.values()]
      .filter((channel) => channel?.isTextBased?.())
      .filter((channel) => SESSION_LOG_CHANNEL_NAMES.includes(String(channel.name || '').toLowerCase()))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    for (const channel of exactLogs) await addChannel(channel);
  }

  return channels;
}

async function fetchRecentSessionLogEntries(client, { guildId = null, force = false } = {}) {
  const currentRange = getWeekRange(0, TIME_ZONE);
  const lastRange = getWeekRange(-1, TIME_ZONE);
  const earliestMs = lastRange.startMs;
  const latestMs = currentRange.endMs;
  const cacheKey = guildId || 'global';
  const cached = activityScanCache.get(cacheKey);

  if (!force && cached && Date.now() - cached.cachedAt < ACTIVITY_CACHE_TTL_MS) {
    return cached.entries;
  }

  const channels = await resolveSessionLogChannels(client, guildId);
  const allEntries = [];
  const seenEntryKeys = new Set();
  const seenSessionKeys = new Set();

  for (const channel of channels) {
    let before = null;
    let scanned = 0;

    while (scanned < ACTIVITY_LOG_SCAN_LIMIT) {
      const limit = Math.min(100, ACTIVITY_LOG_SCAN_LIMIT - scanned);
      const batch = await channel.messages.fetch(before ? { limit, before } : { limit }).catch((error) => {
        console.error(`[ACTIVITY] Failed scanning #${channel.name || channel.id}:`, error?.message || error);
        return null;
      });

      if (!batch?.size) break;

      const ordered = [...batch.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
      scanned += ordered.length;
      before = ordered[ordered.length - 1]?.id || before;

      let reachedOlderThanWindow = false;

      for (const message of ordered) {
        if (message.createdTimestamp > latestMs + 24 * 60 * 60 * 1000) continue;
        if (message.createdTimestamp < earliestMs) {
          reachedOlderThanWindow = true;
          continue;
        }

        const parsedEntries = parseActivityFromLogMessage(message);
        if (!parsedEntries.length) continue;

        const messageSessionKeys = [...new Set(parsedEntries.map((entry) => entry.shortId).filter(Boolean))];
        if (messageSessionKeys.length && messageSessionKeys.every((key) => seenSessionKeys.has(key))) {
          continue;
        }

        for (const entry of parsedEntries) {
          if (seenSessionKeys.has(entry.shortId)) continue;
          const key = `${entry.type}:${entry.shortId}:${entry.roleKey || 'host'}:${entry.userId}`;
          if (seenEntryKeys.has(key)) continue;
          seenEntryKeys.add(key);
          allEntries.push(entry);
        }

        for (const key of messageSessionKeys) seenSessionKeys.add(key);
      }

      if (reachedOlderThanWindow || batch.size < limit || !before) break;
    }
  }

  activityScanCache.set(cacheKey, {
    cachedAt: Date.now(),
    entries: allEntries,
  });

  return allEntries;
}

async function backfillFromLogChannel(client, options = {}) {
  // Kept for command compatibility. This refreshes the short in-memory scan cache only.
  if (!client) return;
  await fetchRecentSessionLogEntries(client, { guildId: options.guildId || null, force: true }).catch(() => null);
}

function getAllActivity() {
  return {
    hostedSessions: [],
    supportSessions: [],
    meta: {
      source: 'session-logs',
      note: 'Persistent activity storage is disabled. Activity is scanned directly from #session-logs.',
    },
  };
}

async function getUserActivity(client, userId, { includeCancelled = false, guildId = null, force = false } = {}) {
  if (!client || !userId || typeof client === 'string') {
    return { hosted: [], support: [] };
  }

  const entries = await fetchRecentSessionLogEntries(client, { guildId, force });
  const hosted = [];
  const support = [];

  for (const entry of entries) {
    if (entry.userId !== userId) continue;
    if (!includeCancelled && entry.cancelled) continue;
    if (entry.type === 'hosted') hosted.push(entry);
    if (entry.type === 'support') support.push(entry);
  }

  return { hosted, support };
}

function emptyRoleBuckets() {
  return {
    host: 0,
    cohost: 0,
    overseer: 0,
    supervisor: 0,
    trainer: 0,
    helper: 0,
    interviewer: 0,
    spectator: 0,
    attendee: 0,
  };
}

function normalizeSessionType(sessionType) {
  const type = String(sessionType || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (type === 'massshift' || type === 'mass_shift') return 'mass_shift';
  if (type.includes('interview')) return 'interview';
  if (type.includes('training')) return 'training';
  return type || 'session';
}

function emptyCounts() {
  return {
    total: 0,
    interview: 0,
    training: 0,
    shift: 0,
  };
}

function summarizeEntries(entries, range, entryType) {
  const filtered = entries.filter(
    (entry) => entry.timestamp >= range.startMs && entry.timestamp <= range.endMs,
  );

  const summary = {
    total: filtered.length,
    interview: 0,
    training: 0,
    shift: 0,
    roles: emptyRoleBuckets(),
    rolesBySession: {},
    entries: filtered,
  };

  function bumpRoleSession(roleKey, sessionType) {
    const type = normalizeSessionType(sessionType);

    if (!summary.rolesBySession[roleKey]) {
      summary.rolesBySession[roleKey] = emptyCounts();
    }

    summary.rolesBySession[roleKey].total += 1;

    if (type === 'interview') summary.rolesBySession[roleKey].interview += 1;
    if (type === 'training') summary.rolesBySession[roleKey].training += 1;
    if (type === 'mass_shift') summary.rolesBySession[roleKey].shift += 1;
  }

  for (const entry of filtered) {
    const type = normalizeSessionType(entry.sessionType);

    if (type === 'interview') summary.interview += 1;
    if (type === 'training') summary.training += 1;
    if (type === 'mass_shift') summary.shift += 1;

    if (entryType === 'hosted') {
      summary.roles.host += 1;
      bumpRoleSession('host', type);
      continue;
    }

    if (entry.roleKey) {
      const key = entry.roleKey;
      if (!Object.prototype.hasOwnProperty.call(summary.roles, key)) {
        summary.roles[key] = 0;
      }
      summary.roles[key] += 1;
      bumpRoleSession(key, type);
    }
  }

  return summary;
}

function summarizeActivity(activity, range) {
  return {
    hosted: summarizeEntries(activity.hosted || [], range, 'hosted'),
    support: summarizeEntries(activity.support || [], range, 'support'),
  };
}

function makeQuotaSource(total = 0, interview = 0, training = 0, shift = 0, extra = {}) {
  return {
    total,
    interview,
    training,
    shift,
    ...extra,
  };
}

function addCounts(...countsList) {
  return countsList.reduce(
    (sum, counts) => ({
      total: sum.total + (counts?.total || 0),
      interview: sum.interview + (counts?.interview || 0),
      training: sum.training + (counts?.training || 0),
      shift: sum.shift + (counts?.shift || 0),
    }),
    emptyCounts(),
  );
}

function getRoleSessionCounts(summary, roleKey) {
  return summary?.rolesBySession?.[roleKey] || emptyCounts();
}

function getQuotaSource(summary, quotaProfile) {
  const quota = quotaProfile?.quota || {};
  const mode = quota.mode;

  const host = getRoleSessionCounts(summary.hosted, 'host');
  const cohost = getRoleSessionCounts(summary.support, 'cohost');
  const overseer = getRoleSessionCounts(summary.support, 'overseer');
  const interviewer = getRoleSessionCounts(summary.support, 'interviewer');
  const trainer = getRoleSessionCounts(summary.support, 'trainer');
  const helper = getRoleSessionCounts(summary.support, 'helper');
  const supervisor = getRoleSessionCounts(summary.support, 'supervisor');
  const attendee = getRoleSessionCounts(summary.support, 'attendee');

  const countedRegular = addCounts(interviewer, trainer, helper, supervisor);
  const countedAnySupport = addCounts(...Object.entries(summary.support.rolesBySession || {})
    .filter(([roleKey]) => roleKey !== 'spectator')
    .map(([, counts]) => counts));

  const common = {
    hostedTotal: host.total,
    hostedInterview: host.interview,
    hostedTraining: host.training,
    hostedShift: host.shift,
    cohostTotal: cohost.total,
    cohostInterview: cohost.interview,
    cohostTraining: cohost.training,
    cohostShift: cohost.shift,
    overseerTotal: overseer.total,
    overseerInterview: overseer.interview,
    overseerTraining: overseer.training,
    overseerShift: overseer.shift,
    interviewerTotal: interviewer.total,
    interviewerInterview: interviewer.interview,
    trainerTotal: trainer.total,
    trainerTraining: trainer.training,
    helperTotal: helper.total,
    helperTraining: helper.training,
    supervisorTotal: supervisor.total,
    supervisorTraining: supervisor.training,
    regularTotal: countedRegular.total,
    regularInterview: countedRegular.interview,
    regularTraining: countedRegular.training,
    regularShift: countedRegular.shift,
    attendeeShift: attendee.shift,
    shiftMinutes: 0,
  };

  if (mode === 'regular') {
    return makeQuotaSource(
      countedRegular.total,
      countedRegular.interview,
      countedRegular.training,
      countedRegular.shift,
      common,
    );
  }

  if (mode === 'regular_and_cohost') {
    const counted = addCounts(countedRegular, cohost);
    return makeQuotaSource(counted.total, counted.interview, counted.training, counted.shift, common);
  }

  if (mode === 'cohost') {
    return makeQuotaSource(cohost.total, cohost.interview, cohost.training, cohost.shift, common);
  }

  if (mode === 'hosted') {
    return makeQuotaSource(host.total, host.interview, host.training, host.shift, common);
  }

  if (mode === 'head_corporate_mixed') {
    return makeQuotaSource(host.total + overseer.total, host.interview, host.training, host.shift, {
      ...common,
      total: host.total + overseer.total,
    });
  }

  if (mode === 'overseer_only') {
    return makeQuotaSource(overseer.total, overseer.interview, overseer.training, overseer.shift, common);
  }

  if (mode === 'hosted_and_cohost') {
    const counted = addCounts(host, cohost);
    return makeQuotaSource(counted.total, counted.interview, counted.training, counted.shift, common);
  }

  if (mode === 'hosted_and_overseer') {
    const counted = addCounts(host, overseer);
    return makeQuotaSource(counted.total, counted.interview, counted.training, counted.shift, common);
  }

  if (mode === 'combined_any') {
    const counted = addCounts(host, countedAnySupport);
    return makeQuotaSource(counted.total, counted.interview, counted.training, counted.shift, common);
  }

  return makeQuotaSource(countedRegular.total, countedRegular.interview, countedRegular.training, countedRegular.shift, common);
}

function hasMetQuota(summary, quotaProfile) {
  if (!quotaProfile || !quotaProfile.quota) return false;

  const quota = quotaProfile.quota;
  const source = getQuotaSource(summary, quotaProfile);

  const meets = (actual, required) => Number(actual || 0) >= Number(required || 0);
  const checkSplit = (prefix, totalKey, interviewKey, trainingKey) => {
    const totalRequired = Number(quota[totalKey] || 0);
    const interviewRequired = Number(quota[interviewKey] || 0);
    const trainingRequired = Number(quota[trainingKey] || 0);

    if (totalRequired > 0 && !meets(source[prefix + 'Total'], totalRequired)) return false;
    if (interviewRequired > 0 && !meets(source[prefix + 'Interview'], interviewRequired)) return false;
    if (trainingRequired > 0 && !meets(source[prefix + 'Training'], trainingRequired)) return false;
    return true;
  };

  if (quota.mode === 'regular') {
    if (!meets(source.total, quota.total)) return false;
    if ((quota.minInterview || 0) > 0 && !meets(source.interview, quota.minInterview)) return false;
    if ((quota.minTraining || 0) > 0 && !meets(source.training, quota.minTraining)) return false;
    if ((quota.shiftMinutes || 0) > 0 && !meets(source.shiftMinutes, quota.shiftMinutes)) return false;
    return true;
  }

  if (quota.mode === 'cohost') {
    if (!checkSplit('cohost', 'cohostTotal', 'cohostInterview', 'cohostTraining')) return false;
    if ((quota.shiftMinutes || 0) > 0 && !meets(source.shiftMinutes, quota.shiftMinutes)) return false;
    return true;
  }

  if (quota.mode === 'regular_and_cohost') {
    if (!meets(source.regularTotal, quota.total)) return false;
    if ((quota.minInterview || 0) > 0 && !meets(source.regularInterview, quota.minInterview)) return false;
    if ((quota.minTraining || 0) > 0 && !meets(source.regularTraining, quota.minTraining)) return false;
    if (!checkSplit('cohost', 'cohostTotal', 'cohostInterview', 'cohostTraining')) return false;
    if ((quota.shiftMinutes || 0) > 0 && !meets(source.shiftMinutes, quota.shiftMinutes)) return false;
    return true;
  }

  if (quota.mode === 'hosted') {
    const totalRequired = quota.hostedTotal ?? quota.total ?? 0;
    const interviewRequired = quota.hostedInterview ?? quota.minInterview ?? 0;
    const trainingRequired = quota.hostedTraining ?? quota.minTraining ?? 0;
    if (totalRequired > 0 && !meets(source.hostedTotal, totalRequired)) return false;
    if (interviewRequired > 0 && !meets(source.hostedInterview, interviewRequired)) return false;
    if (trainingRequired > 0 && !meets(source.hostedTraining, trainingRequired)) return false;
    return true;
  }

  if (quota.mode === 'head_corporate_mixed') {
    if (!checkSplit('hosted', 'hostedTotal', 'hostedInterview', 'hostedTraining')) return false;
    if (!meets(source.overseerTotal, quota.minOverseer)) return false;
    return true;
  }

  if (quota.mode === 'overseer_only') {
    if (!checkSplit('overseer', 'minOverseer', 'overseerInterview', 'overseerTraining')) return false;
    return true;
  }

  if (quota.mode === 'hosted_and_cohost') {
    if (!checkSplit('hosted', 'hostedTotal', 'hostedInterview', 'hostedTraining')) return false;
    if (!checkSplit('cohost', 'cohostTotal', 'cohostInterview', 'cohostTraining')) return false;
    if ((quota.shiftMinutes || 0) > 0 && !meets(source.shiftMinutes, quota.shiftMinutes)) return false;
    return true;
  }

  if (quota.mode === 'hosted_and_overseer') {
    if (!checkSplit('hosted', 'hostedTotal', 'hostedInterview', 'hostedTraining')) return false;
    if (!checkSplit('overseer', 'minOverseer', 'overseerInterview', 'overseerTraining')) return false;
    if ((quota.shiftMinutes || 0) > 0 && !meets(source.shiftMinutes, quota.shiftMinutes)) return false;
    return true;
  }

  if (source.total < (quota.total || 0)) return false;
  if ((quota.minInterview || 0) > 0 && source.interview < quota.minInterview) return false;
  if ((quota.minTraining || 0) > 0 && source.training < quota.minTraining) return false;

  return true;
}

function formatRangeLabel(range) {
  const monthFormatter = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    timeZone: 'UTC',
  });

  const startUtc = new Date(Date.UTC(
    range.startLocal.year,
    range.startLocal.month - 1,
    range.startLocal.day,
    12, 0, 0,
  ));

  const endUtc = new Date(Date.UTC(
    range.endLocal.year,
    range.endLocal.month - 1,
    range.endLocal.day,
    12, 0, 0,
  ));

  const startLabel = `${monthFormatter.format(startUtc)} ${range.startLocal.day}, ${range.startLocal.year}`;
  const endLabel = `${monthFormatter.format(endUtc)} ${range.endLocal.day}, ${range.endLocal.year}`;

  return `${startLabel} to ${endLabel}`;
}

function formatWeekWindowShort(range) {
  const start = range.startLocal;
  const end = range.endLocal;

  const monthFormatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    timeZone: 'UTC',
  });

  const startUtc = new Date(Date.UTC(start.year, start.month - 1, start.day, 12, 0, 0));
  const endUtc = new Date(Date.UTC(end.year, end.month - 1, end.day, 12, 0, 0));

  return `${monthFormatter.format(startUtc)} ${start.day} - ${monthFormatter.format(endUtc)} ${end.day}`;
}

module.exports = {
  DATA_PATH,
  TIME_ZONE,
  SESSION_LOG_CHANNEL_ID,
  runWeeklyMaintenance,
  backfillFromLogChannel,
  recordHostedSession,
  recordSupportSession,
  replaceSessionActivity,
  getAllActivity,
  getUserActivity,
  getQuotaProfileForMember,
  getWeekRange,
  summarizeActivity,
  hasMetQuota,
  formatRangeLabel,
  formatWeekWindowShort,
  getQuotaSource,
};