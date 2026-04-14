const fs = require('node:fs');
const path = require('node:path');
const rolesConfig = require('../config/roles');

const DATA_PATH = path.join(__dirname, '..', 'data', 'activityLogs.json');
const TIME_ZONE = 'America/New_York';

function ensureStore() {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify({ sessions: [] }, null, 2));
  }
}

function readStore() {
  ensureStore();
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { sessions: [] };
    if (!Array.isArray(parsed.sessions)) parsed.sessions = [];
    return parsed;
  } catch {
    return { sessions: [] };
  }
}

function writeStore(data) {
  ensureStore();
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

function recordHostedSession({ userId, shortId, sessionType, guildId = null, timestamp = Date.now(), cancelled = false }) {
  if (!userId || !shortId || !sessionType) return false;

  const data = readStore();
  const existing = data.sessions.find((entry) => entry.shortId === shortId);

  if (existing) {
    existing.userId = userId;
    existing.sessionType = sessionType;
    existing.guildId = guildId;
    existing.timestamp = timestamp;
    existing.cancelled = cancelled;
    writeStore(data);
    return true;
  }

  data.sessions.push({
    userId,
    shortId,
    sessionType,
    guildId,
    timestamp,
    cancelled,
  });

  writeStore(data);
  return true;
}

function getAllSessions() {
  return readStore().sessions;
}

function getUserSessions(userId, { includeCancelled = false } = {}) {
  return getAllSessions().filter((entry) => {
    if (entry.userId !== userId) return false;
    if (!includeCancelled && entry.cancelled) return false;
    return true;
  });
}

function getRoleIds(key) {
  const value = rolesConfig[key];
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function hasAnyRoleId(member, ids) {
  return ids.some((id) => member.roles.cache.has(id));
}

function hasRoleNameMatch(member, patterns) {
  const roleNames = member.roles.cache.map((role) => role.name.toLowerCase());
  return patterns.some((pattern) => roleNames.some((name) => name.includes(pattern)));
}

function getQuotaProfileForMember(member) {
  if (!member || !member.roles) return null;

  const profiles = [
    {
      key: 'presidential',
      label: 'Presidentials',
      ids: getRoleIds('PRESIDENTIAL_ROLE_IDS'),
      names: ['presidential', 'chief executive officer', 'ceo'],
      quota: { total: 1, interview: 0, training: 1 },
    },
    {
      key: 'corporate_board',
      label: 'Corporate Board',
      ids: getRoleIds('CORPORATE_BOARD_ROLE_IDS'),
      names: ['board of directors', 'corporate board', 'board'],
      quota: { total: 2, interview: 1, training: 1 },
    },
    {
      key: 'corporate',
      label: 'Corporate',
      ids: getRoleIds('CORPORATE_ROLE_IDS'),
      names: ['corporate intern', 'corporate'],
      quota: { total: 4, interview: 2, training: 2 },
    },
    {
      key: 'senior_management',
      label: 'Senior Management',
      ids: getRoleIds('SENIOR_MANAGEMENT_ROLE_IDS'),
      names: ['senior management', 'director'],
      quota: { total: 4, interview: 2, training: 2 },
    },
    {
      key: 'management',
      label: 'Management',
      ids: getRoleIds('MANAGEMENT_ROLE_IDS'),
      names: ['executive manager', 'assistant manager', 'management'],
      quota: { total: 3, interview: 2, training: 1 },
    },
    {
      key: 'intern',
      label: 'Interns',
      ids: getRoleIds('INTERN_ROLE_IDS'),
      names: ['leadership intern', 'intern'],
      quota: { total: 2, interview: 1, training: 1 },
    },
  ];

  for (const profile of profiles) {
    if (hasAnyRoleId(member, profile.ids) || hasRoleNameMatch(member, profile.names)) {
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

function zonedLocalToUtc({ year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0 }, timeZone = TIME_ZONE) {
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

  const startMs = zonedLocalToUtc({ ...mondayLocal, hour: 0, minute: 0, second: 0, millisecond: 0 }, timeZone);
  const nextStartMs = zonedLocalToUtc({ ...nextMondayLocal, hour: 0, minute: 0, second: 0, millisecond: 0 }, timeZone);

  return {
    startMs,
    endMs: nextStartMs - 1,
  };
}

function summarizeSessions(sessions, range) {
  const filtered = sessions.filter((entry) => entry.timestamp >= range.startMs && entry.timestamp <= range.endMs);

  const summary = {
    total: filtered.length,
    interview: 0,
    training: 0,
    cancelled: 0,
  };

  for (const entry of filtered) {
    if (entry.sessionType === 'interview') summary.interview += 1;
    if (entry.sessionType === 'training' || entry.sessionType === 'massshift') summary.training += 1;
    if (entry.cancelled) summary.cancelled += 1;
  }

  return summary;
}

function hasMetQuota(summary, quota) {
  if (!quota) return false;
  return (
    summary.total >= quota.total &&
    summary.interview >= quota.interview &&
    summary.training >= quota.training
  );
}

function formatRangeLabel(range, timeZone = TIME_ZONE) {
  const start = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
  }).format(new Date(range.startMs));

  const end = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
  }).format(new Date(range.endMs));

  return `${start} - ${end}`;
}

module.exports = {
  DATA_PATH,
  TIME_ZONE,
  recordHostedSession,
  getAllSessions,
  getUserSessions,
  getQuotaProfileForMember,
  getWeekRange,
  summarizeSessions,
  hasMetQuota,
  formatRangeLabel,
};
