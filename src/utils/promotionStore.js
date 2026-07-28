'use strict';

const crypto = require('node:crypto');
const { resolveDataPath, readJsonFile, atomicWriteJson } = require('./dataPaths');
const { TIERS } = require('../config/access');

const STORE_PATH = resolveDataPath('promotionSubmissions.json', process.env.PROMOTION_STORE_PATH);
const EMPTY = { schemaVersion: 1, counters: {}, submissions: [], audit: [] };

function nowIso() { return new Date().toISOString(); }
function clean(value, max = 4000) { return String(value ?? '').trim().slice(0, max); }
function id(prefix) { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`; }
function read() {
  const raw = readJsonFile(STORE_PATH, EMPTY);
  return {
    schemaVersion: 1,
    counters: raw?.counters && typeof raw.counters === 'object' ? raw.counters : {},
    submissions: Array.isArray(raw?.submissions) ? raw.submissions : [],
    audit: Array.isArray(raw?.audit) ? raw.audit : [],
  };
}
function write(store) { atomicWriteJson(STORE_PATH, store); }
function actorData(actor) {
  return { id: clean(actor?.id, 40), tag: clean(actor?.tag || actor?.username || actor?.displayName, 100) };
}
function nextNumber(store) {
  const year = new Date().getUTCFullYear();
  const key = String(year);
  store.counters[key] = Number(store.counters[key] || 0) + 1;
  return `GH-PR-${year}-${String(store.counters[key]).padStart(4, '0')}`;
}
function addAudit(store, action, actor, submission, details = {}) {
  const a = actorData(actor);
  store.audit.unshift({
    id: id('paudit'), action, actorId: a.id, actorTag: a.tag,
    submissionId: submission?.id || null,
    submissionNumber: submission?.submissionNumber || null,
    details, createdAt: nowIso(),
  });
  store.audit = store.audit.slice(0, 5000);
}
function list({ guildId, limit = 500 } = {}) {
  return read().submissions
    .filter((x) => !guildId || String(x.guildId) === String(guildId))
    .slice(0, Math.max(1, Math.min(1000, Number(limit) || 500)));
}
function get(submissionId, guildId = null) {
  return read().submissions.find((x) =>
    (x.id === submissionId || x.submissionNumber === submissionId) &&
    (!guildId || String(x.guildId) === String(guildId))
  ) || null;
}
function create(input, actor) {
  const store = read();
  const when = nowIso();
  const a = actorData(actor);
  const proposedTier = Math.max(TIERS.INTERN, Math.min(TIERS.PRESIDENTIAL, Number(input.proposedTier) || TIERS.MANAGEMENT));
  const entry = {
    id: id('promotion'), submissionNumber: nextNumber(store), guildId: clean(input.guildId, 40),
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
    approvedAt: null, completionDeadline: null,
    completedById: null, completedByTag: null, completedAt: null,
    discordVerified: false, verifiedTier: null, announcementMessageId: null,
    returnStage: null,
  };
  store.submissions.unshift(entry);
  addAudit(store, 'promotion_submitted', actor, entry, { candidateId: entry.candidateId, proposedRank: entry.proposedRank });
  write(store);
  return entry;
}
function boardDecision(submissionId, decision, reason, actor) {
  const store = read();
  const entry = store.submissions.find((x) => x.id === submissionId || x.submissionNumber === submissionId);
  if (!entry) return null;
  if (!['board_review', 'returned_to_corporate'].includes(entry.status)) throw new Error('This submission is not awaiting Corporate Board review.');
  const a = actorData(actor); const when = nowIso();
  entry.boardDecision = decision; entry.boardDecisionById = a.id; entry.boardDecisionByTag = a.tag;
  entry.boardDecisionReason = clean(reason, 3000); entry.boardDecidedAt = when; entry.updatedAt = when;
  if (decision === 'approve') entry.status = 'presidential_review';
  else if (decision === 'return') { entry.status = 'returned_to_corporate'; entry.returnStage = 'board'; }
  else if (decision === 'deny') entry.status = 'denied';
  else throw new Error('Invalid Board decision.');
  addAudit(store, `promotion_board_${decision}`, actor, entry, { reason: entry.boardDecisionReason });
  write(store); return entry;
}
function resubmit(submissionId, changes, actor) {
  const store = read();
  const entry = store.submissions.find((x) => x.id === submissionId || x.submissionNumber === submissionId);
  if (!entry) return null;
  if (entry.status !== 'returned_to_corporate') throw new Error('Only returned submissions can be resubmitted.');
  if (String(entry.submittedById) !== String(actor?.id)) throw new Error('Only the original Corporate submitter can resubmit this promotion.');
  for (const field of ['reason','evidence','strengths','concerns']) if (field in changes) entry[field] = clean(changes[field], 5000);
  entry.diligenceConfirmed = Boolean(changes.diligenceConfirmed ?? entry.diligenceConfirmed);
  entry.status = entry.returnStage === 'presidential' ? 'presidential_review' : 'board_review';
  entry.returnStage = null; entry.updatedAt = nowIso();
  addAudit(store, 'promotion_resubmitted', actor, entry);
  write(store); return entry;
}
function presidentialDecision(submissionId, decision, reason, actor) {
  const store = read();
  const entry = store.submissions.find((x) => x.id === submissionId || x.submissionNumber === submissionId);
  if (!entry) return null;
  if (entry.status !== 'presidential_review') throw new Error('This submission is not awaiting Presidential review.');
  const a = actorData(actor); const when = nowIso();
  if (decision === 'approve') {
    if (entry.presidentialApprovals.some((x) => String(x.id) === a.id)) throw new Error('You already approved this submission.');
    entry.presidentialApprovals.push({ id: a.id, tag: a.tag, at: when });
    const required = entry.proposedTier >= TIERS.CORPORATE_BOARD ? 2 : 1;
    if (entry.presidentialApprovals.length >= required) {
      entry.status = 'approved_awaiting_completion'; entry.approvedAt = when;
      entry.completionDeadline = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    }
  } else if (decision === 'return') {
    entry.status = 'returned_to_corporate'; entry.returnStage = 'presidential';
    entry.presidentialDecisionReason = clean(reason, 3000);
  } else if (decision === 'deny') {
    entry.status = 'denied'; entry.presidentialDecisionReason = clean(reason, 3000);
  } else throw new Error('Invalid Presidential decision.');
  entry.updatedAt = when;
  addAudit(store, `promotion_presidential_${decision}`, actor, entry, { reason: clean(reason, 3000) });
  write(store); return entry;
}
function reassign(submissionId, assignee, reason, actor) {
  const store = read();
  const entry = store.submissions.find((x) => x.id === submissionId || x.submissionNumber === submissionId);
  if (!entry) return null;
  entry.assignedCompletionId = clean(assignee?.id, 40); entry.assignedCompletionTag = clean(assignee?.tag, 100);
  entry.updatedAt = nowIso();
  addAudit(store, 'promotion_completion_reassigned', actor, entry, { assigneeId: entry.assignedCompletionId, reason: clean(reason, 1000) });
  write(store); return entry;
}
function complete(submissionId, verification, actor) {
  const store = read();
  const entry = store.submissions.find((x) => x.id === submissionId || x.submissionNumber === submissionId);
  if (!entry) return null;
  if (entry.status !== 'approved_awaiting_completion') throw new Error('This promotion is not awaiting completion.');
  if (String(entry.assignedCompletionId) !== String(actor?.id)) throw new Error('This promotion is assigned to a different Corporate member.');
  if (!verification?.discordVerified) throw new Error('The candidate’s Discord rank could not be verified.');
  const a = actorData(actor); const when = nowIso();
  entry.status = 'completed'; entry.completedById = a.id; entry.completedByTag = a.tag; entry.completedAt = when;
  entry.discordVerified = true; entry.verifiedTier = Number(verification.verifiedTier) || null;
  entry.updatedAt = when;
  addAudit(store, 'promotion_completed', actor, entry, { verifiedTier: entry.verifiedTier });
  write(store); return entry;
}
function setAnnouncementMessage(submissionId, messageId) {
  const store = read(); const entry = store.submissions.find((x) => x.id === submissionId);
  if (!entry) return null; entry.announcementMessageId = clean(messageId, 40); entry.updatedAt = nowIso(); write(store); return entry;
}
function listAudit({ limit = 250 } = {}) { return read().audit.slice(0, Math.max(1, Math.min(1000, Number(limit) || 250))); }

module.exports = { STORE_PATH, list, get, create, boardDecision, resubmit, presidentialDecision, reassign, complete, setAnnouncementMessage, listAudit };
