
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
            lastMaintenanceAt: Date.now(),
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
        lastMaintenanceAt: Date.now(),
      },
    };
  }

  if (!Array.isArray(parsed.hostedSessions)) parsed.hostedSessions = [];
  if (!Array.isArray(parsed.supportSessions)) parsed.supportSessions = [];

  // Backward compatibility for old format: { sessions: [...] }
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
  if (!parsed.meta.lastMaintenanceAt) {
    parsed.meta.lastMaintenanceAt = Date.now();
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

function hasTeamRoleName(member, requiredKeywords) {
  return member.roles.cache.some((role) => {
    const name = normalizeRoleName(role.name);
    if (!name.includes('team')) return false;
    if (name.includes('former')) return false;
    if (name.includes('retired')) return false;
    if (name.includes('alumni')) return false;
    return requiredKeywords.every((keyword) => name.includes(keyword));
  });
}

function getQuotaConfig() {
  if (quotaSettings && typeof quotaSettings.getAllQuotas === 'function') {
    return quotaSettings.getAllQuotas();
  }

  return {
    intern: {
      label: 'Interns',
      mode: 'regular',
      total: 2,
      minInterview: 1,
      minTraining: 1,
    },
    management: {
      label: 'Management',
      mode: 'regular',
      total: 3,
      minInterview: 0,
      minTraining: 0,
    },
    senior_management: {
      label: 'Senior Management',
      mode: 'regular',
      total: 4,
      minInterview: 2,
      minTraining: 2,
    },
    corporate: {
      label: 'Corporate',
      mode: 'hosted',
      total: 4,
      minInterview: 2,
      minTraining: 2,
    },
    corporate_board: {
      label: 'Corporate Board',
      mode: 'hosted',
      total: 2,
      minInterview: 1,
      minTraining: 1,
    },
    presidential: {
      label: 'Presidentials',
      mode: 'hosted',
      total: 1,
      minInterview: 0,
      minTraining: 0,
    },
  };
}

function getQuotaProfileForMember(member) {
  if (!member || !member.roles) return null;

  const quotas = getQuotaConfig();
  const profiles = [
    {
      key: 'presidential',
      label: quotas.presidential?.label || 'Presidentials',
      ids: getRoleIds('PRESIDENTIAL_ROLE_IDS'),
      nameCheck: () => hasTeamRoleName(member, ['presidential']),
      quota: quotas.presidential,
      isCorporatePlus: true,
    },
    {
      key: 'corporate_board',
      label: quotas.corporate_board?.label || 'Corporate Board',
      ids: getRoleIds('CORPORATE_BOARD_ROLE_IDS'),
      nameCheck: () =>
        hasTeamRoleName(member, ['corporate', 'board']) ||
        hasTeamRoleName(member, ['board', 'directors']),
      quota: quotas.corporate_board,
      isCorporatePlus: true,
    },
    {
      key: 'corporate',
      label: quotas.corporate?.label || 'Corporate',
      ids: getRoleIds('CORPORATE_ROLE_IDS'),
      nameCheck: () => hasTeamRoleName(member, ['corporate']),
      quota: quotas.corporate,
      isCorporatePlus: true,
    },
    {
      key: 'senior_management',
      label: quotas.senior_management?.label || 'Senior Management',
      ids: getRoleIds('SENIOR_MANAGEMENT_ROLE_IDS'),
      nameCheck: () =>
        hasTeamRoleName(member, ['senior', 'management']) ||
        hasTeamRoleName(member, ['director']),
      quota: quotas.senior_management,
      isCorporatePlus: false,
    },
    {
      key: 'management',
      label: quotas.management?.label || 'Management',
      ids: getRoleIds('MANAGEMENT_ROLE_IDS'),
      nameCheck: () => hasTeamRoleName(member, ['management']),
      quota: quotas.management,
      isCorporatePlus: false,
    },
    {
      key: 'intern',
      label: quotas.intern?.label || 'Interns',
      ids: getRoleIds('INTERN_ROLE_IDS'),
      nameCheck: () => hasTeamRoleName(member, ['intern']),
      quota: quotas.intern,
      isCorporatePlus: false,
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

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
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
  const now = new Date();
  const nowParts = getTimeZoneParts(now, timeZone);
  const daysSinceMonday = (nowParts.weekday + 6) % 7;
  const mondayLocal = addDaysToLocalDate(
    nowParts.year,
    nowParts.month,
    nowParts.day,
    (offsetWeeks * 7) - daysSinceMonday,
  );

  const nextMondayLocal = addDaysToLocalDate(
    mondayLocal.year,
    mondayLocal.month,
    mondayLocal.day,
    7,
  );

  const startMs = zonedLocalToUtc(
    { ...mondayLocal, hour: 0, minute: 0, second: 0, millisecond: 0 },
    timeZone,
  );
  const nextStartMs = zonedLocalToUtc(
    { ...nextMondayLocal, hour: 0, minute: 0, second: 0, millisecond: 0 },
    timeZone,
  );

  return {
    startMs,
    endMs: nextStartMs - 1,
  };
}

function getWeekKeyForDate(date, timeZone = TIME_ZONE) {
  const range = getWeekRangeForDate(date, timeZone);
  const parts = getTimeZoneParts(new Date(range.startMs), timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function getWeekRangeForDate(date, timeZone = TIME_ZONE) {
  const nowParts = getTimeZoneParts(date, timeZone);
  const daysSinceMonday = (nowParts.weekday + 6) % 7;
  const mondayLocal = addDaysToLocalDate(
    nowParts.year,
    nowParts.month,
    nowParts.day,
    -daysSinceMonday,
  );
  const nextMondayLocal = addDaysToLocalDate(mondayLocal.year, mondayLocal.month, mondayLocal.day, 7);

  const startMs = zonedLocalToUtc(
    { ...mondayLocal, hour: 0, minute: 0, second: 0, millisecond: 0 },
    timeZone,
  );
  const nextStartMs = zonedLocalToUtc(
    { ...nextMondayLocal, hour: 0, minute: 0, second: 0, millisecond: 0 },
    timeZone,
  );

  return { startMs, endMs: nextStartMs - 1 };
}

function runWeeklyMaintenance() {
  const data = readStore();
  const currentWeekKey = getWeekKeyForDate(new Date(), TIME_ZONE);

  if (data.meta.currentWeekKey !== currentWeekKey) {
    data.meta.previousWeekKey = data.meta.currentWeekKey || null;
    data.meta.currentWeekKey = currentWeekKey;
  }

  data.meta.lastMaintenanceAt = Date.now();
  writeStore(data);
  return data.meta;
}

function upsertByKeys(collection, matcher, payload) {
  const existing = collection.find(matcher);
  if (existing) {
    Object.assign(existing, payload);
    return false;
  }

  collection.push(payload);
  return true;
}

function recordHostedSession({
  userId,
  shortId,
  sessionType,
  guildId = null,
  timestamp = Date.now(),
  cancelled = false,
}) {
  if (!userId || !shortId || !sessionType) return false;
  runWeeklyMaintenance();
  const data = readStore();

  upsertByKeys(
    data.hostedSessions,
    (entry) => entry.userId === userId && entry.shortId === shortId,
    {
      userId,
      shortId,
      sessionType,
      guildId,
      timestamp,
      cancelled,
    },
  );

  writeStore(data);
  return true;
}

function recordSupportSession({
  userId,
  shortId,
  sessionType,
  roleKey,
  guildId = null,
  timestamp = Date.now(),
  cancelled = false,
}) {
  if (!userId || !shortId || !sessionType || !roleKey) return false;
  runWeeklyMaintenance();
  const data = readStore();

  upsertByKeys(
    data.supportSessions,
    (entry) => entry.userId === userId && entry.shortId === shortId && entry.roleKey === roleKey,
    {
      userId,
      shortId,
      sessionType,
      roleKey,
      guildId,
      timestamp,
      cancelled,
    },
  );

  writeStore(data);
  return true;
}

function getAllActivity() {
  return readStore();
}

function getUserActivity(userId, { includeCancelled = false } = {}) {
  const data = readStore();

  const hosted = data.hostedSessions.filter((entry) => {
    if (entry.userId !== userId) return false;
    if (!includeCancelled && entry.cancelled) return false;
    return true;
  });

  const support = data.supportSessions.filter((entry) => {
    if (entry.userId !== userId) return false;
    if (!includeCancelled && entry.cancelled) return false;
    return true;
  });

  return { hosted, support };
}

function summarizeEntries(entries, range) {
  const filtered = entries.filter(
    (entry) => entry.timestamp >= range.startMs && entry.timestamp <= range.endMs,
  );

  const summary = {
    total: filtered.length,
    interview: 0,
    training: 0,
    roles: {},
  };

  for (const entry of filtered) {
    if (entry.sessionType === 'interview') summary.interview += 1;
    if (entry.sessionType === 'training' || entry.sessionType === 'massshift') {
      summary.training += 1;
    }
    if (entry.roleKey) {
      summary.roles[entry.roleKey] = (summary.roles[entry.roleKey] || 0) + 1;
    }
  }

  return summary;
}

function summarizeActivity(activity, range) {
  return {
    hosted: summarizeEntries(activity.hosted || [], range),
    support: summarizeEntries(activity.support || [], range),
  };
}

function hasMetQuota(summary, quotaProfile) {
  if (!quotaProfile || !quotaProfile.quota) return false;
  const quota = quotaProfile.quota;
  const source = quota.mode === 'hosted' ? summary.hosted : summary.support;

  if (source.total < (quota.total || 0)) return false;
  if ((quota.minInterview || 0) > 0 && source.interview < quota.minInterview) return false;
  if ((quota.minTraining || 0) > 0 && source.training < quota.minTraining) return false;
  return true;
}

function formatRangeLabel(range, timeZone = TIME_ZONE) {
  const start = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(range.startMs));

  const end = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(range.endMs));

  return `${start} to ${end}`;
}

function formatWeekWindowShort(range, timeZone = TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
  });

  return `${formatter.format(new Date(range.startMs))} - ${formatter.format(new Date(range.endMs))}`;
}

module.exports = {
  DATA_PATH,
  TIME_ZONE,
  runWeeklyMaintenance,
  recordHostedSession,
  recordSupportSession,
  getAllActivity,
  getUserActivity,
  getQuotaProfileForMember,
  getWeekRange,
  summarizeActivity,
  hasMetQuota,
  formatRangeLabel,
  formatWeekWindowShort,
};
