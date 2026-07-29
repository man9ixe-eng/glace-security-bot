'use strict';

const crypto = require('node:crypto');
const { resolveDataPath, readJsonFile, atomicWriteJson } = require('./dataPaths');

const STORE_PATH = resolveDataPath('staffRequests.json', process.env.STAFF_REQUEST_STORE_PATH);
const EMPTY = { schemaVersion: 1, counters: {}, requests: [], audit: [], profiles: {} };
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_KEY);
const REQUEST_TABLE = 'glace_staff_requests';
const AUDIT_TABLE = 'glace_staff_request_audit';
const PROFILE_TABLE = 'glace_staff_profiles';

function nowIso() { return new Date().toISOString(); }
function clean(value, max = 4000) { return String(value ?? '').trim().slice(0, max); }
function makeId(prefix) { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`; }
function actorData(actor) {
  return { id: clean(actor?.id, 40), tag: clean(actor?.tag || actor?.username || actor?.displayName, 100) };
}
function normalizeLocal(input) {
  const raw = input && typeof input === 'object' ? input : {};
  return {
    schemaVersion: 1,
    counters: raw.counters && typeof raw.counters === 'object' ? raw.counters : {},
    requests: Array.isArray(raw.requests) ? raw.requests : [],
    audit: Array.isArray(raw.audit) ? raw.audit : [],
    profiles: raw.profiles && typeof raw.profiles === 'object' ? raw.profiles : {},
  };
}
function readLocal() { return normalizeLocal(readJsonFile(STORE_PATH, EMPTY)); }
function writeLocal(store) { atomicWriteJson(STORE_PATH, normalizeLocal(store)); }
function nextLocalNumber(store) {
  const year = new Date().getUTCFullYear();
  const key = String(year);
  store.counters[key] = Number(store.counters[key] || 0) + 1;
  return `GH-REQ-${year}-${String(store.counters[key]).padStart(4, '0')}`;
}
function addLocalAudit(store, action, actor, request, details = {}) {
  const a = actorData(actor);
  store.audit.unshift({
    id: makeId('reqaudit'), action, actorId: a.id, actorTag: a.tag,
    requestId: request?.id || null, requestNumber: request?.requestNumber || null,
    guildId: request?.guildId || null, details, createdAt: nowIso(),
  });
  store.audit = store.audit.slice(0, 5000);
}
function supabaseHeaders(prefer = null) {
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  return headers;
}
async function supabaseRequest(method, route, { params, data, prefer } = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${route}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      method: String(method || 'get').toUpperCase(),
      headers: supabaseHeaders(prefer),
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed = null;
    if (text) { try { parsed = JSON.parse(text); } catch { parsed = text; } }
    if (!response.ok) {
      const detail = parsed?.message || parsed?.hint || parsed?.details || `${response.status} ${response.statusText}`;
      throw new Error(detail);
    }
    return parsed;
  } catch (error) {
    const detail = error?.name === 'AbortError' ? 'Supabase request timed out.' : (error?.message || 'Unknown Supabase error');
    throw new Error(`Staff request database error: ${detail}`);
  } finally { clearTimeout(timer); }
}
function payload(row) { return row?.payload && typeof row.payload === 'object' ? row.payload : null; }
async function nextRemoteNumber() {
  const result = await supabaseRequest('post', 'rpc/next_glace_staff_request_number', { data: {} });
  if (typeof result === 'string' && result.trim()) return result.trim();
  if (Array.isArray(result) && result[0]) return String(result[0]);
  throw new Error('Staff request database did not return a request number. Run the included v2.6 Supabase SQL.');
}
async function insertRemote(entry) {
  const rows = await supabaseRequest('post', REQUEST_TABLE, {
    data: {
      id: entry.id, guild_id: entry.guildId, request_number: entry.requestNumber,
      requester_id: entry.requesterId, request_type: entry.type, status: entry.status,
      payload: entry, created_at: entry.createdAt, updated_at: entry.updatedAt,
    },
    prefer: 'return=representation',
  });
  return payload(Array.isArray(rows) ? rows[0] : rows) || entry;
}
async function saveRemote(entry) {
  const rows = await supabaseRequest('patch', REQUEST_TABLE, {
    params: { id: `eq.${entry.id}`, select: '*' },
    data: { status: entry.status, payload: entry, updated_at: entry.updatedAt || nowIso() },
    prefer: 'return=representation',
  });
  return payload(Array.isArray(rows) ? rows[0] : rows) || entry;
}
async function addRemoteAudit(action, actor, request, details = {}) {
  const a = actorData(actor);
  const entry = {
    id: makeId('reqaudit'), action, actorId: a.id, actorTag: a.tag,
    requestId: request?.id || null, requestNumber: request?.requestNumber || null,
    guildId: request?.guildId || null, details, createdAt: nowIso(),
  };
  await supabaseRequest('post', AUDIT_TABLE, {
    data: {
      id: entry.id, guild_id: entry.guildId, request_id: entry.requestId,
      request_number: entry.requestNumber, payload: entry, created_at: entry.createdAt,
    },
    prefer: 'return=minimal',
  });
  return entry;
}

async function list({ guildId = null, requesterId = null, statuses = null, limit = 500 } = {}) {
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 500));
  if (!USE_SUPABASE) {
    return readLocal().requests
      .filter((x) => !guildId || String(x.guildId) === String(guildId))
      .filter((x) => !requesterId || String(x.requesterId) === String(requesterId))
      .filter((x) => !Array.isArray(statuses) || statuses.includes(x.status))
      .slice(0, safeLimit);
  }
  const params = { select: '*', order: 'updated_at.desc', limit: safeLimit };
  if (guildId) params.guild_id = `eq.${guildId}`;
  if (requesterId) params.requester_id = `eq.${requesterId}`;
  if (Array.isArray(statuses) && statuses.length) params.status = `in.(${statuses.map((x) => `"${clean(x, 50)}"`).join(',')})`;
  const rows = await supabaseRequest('get', REQUEST_TABLE, { params });
  return (Array.isArray(rows) ? rows : []).map(payload).filter(Boolean);
}
async function get(requestId, guildId = null) {
  const key = clean(requestId, 100);
  if (!USE_SUPABASE) {
    return readLocal().requests.find((x) =>
      (x.id === key || x.requestNumber === key) && (!guildId || String(x.guildId) === String(guildId))) || null;
  }
  const params = { select: '*', or: `(id.eq.${key},request_number.eq.${key})`, limit: 1 };
  if (guildId) params.guild_id = `eq.${guildId}`;
  const rows = await supabaseRequest('get', REQUEST_TABLE, { params });
  return payload(Array.isArray(rows) ? rows[0] : null);
}
async function create(input, actor) {
  const a = actorData(actor);
  const when = nowIso();
  let local = null;
  const requestNumber = USE_SUPABASE ? await nextRemoteNumber() : (() => { local = readLocal(); return nextLocalNumber(local); })();
  const entry = {
    id: makeId('staffreq'), requestNumber,
    guildId: clean(input.guildId, 40),
    type: clean(input.type, 50),
    requesterId: clean(input.requesterId || a.id, 40),
    requesterTag: clean(input.requesterTag || a.tag, 100),
    requesterTier: Number(input.requesterTier) || 3,
    requesterTierLabel: clean(input.requesterTierLabel, 100),
    status: clean(input.status, 50) || 'pending_corporate',
    requestData: input.requestData && typeof input.requestData === 'object' ? input.requestData : {},
    submittedAt: when, createdAt: when, updatedAt: when,
    reviewedById: null, reviewedByTag: null, reviewedAt: null, decisionNote: null,
    reviewChannelId: null, reviewMessageId: null,
    appliedAt: null, appliedResult: null,
  };
  if (USE_SUPABASE) {
    await insertRemote(entry);
    await addRemoteAudit('staff_request_submitted', actor, entry, { type: entry.type, status: entry.status });
  } else {
    local.requests.unshift(entry);
    addLocalAudit(local, 'staff_request_submitted', actor, entry, { type: entry.type, status: entry.status });
    writeLocal(local);
  }
  return entry;
}
async function mutate(requestId, actor, action, mutator, detailsFactory = () => ({})) {
  if (USE_SUPABASE) {
    const entry = await get(requestId);
    if (!entry) return null;
    mutator(entry);
    entry.updatedAt = entry.updatedAt || nowIso();
    await saveRemote(entry);
    await addRemoteAudit(action, actor, entry, detailsFactory(entry));
    return entry;
  }
  const store = readLocal();
  const entry = store.requests.find((x) => x.id === requestId || x.requestNumber === requestId);
  if (!entry) return null;
  mutator(entry);
  entry.updatedAt = entry.updatedAt || nowIso();
  addLocalAudit(store, action, actor, entry, detailsFactory(entry));
  writeLocal(store);
  return entry;
}
async function setReviewMessage(requestId, channelId, messageId) {
  return mutate(requestId, { id: 'system', tag: 'Glace Request Router' }, 'staff_request_routed', (entry) => {
    entry.reviewChannelId = clean(channelId, 40);
    entry.reviewMessageId = clean(messageId, 40);
    entry.updatedAt = nowIso();
  }, () => ({ channelId: clean(channelId, 40), messageId: clean(messageId, 40) }));
}
async function decide(requestId, decision, note, actor, appliedResult = null) {
  const safeDecision = clean(decision, 30);
  const safeNote = clean(note, 3000);
  return mutate(requestId, actor, `staff_request_${safeDecision}`, (entry) => {
    if (!['pending_corporate', 'pending_presidential', 'returned'].includes(entry.status)) {
      throw new Error('This request is no longer awaiting review.');
    }
    const a = actorData(actor);
    const when = nowIso();
    if (safeDecision === 'approve') entry.status = 'approved';
    else if (safeDecision === 'return') entry.status = 'returned';
    else if (safeDecision === 'deny') entry.status = 'denied';
    else throw new Error('Invalid staff request decision.');
    entry.reviewedById = a.id; entry.reviewedByTag = a.tag; entry.reviewedAt = when;
    entry.decisionNote = safeNote; entry.updatedAt = when;
    if (safeDecision === 'approve') {
      entry.appliedAt = when;
      entry.appliedResult = appliedResult && typeof appliedResult === 'object' ? appliedResult : null;
    }
  }, () => ({ note: safeNote, appliedResult }));
}
async function resubmit(requestId, requestData, actor, nextStatus) {
  return mutate(requestId, actor, 'staff_request_resubmitted', (entry) => {
    if (entry.status !== 'returned') throw new Error('Only returned requests can be resubmitted.');
    if (String(entry.requesterId) !== String(actor?.id)) throw new Error('Only the original requester can resubmit this request.');
    entry.requestData = requestData && typeof requestData === 'object' ? requestData : entry.requestData;
    entry.status = clean(nextStatus, 50) || (entry.requesterTier >= 6 ? 'pending_presidential' : 'pending_corporate');
    entry.reviewedById = null; entry.reviewedByTag = null; entry.reviewedAt = null; entry.decisionNote = null;
    entry.updatedAt = nowIso();
  });
}
async function listAudit({ guildId = null, limit = 250 } = {}) {
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 250));
  if (!USE_SUPABASE) return readLocal().audit.filter((x) => !guildId || String(x.guildId) === String(guildId)).slice(0, safeLimit);
  const params = { select: '*', order: 'created_at.desc', limit: safeLimit };
  if (guildId) params.guild_id = `eq.${guildId}`;
  const rows = await supabaseRequest('get', AUDIT_TABLE, { params });
  return (Array.isArray(rows) ? rows : []).map((row) => row.payload).filter(Boolean);
}
async function upsertProfile(guildId, userId, changes, actor = null) {
  const key = `${clean(guildId, 40)}:${clean(userId, 40)}`;
  const when = nowIso();
  const profile = { guildId: clean(guildId, 40), userId: clean(userId, 40), ...(changes || {}), updatedAt: when, updatedById: clean(actor?.id, 40), updatedByTag: clean(actor?.tag, 100) };
  if (!USE_SUPABASE) {
    const store = readLocal();
    store.profiles[key] = { ...(store.profiles[key] || {}), ...profile };
    writeLocal(store);
    return store.profiles[key];
  }
  const rows = await supabaseRequest('post', PROFILE_TABLE, {
    data: { guild_id: profile.guildId, user_id: profile.userId, payload: profile, updated_at: when },
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  return payload(Array.isArray(rows) ? rows[0] : rows) || profile;
}
async function listProfiles(guildId) {
  if (!USE_SUPABASE) {
    return Object.values(readLocal().profiles).filter((x) => !guildId || String(x.guildId) === String(guildId));
  }
  const params = { select: '*', order: 'updated_at.desc', limit: 1000 };
  if (guildId) params.guild_id = `eq.${guildId}`;
  const rows = await supabaseRequest('get', PROFILE_TABLE, { params });
  return (Array.isArray(rows) ? rows : []).map(payload).filter(Boolean);
}
function storageMode() { return USE_SUPABASE ? 'supabase' : 'local-json'; }

module.exports = {
  STORE_PATH, list, get, create, setReviewMessage, decide, resubmit, listAudit,
  upsertProfile, listProfiles, storageMode, isSupabaseEnabled: () => USE_SUPABASE,
};
