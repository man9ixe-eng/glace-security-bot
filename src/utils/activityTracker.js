const fs = require('node:fs');
const path = require('node:path');
const { getQuota, getAllQuotas } = require('./quotaSettings');
const rolesConfig = require('../config/roles');

const DATA_PATH = path.join(__dirname, '..', 'data', 'activityLogs.json');
const TIME_ZONE = 'America/New_York';
const RESET_CHANNEL_ID = process.env.WEEKLY_ACTIVITY_RESET_CHANNEL_ID || null;
const SESSION_LOG_CHANNEL_ID = process.env.SESSION_LOG_CHANNEL_ID || null;
const MAX_BACKFILL_MESSAGES = Number(process.env.ACTIVITY_BACKFILL_MESSAGE_LIMIT || 250);
const BACKFILL_COOLDOWN_MS = 5 * 60 * 1000;

function ensureStore() {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(
      DATA_PATH,
      JSON.stringify({ sessions: [], meta: { lastWeeklyResetKey: null, lastBackfillAt: 0 } }, null, 2),
    );
  }
}

function readStore() {
  ensureStore();
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { sessions: [], meta: { lastWeeklyResetKey: null, lastBackfillAt: 0 } };
    }

    if (!Array.isArray(parsed.sessions)) parsed.sessions = [];
    if (!parsed.meta || typeof parsed.meta !== 'object') parsed.meta = {};
    if (!parsed.meta.lastWeeklyResetKey) parsed.meta.lastWeeklyResetKey = null;
    if (!parsed.meta.lastBackfillAt) parsed.meta.lastBackfillAt = 0;

    return parsed;
  } catch {
    return { sessions: [], meta: { lastWeeklyResetKey: null, lastBackfillAt: 0 } };
  }
}

