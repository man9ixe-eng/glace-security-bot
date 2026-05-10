// src/utils/juniorActivityTracker.js
// Glace Hotels — Junior Staff training activity tracker
// Tracks Roblox USERNAME + Roblox ID from Roblox/TC log messages.

const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data', 'juniorActivity');
const META_PATH = path.join(DATA_DIR, 'meta.json');

const TIME_ZONE = 'America/New_York';

const JUNIOR_ACTIVITY_LOG_CHANNEL_ID =
  process.env.JUNIOR_ACTIVITY_LOG_CHANNEL_ID ||
  process.env.ROBLOX_TRAINING_LOG_CHANNEL_ID ||
  process.env.TC_LOG_CHANNEL_ID ||
  null;

const FALLBACK_CHANNEL_NAMES = [
  'junior-activity-log',
  'junior-activity-logs',
  'junior-training-log',
  'junior-training-logs',
  'training-log',
  'training-logs',
  'tc-log',
  'tc-logs',
  'roblox-training-log',
  'roblox-training-logs',
  'roblox-log',
  'roblox-logs',
];

const JUNIOR_ROLE_LABELS = [
  'Front Desk | Helper',
  'Custodian | Helper',
  'Hotel Cook | Helper',
  'Security | Helper',
];

const CURRENT_JUNIOR_STAFF_MESSAGE =
  'Sorry, this player does not have anything logged! Please check if they are Junior Staff. D:';

function isJuniorStaffRole(role) {
  const normalized = normalizeRole(role);
  return JUNIOR_ROLE_LABELS.includes(normalized);
}

function isJuniorStaffRecord(record) {
  if (!record) return false;
  return isJuniorStaffRole(record.role);
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(META_PATH)) {
    fs.writeFileSync(
      META_PATH,
      JSON.stringify(
        {
          lastBackfillAt: 0,
          lastLiveRecordAt: 0,
          knownLogChannelId: JUNIOR_ACTIVITY_LOG_CHANNEL_ID || null,
        },
        null,
        2,
      ),
    );
  }
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.error('[JUNIOR ACTIVITY] Failed to read JSON:', filePath, err);
    return fallback;
  }
}

function writeJson(filePath, value) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function readMeta() {
  ensureDataDir();
  const meta = readJson(META_PATH, {});
  if (!meta || typeof meta !== 'object') return {};
  if (!meta.lastBackfillAt) meta.lastBackfillAt = 0;
  if (!meta.lastLiveRecordAt) meta.lastLiveRecordAt = 0;
  if (!Object.prototype.hasOwnProperty.call(meta, 'knownLogChannelId')) {
    meta.knownLogChannelId = JUNIOR_ACTIVITY_LOG_CHANNEL_ID || null;
  }
  return meta;
}

function writeMeta(meta) {
  ensureDataDir();
  writeJson(META_PATH, meta || {});
}

