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
    (entry) =>
      entry.userId === userId &&
      entry.shortId === shortId &&
      entry.roleKey === roleKey,
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

function extractIdsFromFieldValue(value) {
  const text = String(value || '');
  const ids = new Set();

  const mentionMatches = [...text.matchAll(/<@!?(\d{17,20})>/g)];
  for (const match of mentionMatches) ids.add(match[1]);

  const rawMatches = [...text.matchAll(/\b(\d{17,20})\b/g)];
  for (const match of rawMatches) ids.add(match[1]);

  return [...ids];
}

function detectSessionTypeFromEmbed(embed) {
  const title = String(embed.title || '').toLowerCase();
  const description = String(embed.description || '').toLowerCase();

  if (title.includes('interview') || description.includes('interview')) return 'interview';
  if (title.includes('training') || description.includes('training')) return 'training';
  if (title.includes('mass shift') || title.includes('massshift')) return 'massshift';

  return null;
}

function mapFieldNameToRoleKey(fieldName) {
  const name = String(fieldName || '').toLowerCase();

  if (name.includes('co-host') || name.includes('cohost')) return 'cohost';
  if (name.includes('overseer')) return 'overseer';
  if (name.includes('interviewer')) return 'interviewer';
  if (name.includes('trainer')) return 'interviewer';
  if (name.includes('attendees')) return 'interviewer';
  if (name.includes('spectator')) return 'spectator';
  if (name.includes('supervisor')) return 'supervisor';

  return null;
}

async function backfillFromLogChannel(client) {
  if (!client) return;

  runWeeklyMaintenance();
  const data = readStore();
  const now = Date.now();

  if (now - (data.meta.lastBackfillAt || 0) < 5 * 60 * 1000) {
    return;
  }

  const channel = await client.channels.fetch(SESSION_LOG_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    data.meta.lastBackfillAt = now;
    writeStore(data);
    return;
  }

  let before;
  let scanned = 0;

  while (scanned < 500) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || batch.size === 0) break;

    for (const message of batch.values()) {
      scanned += 1;

      const embed = message.embeds?.[0];
      if (!embed) continue;

      const sessionType = detectSessionTypeFromEmbed(embed);
      if (!sessionType) continue;

      const shortId = message.id;
      const timestamp = message.createdTimestamp;

      let hostIds = [];
      const supportEntries = [];

      for (const field of embed.fields || []) {
        const loweredName = String(field.name || '').toLowerCase();

        if (loweredName.includes('host')) {
          hostIds = extractIdsFromFieldValue(field.value);
          continue;
        }

        const roleKey = mapFieldNameToRoleKey(field.name);
        if (!roleKey) continue;

        const ids = extractIdsFromFieldValue(field.value);
        for (const userId of ids) {
          supportEntries.push({ userId, roleKey });
        }
      }

      for (const userId of hostIds) {
        upsertByKeys(
          data.hostedSessions,
          (entry) => entry.userId === userId && entry.shortId === shortId,
          {
            userId,
            shortId,
            sessionType,
            guildId: message.guildId || null,
            timestamp,
            cancelled: false,
          },
        );
      }

      for (const entry of supportEntries) {
        upsertByKeys(
          data.supportSessions,
          (existing) =>
            existing.userId === entry.userId &&
            existing.shortId === shortId &&
            existing.roleKey === entry.roleKey,
          {
            userId: entry.userId,
            shortId,
            sessionType,
            roleKey: entry.roleKey,
            guildId: message.guildId || null,
            timestamp,
            cancelled: false,
          },
        );
      }
    }

    before = batch.last()?.id;
    if (!before) break;
  }

  data.meta.lastBackfillAt = now;
  writeStore(data);
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
  getAllActivity,
  getUserActivity,
  getQuotaProfileForMember,
  getWeekRange,
  summarizeActivity,
  hasMetQuota,
  formatRangeLabel,
  formatWeekWindowShort,
};