function writeStore(data) {
  ensureStore();
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

function normalizeSessionType(sessionType) {
  const value = String(sessionType || '').trim().toLowerCase();
  if (value === 'interview') return 'interview';
  if (value === 'training') return 'training';
  if (value === 'massshift' || value === 'mass shift' || value === 'mass-shift') return 'massshift';
  return value || 'unknown';
}

function getAllSessions({ includeCancelled = false } = {}) {
  const sessions = readStore().sessions;
  if (includeCancelled) return sessions;
  return sessions.filter((entry) => !entry.cancelled);
}

function recordHostedSession({
  userId,
  shortId = null,
  sessionType,
  guildId = null,
  timestamp = Date.now(),
  cancelled = false,
  sourceMessageId = null,
}) {
  if (!userId || !sessionType) return false;

  const normalizedType = normalizeSessionType(sessionType);
  const data = readStore();

  const existing = data.sessions.find((entry) => {
    if (sourceMessageId && entry.sourceMessageId === sourceMessageId) return true;
    if (shortId && entry.shortId === shortId) return true;

    return (
      entry.userId === userId &&
      normalizeSessionType(entry.sessionType) === normalizedType &&
      Math.abs(Number(entry.timestamp || 0) - Number(timestamp || 0)) <= 10 * 60 * 1000
    );
  });

  if (existing) {
    existing.userId = userId;
    existing.shortId = shortId || existing.shortId || null;
    existing.sessionType = normalizedType;
    existing.guildId = guildId || existing.guildId || null;
    existing.timestamp = Number(timestamp || Date.now());
    existing.cancelled = Boolean(cancelled);
    if (sourceMessageId) existing.sourceMessageId = sourceMessageId;
    writeStore(data);
    return true;
  }

  data.sessions.push({
    userId,
    shortId: shortId || `manual-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    sessionType: normalizedType,
    guildId,
    timestamp: Number(timestamp || Date.now()),
    cancelled: Boolean(cancelled),
    sourceMessageId,
  });

  writeStore(data);
  return true;
}

function getUserSessions(userId, { includeCancelled = false } = {}) {
  return getAllSessions({ includeCancelled }).filter((entry) => entry.userId === userId);
}

function sanitizeRoleName(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function memberHasRoleId(member, ids) {
  return Array.isArray(ids) && ids.some((id) => member.roles.cache.has(id));
}

function getQuotaProfileForMember(member) {
  if (!member?.roles?.cache) return null;

  const namedTeamRoles = member.roles.cache
    .map((role) => ({ role, normalized: sanitizeRoleName(role.name) }))
    .filter(({ normalized }) => normalized.includes('team') && !normalized.includes('former'));

  const profiles = [
    {
      key: 'Presidentials',
      idKey: 'PRESIDENTIAL_ROLE_IDS',
      matches: ['presidential team', 'presidentials team', 'executive presidential team'],
      corporatePlus: true,
    },
    {
      key: 'Corporate Board',
      idKey: 'CORPORATE_BOARD_ROLE_IDS',
      matches: ['corporate board team', 'board team'],
      corporatePlus: true,
    },
    {
      key: 'Corporate',
      idKey: 'CORPORATE_ROLE_IDS',
      matches: ['corporate team', 'corporate intern team'],
      corporatePlus: true,
    },
    {
      key: 'Senior Management',
      idKey: 'SENIOR_MANAGEMENT_ROLE_IDS',
      matches: ['senior management team'],
      corporatePlus: false,
    },
    {
      key: 'Management',
      idKey: 'MANAGEMENT_ROLE_IDS',
      matches: ['management team'],
      corporatePlus: false,
    },
    {
      key: 'Intern',
      idKey: 'INTERN_ROLE_IDS',
      matches: ['intern team', 'leadership intern team'],
      corporatePlus: false,
    },
  ];

  for (const profile of profiles) {
    const quota = getQuota(profile.key);
    const byId = memberHasRoleId(member, rolesConfig[profile.idKey]);
    const byName = namedTeamRoles.some(({ normalized }) =>
      profile.matches.some((match) => normalized.includes(match)),
    );

    if (byId || byName) {
      return {
        key: profile.key,
        label: profile.key,
        corporatePlus: profile.corporatePlus,
        quota,
      };
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

  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

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

function summarizeSessions(sessions, range) {
  const filtered = sessions.filter(
    (entry) => Number(entry.timestamp) >= range.startMs && Number(entry.timestamp) <= range.endMs,
  );

  const summary = {
    total: filtered.length,
    interview: 0,
    training: 0,
    hosting: filtered.length,
    cancelled: 0,
  };

  for (const entry of filtered) {
    const type = normalizeSessionType(entry.sessionType);
    if (type === 'interview') summary.interview += 1;
    if (type === 'training' || type === 'massshift') summary.training += 1;
    if (entry.cancelled) summary.cancelled += 1;
  }

  return summary;
}

function hasMetQuota(summary, quota) {
  if (!quota) return false;
  if (summary.total < Number(quota.total || 0)) return false;
  if (Number(quota.interview || 0) > 0 && summary.interview < Number(quota.interview)) return false;
  if (Number(quota.training || 0) > 0 && summary.training < Number(quota.training)) return false;
  if (Number(quota.hosting || 0) > 0 && summary.hosting < Number(quota.hosting)) return false;
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

  return `${start} → ${end}`;
}

function getCurrentWeekKey(timeZone = TIME_ZONE) {
  const range = getWeekRange(0, timeZone);
  return String(range.startMs);
}

function purgeOldSessions(data, keepWeeks = 16) {
  const cutoff = getWeekRange(-keepWeeks, TIME_ZONE).startMs;
  data.sessions = data.sessions.filter((entry) => Number(entry.timestamp || 0) >= cutoff);
}

async function maybeAnnounceWeeklyReset(client) {
  if (!RESET_CHANNEL_ID) return;
  const channel = await client.channels.fetch(RESET_CHANNEL_ID).catch(() => null);
  if (!channel) return;

  const range = getWeekRange(0, TIME_ZONE);
  await channel.send({
    embeds: [
      {
        color: 0xf7b8ff,
        title: '✨ Activity Week Reset',
        description:
          'A new quota week has started.\n\n' +
          `📅 **Current Week:** ${formatRangeLabel(range, TIME_ZONE)}\n` +
          `🕛 Reset time: **Monday 12:00 AM ${TIME_ZONE}**`,
      },
    ],
  }).catch(() => null);
}

async function runWeeklyMaintenance(client) {
  const data = readStore();
  const currentKey = getCurrentWeekKey(TIME_ZONE);

  if (data.meta.lastWeeklyResetKey !== currentKey) {
    data.meta.lastWeeklyResetKey = currentKey;
    purgeOldSessions(data, 16);
    writeStore(data);
    await maybeAnnounceWeeklyReset(client);
  }
}

async function backfillFromSessionLogs(client, guild) {
  if (!client || !guild || !SESSION_LOG_CHANNEL_ID) return 0;

  const data = readStore();
  const now = Date.now();
  if (now - Number(data.meta.lastBackfillAt || 0) < BACKFILL_COOLDOWN_MS) {
    return 0;
  }

  const channel = await client.channels.fetch(SESSION_LOG_CHANNEL_ID).catch(() => null);
  if (!channel?.messages?.fetch) {
    data.meta.lastBackfillAt = now;
    writeStore(data);
    return 0;
  }

  const members = await guild.members.fetch().catch(() => null);
  if (!members) {
    data.meta.lastBackfillAt = now;
    writeStore(data);
    return 0;
  }

  const nameMap = new Map();
  for (const member of members.values()) {
    const candidates = [
      member.displayName,
      member.user?.globalName,
      member.user?.username,
    ].filter(Boolean);

    for (const value of candidates) {
      const key = sanitizeRoleName(value);
      if (!key) continue;
      if (!nameMap.has(key)) nameMap.set(key, member.id);
    }
  }

  const messages = await channel.messages.fetch({ limit: Math.min(MAX_BACKFILL_MESSAGES, 100) }).catch(() => null);
  if (!messages) {
    data.meta.lastBackfillAt = now;
    writeStore(data);
    return 0;
  }

  let added = 0;

  for (const message of messages.values()) {
    const embed = message.embeds?.[0];
    if (!embed?.title) continue;

    const title = String(embed.title).toLowerCase();
    let sessionType = null;
    if (title.includes('training')) sessionType = 'training';
    else if (title.includes('interview')) sessionType = 'interview';
    else if (title.includes('mass shift')) sessionType = 'massshift';
    if (!sessionType) continue;

    const hostField = embed.fields?.find((field) => String(field.name).toLowerCase() === 'host');
    const hostName = sanitizeRoleName(hostField?.value || '');
    if (!hostName) continue;

    const userId = nameMap.get(hostName);
    if (!userId) continue;

    const exists = data.sessions.some((entry) => entry.sourceMessageId === message.id);
    if (exists) continue;

    data.sessions.push({
      userId,
      shortId: `backfill-${message.id}`,
      sessionType,
      guildId: guild.id,
      timestamp: message.createdTimestamp,
      cancelled: false,
      sourceMessageId: message.id,
    });
    added += 1;
  }

  data.meta.lastBackfillAt = now;
  if (!data.meta.lastWeeklyResetKey) data.meta.lastWeeklyResetKey = getCurrentWeekKey(TIME_ZONE);
  writeStore(data);
  return added;
}

async function ensureActivityDataFresh(client, guild) {
  await runWeeklyMaintenance(client);
  await backfillFromSessionLogs(client, guild);
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
  ensureActivityDataFresh,
  runWeeklyMaintenance,
  getAllQuotas,
};
