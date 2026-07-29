'use strict';

const crypto = require('node:crypto');
const { resolveDataPath, readJsonFile, atomicWriteJson } = require('./dataPaths');
const { TIERS } = require('../config/access');

const STORE_PATH = resolveDataPath('promotionSubmissions.json', process.env.PROMOTION_STORE_PATH);
const EMPTY = { schemaVersion: 2, counters: {}, submissions: [], audit: [] };
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_KEY);
const SUBMISSION_TABLE = 'glace_promotion_submissions';
const AUDIT_TABLE = 'glace_promotion_audit';

function nowIso() { return new Date().toISOString(); }
function clean(value, max = 4000) { return String(value ?? '').trim().slice(0, max); }
function id(prefix) { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`; }
function actorData(actor) {
  return { id: clean(actor?.id, 40), tag: clean(actor?.tag || actor?.username || actor?.displayName, 100) };
}
function completionDeadline() {
  return new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
}

function readLocal() {
  const raw = readJsonFile(STORE_PATH, EMPTY);
  return {
    schemaVersion: 2,
    counters: raw?.counters && typeof raw.counters === 'object' ? raw.counters : {},
    submissions: Array.isArray(raw?.submissions) ? raw.submissions : [],
    audit: Array.isArray(raw?.audit) ? raw.audit : [],
  };
}
function writeLocal(store) { atomicWriteJson(STORE_PATH, store); }
function nextLocalNumber(store) {
  const year = new Date().getUTCFullYear();
  const key = String(year);
  store.counters[key] = Number(store.counters[key] || 0) + 1;
  return `GH-PR-${year}-${String(store.counters[key]).padStart(4, '0')}`;
}
function addLocalAudit(store, action, actor, submission, details = {}) {
  const a = actorData(actor);
  store.audit.unshift({
    id: id('paudit'), action, actorId: a.id, actorTag: a.tag,
    submissionId: submission?.id || null,
    submissionNumber: submission?.submissionNumber || null,
    guildId: submission?.guildId || null,
    details, createdAt: nowIso(),
  });
  store.audit = store.audit.slice(0, 5000);
}

function supabaseHeaders(prefer = null) {
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
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
    if (text) {
      try { parsed = JSON.parse(text); } catch { parsed = text; }
    }
    if (!response.ok) {
      const detail = parsed?.message || parsed?.hint || parsed?.details || `${response.status} ${response.statusText}`;
      throw new Error(detail);
    }
    return parsed;
  } catch (error) {
    const detail = error?.name === 'AbortError' ? 'Supabase request timed out.' : (error?.message || 'Unknown Supabase error');
    throw new Error(`Promotion database error: ${detail}`);
  } finally {
    clearTimeout(timer);
  }
}

function fromRemote(row) {
  if (!row) return null;
  return row.payload && typeof row.payload === 'object' ? row.payload : null;
}
async function nextRemoteNumber() {
  const result = await supabaseRequest('post', 'rpc/next_glace_promotion_number', { data: {} });
  if (typeof result === 'string' && result.trim()) return result.trim();
  if (Array.isArray(result) && result[0]) return String(result[0]);
  throw new Error('Promotion database did not return a submission number. Run the included Supabase SQL setup.');
}
async function insertRemoteEntry(entry) {
  const rows = await supabaseRequest('post', SUBMISSION_TABLE, {
    data: {
      id: entry.id,
      guild_id: entry.guildId,
      submission_number: entry.submissionNumber,
      payload: entry,
      created_at: entry.createdAt,
      updated_at: entry.updatedAt,
    },
    prefer: 'return=representation',
  });
  return fromRemote(Array.isArray(rows) ? rows[0] : rows) || entry;
}
async function saveRemoteEntry(entry) {
  const rows = await supabaseRequest('patch', SUBMISSION_TABLE, {
    params: { id: `eq.${entry.id}`, select: '*' },
    data: { payload: entry, updated_at: entry.updatedAt || nowIso() },
    prefer: 'return=representation',
  });
  return fromRemote(Array.isArray(rows) ? rows[0] : rows) || entry;
}
async function addRemoteAudit(action, actor, submission, details = {}) {
  const a = actorData(actor);
  const audit = {
    id: id('paudit'), action, actorId: a.id, actorTag: a.tag,
    submissionId: submission?.id || null,
    submissionNumber: submission?.submissionNumber || null,
    guildId: submission?.guildId || null,
    details, createdAt: nowIso(),
  };
  await supabaseRequest('post', AUDIT_TABLE, {
    data: {
      id: audit.id,
      guild_id: audit.guildId,
      submission_id: audit.submissionId,
      submission_number: audit.submissionNumber,
      payload: audit,
      created_at: audit.createdAt,
    },
    prefer: 'return=minimal',
  });
  return audit;
}

async function list({ guildId, limit = 500 } = {}) {
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 500));
  if (!USE_SUPABASE) {
    return readLocal().submissions
      .filter((x) => !guildId || String(x.guildId) === String(guildId))
      .slice(0, safeLimit);
  }
  const params = { select: '*', order: 'updated_at.desc', limit: safeLimit };
  if (guildId) params.guild_id = `eq.${guildId}`;
  const rows = await supabaseRequest('get', SUBMISSION_TABLE, { params });
  return (Array.isArray(rows) ? rows : []).map(fromRemote).filter(Boolean);
}

async function get(submissionId, guildId = null) {
  const key = clean(submissionId, 100);
  if (!USE_SUPABASE) {
    return readLocal().submissions.find((x) =>
      (x.id === key || x.submissionNumber === key) &&
      (!guildId || String(x.guildId) === String(guildId))
    ) || null;
  }
  const params = {
    select: '*',
    or: `(id.eq.${key},submission_number.eq.${key})`,
    limit: 1,
  };
  if (guildId) params.guild_id = `eq.${guildId}`;
  const rows = await supabaseRequest('get', SUBMISSION_TABLE, { params });
  return fromRemote(Array.isArray(rows) ? rows[0] : null);
}

async function create(input, actor) {
  const when = nowIso();
  const a = actorData(actor);
  let submissionNumber;
  let localStore = null;
  if (USE_SUPABASE) submissionNumber = await nextRemoteNumber();
  else {
    localStore = readLocal();
    submissionNumber = nextLocalNumber(localStore);
  }
  const proposedTier = Math.max(TIERS.INTERN, Math.min(TIERS.PRESIDENTIAL, Number(input.proposedTier) || TIERS.MANAGEMENT));
  const entry = {
    id: id('promotion'), submissionNumber, guildId: clean(input.guildId, 40),
    candidateId: clean(input.candidateId, 40), candidateUsername: clean(input.candidateUsername, 100),
    currentRank: clean(input.currentRank, 100), proposedRank: clean(input.proposedRank, 100), proposedTier,
    reason: clean(input.reason, 5000), evidence: clean(input.evidence, 5000),
    strengths: clean(input.strengths, 3000), concerns: clean(input.concerns, 3000),
    diligenceConfirmed: Boolean(input.diligenceConfirmed),
    status: 'board_review',
    submittedById: a.id, submittedByTag: a.tag, assignedCompletionId: a.id, assignedCompletionTag: a.tag,
    submittedAt: when, createdAt: when, updatedAt: when,
    boardDecision: null, boardDecisionById: null, boardDecisionByTag: null, boardDecisionReason: null, boardDecidedAt: null,
    presidentialApprovals: [], presidentialDecisionReason: null,
    overrideUsed: false, overrideById: null, overrideByTag: null, overrideReason: null, overrideAt: null,
    approvedAt: null, completionDeadline: null,
    completedById: null, completedByTag: null, completedAt: null,
    discordVerified: false, verifiedTier: null, announcementMessageId: null,
    returnStage: null,
  };
  if (USE_SUPABASE) {
    await insertRemoteEntry(entry);
    await addRemoteAudit('promotion_submitted', actor, entry, { candidateId: entry.candidateId, proposedRank: entry.proposedRank });
  } else {
    localStore.submissions.unshift(entry);
    addLocalAudit(localStore, 'promotion_submitted', actor, entry, { candidateId: entry.candidateId, proposedRank: entry.proposedRank });
    writeLocal(localStore);
  }
  return entry;
}

async function mutate(submissionId, actor, action, mutateEntry, detailsFactory = () => ({})) {
  if (USE_SUPABASE) {
    const entry = await get(submissionId);
    if (!entry) return null;
    mutateEntry(entry);
    entry.updatedAt = entry.updatedAt || nowIso();
    await saveRemoteEntry(entry);
    await addRemoteAudit(action, actor, entry, detailsFactory(entry));
    return entry;
  }
  const store = readLocal();
  const entry = store.submissions.find((x) => x.id === submissionId || x.submissionNumber === submissionId);
  if (!entry) return null;
  mutateEntry(entry);
  entry.updatedAt = entry.updatedAt || nowIso();
  addLocalAudit(store, action, actor, entry, detailsFactory(entry));
  writeLocal(store);
  return entry;
}

async function boardDecision(submissionId, decision, reason, actor) {
  const note = clean(reason, 3000);
  return mutate(submissionId, actor, `promotion_board_${decision}`, (entry) => {
    if (!['board_review', 'returned_to_corporate'].includes(entry.status)) throw new Error('This submission is not awaiting Corporate Board review.');
    const a = actorData(actor); const when = nowIso();
    entry.boardDecision = decision; entry.boardDecisionById = a.id; entry.boardDecisionByTag = a.tag;
    entry.boardDecisionReason = note; entry.boardDecidedAt = when; entry.updatedAt = when;
    if (decision === 'approve') entry.status = 'presidential_review';
    else if (decision === 'return') { entry.status = 'returned_to_corporate'; entry.returnStage = 'board'; }
    else if (decision === 'deny') entry.status = 'denied';
    else throw new Error('Invalid Board decision.');
  }, () => ({ reason: note }));
}

async function resubmit(submissionId, changes, actor) {
  return mutate(submissionId, actor, 'promotion_resubmitted', (entry) => {
    if (entry.status !== 'returned_to_corporate') throw new Error('Only returned submissions can be resubmitted.');
    if (String(entry.submittedById) !== String(actor?.id)) throw new Error('Only the original Corporate submitter can resubmit this promotion.');
    for (const field of ['reason', 'evidence', 'strengths', 'concerns']) {
      if (field in changes) entry[field] = clean(changes[field], 5000);
    }
    entry.diligenceConfirmed = Boolean(changes.diligenceConfirmed ?? entry.diligenceConfirmed);
    entry.status = entry.returnStage === 'presidential' ? 'presidential_review' : 'board_review';
    entry.returnStage = null; entry.updatedAt = nowIso();
  });
}

async function presidentialDecision(submissionId, decision, reason, actor) {
  const note = clean(reason, 3000);
  return mutate(submissionId, actor, `promotion_presidential_${decision}`, (entry) => {
    if (entry.status !== 'presidential_review') throw new Error('This submission is not awaiting Presidential review.');
    const a = actorData(actor); const when = nowIso();
    if (decision === 'approve') {
      if (entry.presidentialApprovals.some((x) => String(x.id) === a.id)) throw new Error('You already approved this submission.');
      entry.presidentialApprovals.push({ id: a.id, tag: a.tag, at: when });
      const required = entry.proposedTier >= TIERS.CORPORATE_BOARD ? 2 : 1;
      if (entry.presidentialApprovals.length >= required) {
        entry.status = 'approved_awaiting_completion'; entry.approvedAt = when; entry.completionDeadline = completionDeadline();
      }
    } else if (decision === 'return') {
      entry.status = 'returned_to_corporate'; entry.returnStage = 'presidential'; entry.presidentialDecisionReason = note;
    } else if (decision === 'deny') {
      entry.status = 'denied'; entry.presidentialDecisionReason = note;
    } else throw new Error('Invalid Presidential decision.');
    entry.updatedAt = when;
  }, () => ({ reason: note }));
}

async function presidentialOverride(submissionId, reason, actor) {
  const note = clean(reason, 3000);
  return mutate(submissionId, actor, 'promotion_presidential_override', (entry) => {
    if (!['board_review', 'returned_to_corporate'].includes(entry.status)) {
      throw new Error('Presidential override is only available while a submission is awaiting or returned from Board review.');
    }
    const a = actorData(actor); const when = nowIso();
    entry.overrideUsed = true; entry.overrideById = a.id; entry.overrideByTag = a.tag; entry.overrideReason = note; entry.overrideAt = when;
    entry.boardDecision = 'overridden'; entry.boardDecisionById = a.id; entry.boardDecisionByTag = `${a.tag} (Presidential Override)`;
    entry.boardDecisionReason = note; entry.boardDecidedAt = when; entry.returnStage = null;
    if (!entry.presidentialApprovals.some((x) => String(x.id) === a.id)) {
      entry.presidentialApprovals.push({ id: a.id, tag: a.tag, at: when, override: true });
    }
    const required = entry.proposedTier >= TIERS.CORPORATE_BOARD ? 2 : 1;
    if (entry.presidentialApprovals.length >= required) {
      entry.status = 'approved_awaiting_completion'; entry.approvedAt = when; entry.completionDeadline = completionDeadline();
    } else {
      entry.status = 'presidential_review';
      entry.presidentialDecisionReason = 'Presidential override used; a second Presidential approval is still required for this high-level promotion.';
    }
    entry.updatedAt = when;
  }, () => ({ reason: note, skippedBoardReview: true }));
}

async function reassign(submissionId, assignee, reason, actor) {
  const note = clean(reason, 1000);
  return mutate(submissionId, actor, 'promotion_completion_reassigned', (entry) => {
    entry.assignedCompletionId = clean(assignee?.id, 40);
    entry.assignedCompletionTag = clean(assignee?.tag, 100);
    entry.updatedAt = nowIso();
  }, (entry) => ({ assigneeId: entry.assignedCompletionId, reason: note }));
}

async function complete(submissionId, verification, actor) {
  return mutate(submissionId, actor, 'promotion_completed', (entry) => {
    if (entry.status !== 'approved_awaiting_completion') throw new Error('This promotion is not awaiting completion.');
    if (String(entry.assignedCompletionId) !== String(actor?.id)) throw new Error('This promotion is assigned to a different Corporate member.');
    if (!verification?.discordVerified) throw new Error('The candidate’s Discord rank could not be verified.');
    const a = actorData(actor); const when = nowIso();
    entry.status = 'completed'; entry.completedById = a.id; entry.completedByTag = a.tag; entry.completedAt = when;
    entry.discordVerified = true; entry.verifiedTier = Number(verification.verifiedTier) || null; entry.updatedAt = when;
  }, (entry) => ({ verifiedTier: entry.verifiedTier }));
}

async function setAnnouncementMessage(submissionId, messageId) {
  return mutate(submissionId, { id: 'system', tag: 'Glace Portal' }, 'promotion_announcement_linked', (entry) => {
    entry.announcementMessageId = clean(messageId, 40); entry.updatedAt = nowIso();
  }, () => ({ messageId: clean(messageId, 40) }));
}

async function listAudit({ limit = 250, guildId = null } = {}) {
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 250));
  if (!USE_SUPABASE) {
    return readLocal().audit
      .filter((x) => !guildId || String(x.guildId || '') === String(guildId))
      .slice(0, safeLimit);
  }
  const params = { select: '*', order: 'created_at.desc', limit: safeLimit };
  if (guildId) params.guild_id = `eq.${guildId}`;
  const rows = await supabaseRequest('get', AUDIT_TABLE, { params });
  return (Array.isArray(rows) ? rows : []).map((row) => row.payload).filter(Boolean);
}

function storageMode() { return USE_SUPABASE ? 'supabase' : 'local-json'; }
function isSupabaseEnabled() { return USE_SUPABASE; }

module.exports = {
  STORE_PATH,
  list,
  get,
  create,
  boardDecision,
  resubmit,
  presidentialDecision,
  presidentialOverride,
  reassign,
  complete,
  setAnnouncementMessage,
  listAudit,
  storageMode,
  isSupabaseEnabled,
};