function monthKeyFromTimestamp(timestamp) {
  const d = new Date(Number(timestamp || Date.now()));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthFilePath(monthKey) {
  return path.join(DATA_DIR, `${monthKey}.json`);
}

function readMonth(monthKey) {
  ensureDataDir();
  const data = readJson(monthFilePath(monthKey), []);
  return Array.isArray(data) ? data : [];
}

function writeMonth(monthKey, records) {
  ensureDataDir();
  const cleaned = Array.isArray(records) ? records : [];
  cleaned.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
  writeJson(monthFilePath(monthKey), cleaned);
}

function getMonthKeysForRange(startMs, endMs) {
  const keys = [];
  const start = new Date(Number(startMs || Date.now()));
  const end = new Date(Number(endMs || startMs || Date.now()));

  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  const endYear = end.getUTCFullYear();
  const endMonth = end.getUTCMonth();

  while (year < endYear || (year === endYear && month <= endMonth)) {
    keys.push(`${year}-${String(month + 1).padStart(2, '0')}`);
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  return keys;
}

function normalizeLookup(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[`*_~|]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function cleanValue(value) {
  return String(value || '')
    .replace(/<a?:\w+:\d+>/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/^[-•\s:]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeRole(value) {
  const raw = cleanValue(value);
  const lower = raw.toLowerCase();

  for (const label of JUNIOR_ROLE_LABELS) {
    const labelLower = label.toLowerCase();
    const left = labelLower.split('|')[0].trim();
    if (lower.includes(labelLower) || (lower.includes(left) && lower.includes('helper'))) {
      return label;
    }
  }

  if (lower.includes('front desk')) return 'Front Desk | Helper';
  if (lower.includes('custodian')) return 'Custodian | Helper';
  if (lower.includes('hotel cook') || lower.includes('cook')) return 'Hotel Cook | Helper';
  if (lower.includes('security')) return 'Security | Helper';

  return raw || 'Unknown Junior Staff Role';
}

function flattenMessageText(message) {
  const lines = [];

  if (message.content) lines.push(message.content);

  for (const embed of message.embeds || []) {
    if (embed.title) lines.push(`Title: ${embed.title}`);
    if (embed.description) lines.push(embed.description);
    if (embed.footer?.text) lines.push(`Footer: ${embed.footer.text}`);
    if (embed.author?.name) lines.push(`Author: ${embed.author.name}`);

    for (const field of embed.fields || []) {
      lines.push(`${field.name}: ${field.value}`);
    }
  }

  return lines.join('\n');
}

function getEmbedFieldValue(message, names) {
  const wanted = names.map((n) => String(n).toLowerCase());

  for (const embed of message.embeds || []) {
    for (const field of embed.fields || []) {
      const name = String(field.name || '').toLowerCase();
      if (wanted.some((wantedName) => name.includes(wantedName))) {
        return cleanValue(field.value);
      }
    }
  }

  return null;
}

function firstRegex(text, patterns) {
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (match?.[1]) return cleanValue(match[1]);
  }
  return null;
}

function parseMinutes(value) {
  const text = String(value || '');

  const direct = firstRegex(text, [
    /(?:minutes?|mins?)\s*(?:spent\s*)?(?:in\s*)?(?:the\s*)?(?:tc|training\s*center)\s*[:#\-–]\s*(\d{1,4})/i,
    /(?:time\s*(?:spent)?\s*(?:in)?\s*(?:the)?\s*(?:tc|training\s*center)|tc\s*time|time|minutes?|mins?)\s*[:#\-–]\s*(\d{1,4})/i,
    /(\d{1,4})\s*(?:minutes?|mins?)\b/i,
  ]);

  if (!direct) return 0;
  const n = Number(direct);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function parseRobloxActivityLogMessage(message) {
  if (!message) return null;

  const text = flattenMessageText(message);
  if (!text.trim()) return null;

  const usernameField = getEmbedFieldValue(message, [
    'roblox username',
    'username',
    'user name',
    'player',
    'staff',
  ]);
  const idField = getEmbedFieldValue(message, [
    'roblox id',
    'user id',
    'userid',
    'id',
  ]);
  const roleField = getEmbedFieldValue(message, [
    'role',
    'rank',
    'position',
    'team',
  ]);
  const minutesField = getEmbedFieldValue(message, [
    'minutes',
    'mins',
    'time in tc',
    'tc time',
    'time spent',
  ]);

  const robloxUsername = usernameField || firstRegex(text, [
    /(?:roblox\s*)?username\s*[:#\-–]\s*([^\n|]+)/i,
    /(?:player|staff)\s*[:#\-–]\s*([^\n|]+)/i,
  ]);

  const robloxId = idField || firstRegex(text, [
    /(?:roblox\s*)?(?:user\s*)?id\s*[:#\-–]\s*(\d{3,20})/i,
    /\bRBX\s*ID\s*[:#\-–]\s*(\d{3,20})/i,
  ]);

  const roleRaw = roleField || firstRegex(text, [
    /(?:role|rank|position|team)\s*[:#\-–]\s*([^\n]+)/i,
  ]);

  const minutesInTC = parseMinutes(minutesField || text);
  const role = normalizeRole(roleRaw || text);

  // Junior Staff tracking must stay locked to Tier 0 only.
  // Anything Leadership Intern+ / Management+ should be ignored entirely.
  if (!isJuniorStaffRole(role)) return null;

  const lower = text.toLowerCase();
  const looksTrainingRelated =
    lower.includes('training') ||
    lower.includes('tc') ||
    lower.includes('training center') ||
    lower.includes('helper') ||
    minutesInTC > 0;

  if (!looksTrainingRelated) return null;
  if (!robloxUsername && !robloxId) return null;

  const timestamp = Number(message.createdTimestamp || Date.now());
  const sourceMessageId = String(message.id || `${timestamp}-${robloxId || robloxUsername}`);
  const safeUsername = robloxUsername ? cleanValue(robloxUsername).replace(/^@+/, '') : null;
  const safeId = robloxId ? String(robloxId).replace(/\D/g, '') : null;

  return {
    id: `${sourceMessageId}:${safeId || normalizeLookup(safeUsername)}`,
    sourceMessageId,
    sourceChannelId: message.channelId || null,
    guildId: message.guildId || null,
    robloxUsername: safeUsername || 'Unknown',
    robloxId: safeId || null,
    role,
    minutesInTC,
    sessionType: 'training',
    timestamp,
    createdAt: new Date(timestamp).toISOString(),
  };
}

function upsertRecord(record) {
  if (!record || (!record.robloxId && !record.robloxUsername)) return false;
  if (!isJuniorStaffRecord(record)) return false;

  const monthKey = monthKeyFromTimestamp(record.timestamp);
  const records = readMonth(monthKey);

  const existingIndex = records.findIndex((entry) => {
    if (entry.id && record.id && entry.id === record.id) return true;
    if (entry.sourceMessageId && record.sourceMessageId && entry.sourceMessageId === record.sourceMessageId) {
      if (record.robloxId && entry.robloxId === record.robloxId) return true;
      if (!record.robloxId && normalizeLookup(entry.robloxUsername) === normalizeLookup(record.robloxUsername)) return true;
    }
    return false;
  });

  if (existingIndex >= 0) {
    records[existingIndex] = {
      ...records[existingIndex],
      ...record,
      updatedAt: new Date().toISOString(),
    };
  } else {
    records.push({
      ...record,
      savedAt: new Date().toISOString(),
    });
  }

  writeMonth(monthKey, records);
  return existingIndex < 0;
}

async function resolveJuniorLogChannel(client, guild = null) {
  if (!client) return null;

  const configuredId = JUNIOR_ACTIVITY_LOG_CHANNEL_ID || readMeta().knownLogChannelId || null;
  if (configuredId) {
    const channel = await client.channels.fetch(configuredId).catch(() => null);
    if (channel?.isTextBased?.()) return channel;
  }

  const guilds = [];
  if (guild) guilds.push(guild);
  else if (client.guilds?.cache) guilds.push(...client.guilds.cache.values());

  for (const g of guilds) {
    const channels = g.channels?.cache;
    if (!channels) continue;

    const found = channels.find((channel) => {
      const name = String(channel.name || '').toLowerCase();
      return channel.isTextBased?.() && FALLBACK_CHANNEL_NAMES.includes(name);
    });

    if (found) {
      const meta = readMeta();
      meta.knownLogChannelId = found.id;
      writeMeta(meta);
      return found;
    }
  }

  return null;
}

async function backfillJuniorActivityFromLogChannel(client, options = {}) {
  const { guild = null, limit = Number(process.env.JUNIOR_ACTIVITY_BACKFILL_LIMIT || 1000) } = options;
  const channel = await resolveJuniorLogChannel(client, guild);
  if (!channel) {
    return { ok: false, reason: 'missing_log_channel', added: 0, updated: 0, scanned: 0 };
  }

  let before;
  let scanned = 0;
  let added = 0;
  let updated = 0;
  const maxToScan = Math.max(100, Math.min(Number(limit || 1000), 5000));

  while (scanned < maxToScan) {
    const remaining = maxToScan - scanned;
    const batch = await channel.messages
      .fetch({ limit: Math.min(100, remaining), before })
      .catch((err) => {
        console.error('[JUNIOR ACTIVITY] Failed to fetch log messages:', err);
        return null;
      });

    if (!batch || batch.size === 0) break;

    for (const message of batch.values()) {
      scanned += 1;
      const record = parseRobloxActivityLogMessage(message);
      if (!record) continue;
      const wasAdded = upsertRecord(record);
      if (wasAdded) added += 1;
      else updated += 1;
    }

    before = batch.last()?.id;
    if (!before) break;
  }

  const meta = readMeta();
  meta.lastBackfillAt = Date.now();
  meta.knownLogChannelId = channel.id;
  writeMeta(meta);

  return { ok: true, channelId: channel.id, added, updated, scanned };
}

async function handleJuniorActivityLogMessage(message) {
  if (!message?.guild || !message.channelId) return false;

  const channel = await resolveJuniorLogChannel(message.client, message.guild).catch(() => null);
  if (!channel || channel.id !== message.channelId) return false;

  const record = parseRobloxActivityLogMessage(message);
  if (!record) return false;

  upsertRecord(record);

  const meta = readMeta();
  meta.lastLiveRecordAt = Date.now();
  meta.knownLogChannelId = channel.id;
  writeMeta(meta);

  return true;
}

function getRecordsForPlayer(playerQuery, range = null) {
  const query = String(playerQuery || '').trim();
  const numericQuery = query.replace(/\D/g, '');
  const normalizedQuery = normalizeLookup(query);

  const startMs = range?.startMs ?? 0;
  const endMs = range?.endMs ?? Date.now();
  const monthKeys = getMonthKeysForRange(startMs, endMs);
  const results = [];

  for (const monthKey of monthKeys) {
    const records = readMonth(monthKey);
    for (const record of records) {
      if (!isJuniorStaffRecord(record)) continue;

      const ts = Number(record.timestamp || 0);
      if (ts < startMs || ts > endMs) continue;

      const idMatch = numericQuery && String(record.robloxId || '') === numericQuery;
      const usernameMatch = normalizedQuery && normalizeLookup(record.robloxUsername) === normalizedQuery;
      const looseUsernameMatch =
        normalizedQuery && normalizeLookup(record.robloxUsername).includes(normalizedQuery);

      if (idMatch || usernameMatch || looseUsernameMatch) results.push(record);
    }
  }

  results.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  return results;
}

function getKnownPlayerProfile(playerQuery) {
  const query = String(playerQuery || '').trim();
  const numericQuery = query.replace(/\D/g, '');
  const normalizedQuery = normalizeLookup(query);
  const files = fs.existsSync(DATA_DIR)
    ? fs.readdirSync(DATA_DIR).filter((name) => /^\d{4}-\d{2}\.json$/.test(name)).sort().reverse()
    : [];

  for (const file of files) {
    const records = readJson(path.join(DATA_DIR, file), []);
    if (!Array.isArray(records)) continue;

    for (const record of [...records].reverse()) {
      if (!isJuniorStaffRecord(record)) continue;

      const idMatch = numericQuery && String(record.robloxId || '') === numericQuery;
      const usernameMatch = normalizedQuery && normalizeLookup(record.robloxUsername) === normalizedQuery;
      const looseUsernameMatch =
        normalizedQuery && normalizeLookup(record.robloxUsername).includes(normalizedQuery);

      if (idMatch || usernameMatch || looseUsernameMatch) {
        return {
          robloxUsername: record.robloxUsername || query,
          robloxId: record.robloxId || null,
          role: record.role || 'Unknown Junior Staff Role',
        };
      }
    }
  }

  return null;
}

function summarizeJuniorRecords(records) {
  const summary = {
    totalTrainings: records.length,
    totalMinutes: 0,
    averageMinutes: 0,
    roles: {},
    latestRole: 'Unknown Junior Staff Role',
    latestRecord: null,
  };

  for (const record of records) {
    const minutes = Number(record.minutesInTC || 0);
    summary.totalMinutes += Number.isFinite(minutes) ? minutes : 0;

    const role = record.role || 'Unknown Junior Staff Role';
    summary.roles[role] = (summary.roles[role] || 0) + 1;

    if (!summary.latestRecord || Number(record.timestamp || 0) > Number(summary.latestRecord.timestamp || 0)) {
      summary.latestRecord = record;
      summary.latestRole = role;
    }
  }

  summary.averageMinutes = summary.totalTrainings > 0
    ? Math.round(summary.totalMinutes / summary.totalTrainings)
    : 0;

  return summary;
}

function getWeeklyConsistency(playerQuery, weeks = 4, getWeekRangeForOffset) {
  const windows = [];
  const count = Math.max(1, Number(weeks || 4));

  for (let i = 0; i < count; i += 1) {
    const range = getWeekRangeForOffset ? getWeekRangeForOffset(-i) : null;
    if (!range) continue;
    const records = getRecordsForPlayer(playerQuery, range);
    const summary = summarizeJuniorRecords(records);
    windows.push({
      offset: i,
      range,
      records,
      trainings: summary.totalTrainings,
      minutes: summary.totalMinutes,
      metTwoTrainingStandard: summary.totalTrainings >= 2,
    });
  }

  return windows;
}

function getPromotionDecision(consistencyWindows) {
  const windows = Array.isArray(consistencyWindows) ? consistencyWindows : [];
  const successfulWeeks = windows.filter((w) => w.metTwoTrainingStandard).length;
  const totalTrainings = windows.reduce((sum, w) => sum + Number(w.trainings || 0), 0);
  const totalMinutes = windows.reduce((sum, w) => sum + Number(w.minutes || 0), 0);

  if (!windows.length || totalTrainings === 0) {
    return {
      status: 'Needs Improvement',
      emoji: '🔴',
      reason: 'No tracked training activity was found yet.',
      successfulWeeks,
      totalTrainings,
      totalMinutes,
    };
  }

  if (successfulWeeks >= 4) {
    return {
      status: 'Promotion Ready',
      emoji: '🟢',
      reason: 'They reached at least 2 trainings every week across the review window.',
      successfulWeeks,
      totalTrainings,
      totalMinutes,
    };
  }

  if (successfulWeeks >= 2) {
    return {
      status: 'Needs Time',
      emoji: '🟡',
      reason: 'They are showing activity, but it is not fully consistent yet.',
      successfulWeeks,
      totalTrainings,
      totalMinutes,
    };
  }

  return {
    status: 'Needs Improvement',
    emoji: '🔴',
    reason: 'They are not consistently reaching 2 trainings per week yet.',
    successfulWeeks,
    totalTrainings,
    totalMinutes,
  };
}

function formatMinutes(minutes) {
  const n = Math.max(0, Math.round(Number(minutes || 0)));
  if (n < 60) return `${n} min`;
  const hours = Math.floor(n / 60);
  const mins = n % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

module.exports = {
  DATA_DIR,
  META_PATH,
  TIME_ZONE,
  JUNIOR_ACTIVITY_LOG_CHANNEL_ID,
  JUNIOR_ROLE_LABELS,
  CURRENT_JUNIOR_STAFF_MESSAGE,
  isJuniorStaffRole,
  isJuniorStaffRecord,
  parseRobloxActivityLogMessage,
  backfillJuniorActivityFromLogChannel,
  handleJuniorActivityLogMessage,
  getRecordsForPlayer,
  getKnownPlayerProfile,
  summarizeJuniorRecords,
  getWeeklyConsistency,
  getPromotionDecision,
  formatMinutes,
};
