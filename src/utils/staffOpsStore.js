'use strict';

const crypto = require('node:crypto');
const { resolveDataPath, readJsonFile, atomicWriteJson } = require('./dataPaths');

const STORE_PATH = resolveDataPath('staffOperations.json', process.env.STAFF_OPS_STORE_PATH);
const EMPTY = {
  schemaVersion: 2,
  counters: {},
  cases: [],
  watchRecords: [],
  restrictedRecords: [],
  documents: [],
  posts: [],
  audit: [],
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeStore(input) {
  const store = input && typeof input === 'object' ? input : {};
  return {
    schemaVersion: 2,
    counters: store.counters && typeof store.counters === 'object' ? store.counters : {},
    cases: Array.isArray(store.cases) ? store.cases : [],
    watchRecords: Array.isArray(store.watchRecords) ? store.watchRecords : [],
    restrictedRecords: Array.isArray(store.restrictedRecords) ? store.restrictedRecords : [],
    documents: Array.isArray(store.documents) ? store.documents : [],
    posts: Array.isArray(store.posts) ? store.posts : [],
    audit: Array.isArray(store.audit) ? store.audit : [],
  };
}

function readStore() {
  return normalizeStore(readJsonFile(STORE_PATH, EMPTY));
}

function writeStore(store) {
  atomicWriteJson(STORE_PATH, normalizeStore(store));
}

function cleanText(value, max = 4000) {
  return String(value ?? '').trim().slice(0, max);
}

function makeId(prefix = 'item') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function nextNumber(store, namespace, prefix) {
  const year = new Date().getUTCFullYear();
  const key = `${namespace}:${year}`;
  store.counters[key] = Number(store.counters[key] || 0) + 1;
  return `${prefix}-${year}-${String(store.counters[key]).padStart(4, '0')}`;
}

function addAudit(store, action, actor, details = {}) {
  store.audit.unshift({
    id: makeId('audit'),
    action: cleanText(action, 100),
    actorId: cleanText(actor?.id, 40),
    actorTag: cleanText(actor?.tag || actor?.username || actor?.displayName, 100),
    details,
    createdAt: nowIso(),
  });
  store.audit = store.audit.slice(0, 5000);
}

function listCases({ guildId, limit = 250 } = {}) {
  return readStore().cases
    .filter((entry) => !guildId || String(entry.guildId) === String(guildId))
    .slice(0, Math.max(1, Math.min(1000, Number(limit) || 250)));
}

function getCase(caseId, guildId = null) {
  return readStore().cases.find((entry) =>
    (entry.id === caseId || entry.caseNumber === caseId) &&
    (!guildId || String(entry.guildId) === String(guildId))
  ) || null;
}

function createCase(input, actor) {
  const store = readStore();
  const createdAt = nowIso();
  const actionType = cleanText(input.actionType, 60).toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
  const serious = ['suspension', 'demotion', 'termination', 'corporate_discipline'].includes(actionType);
  const entry = {
    id: makeId('case'),
    caseNumber: nextNumber(store, 'case', 'GH-SA'),
    guildId: cleanText(input.guildId, 40),
    targetId: cleanText(input.targetId, 40),
    targetUsername: cleanText(input.targetUsername, 100),
    targetRank: cleanText(input.targetRank, 100),
    actionType: actionType || 'staff_note',
    reason: cleanText(input.reason, 4000),
    evidence: cleanText(input.evidence, 2000),
    staffWarningCount: Number.isFinite(Number(input.staffWarningCount)) ? Number(input.staffWarningCount) : null,
    length: cleanText(input.length, 100),
    startDate: cleanText(input.startDate, 20),
    endDate: cleanText(input.endDate, 20),
    status: serious ? 'pending_approval' : 'approved',
    serious,
    createdById: cleanText(actor?.id, 40),
    createdByTag: cleanText(actor?.tag || actor?.username, 100),
    createdAt,
    updatedAt: createdAt,
    decisionById: null,
    decisionByTag: null,
    decisionReason: null,
    decidedAt: null,
  };
  store.cases.unshift(entry);
  addAudit(store, 'case_created', actor, { caseNumber: entry.caseNumber, actionType: entry.actionType, targetId: entry.targetId });
  writeStore(store);
  return entry;
}

function updateCase(caseId, changes, actor) {
  const store = readStore();
  const entry = store.cases.find((item) => item.id === caseId || item.caseNumber === caseId);
  if (!entry) return null;

  const allowedStatus = new Set(['draft', 'pending_approval', 'approved', 'denied', 'reversed', 'closed']);
  if (changes.status && allowedStatus.has(String(changes.status))) {
    entry.status = String(changes.status);
    entry.decisionById = cleanText(actor?.id, 40);
    entry.decisionByTag = cleanText(actor?.tag || actor?.username, 100);
    entry.decisionReason = cleanText(changes.decisionReason, 2000);
    entry.decidedAt = nowIso();
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'reason')) entry.reason = cleanText(changes.reason, 4000);
  if (Object.prototype.hasOwnProperty.call(changes, 'evidence')) entry.evidence = cleanText(changes.evidence, 2000);
  entry.updatedAt = nowIso();

  addAudit(store, 'case_updated', actor, { caseNumber: entry.caseNumber, status: entry.status });
  writeStore(store);
  return entry;
}

function listWatchRecords({ guildId, limit = 250 } = {}) {
  return readStore().watchRecords
    .filter((entry) => !guildId || String(entry.guildId) === String(guildId))
    .slice(0, Math.max(1, Math.min(1000, Number(limit) || 250)));
}

function getWatchRecord(recordId, guildId = null) {
  return readStore().watchRecords.find((entry) =>
    (entry.id === recordId || entry.recordNumber === recordId) &&
    (!guildId || String(entry.guildId) === String(guildId))
  ) || null;
}

function createWatchRecord(input, actor) {
  const store = readStore();
  const createdAt = nowIso();
  const entry = {
    id: makeId('watch'),
    recordNumber: nextNumber(store, 'watch', 'GH-WR'),
    guildId: cleanText(input.guildId, 40),
    targetId: cleanText(input.targetId, 40),
    targetUsername: cleanText(input.targetUsername, 100),
    targetRank: cleanText(input.targetRank, 100),
    reason: cleanText(input.reason, 5000),
    expectations: cleanText(input.expectations, 5000),
    reviewerId: cleanText(input.reviewerId || actor?.id, 40),
    reviewerTag: cleanText(input.reviewerTag || actor?.tag || actor?.username, 100),
    startDate: cleanText(input.startDate, 20),
    reviewDate: cleanText(input.reviewDate, 20),
    status: 'active',
    outcome: '',
    createdById: cleanText(actor?.id, 40),
    createdByTag: cleanText(actor?.tag || actor?.username, 100),
    createdAt,
    updatedAt: createdAt,
  };
  store.watchRecords.unshift(entry);
  addAudit(store, 'watch_record_created', actor, { recordNumber: entry.recordNumber, targetId: entry.targetId });
  writeStore(store);
  return entry;
}

function updateWatchRecord(recordId, changes, actor) {
  const store = readStore();
  const entry = store.watchRecords.find((item) => item.id === recordId || item.recordNumber === recordId);
  if (!entry) return null;
  const allowedStatus = new Set(['active', 'improving', 'escalated', 'cleared', 'expired', 'archived']);
  if (changes.status && allowedStatus.has(String(changes.status))) entry.status = String(changes.status);
  if (Object.prototype.hasOwnProperty.call(changes, 'reason')) entry.reason = cleanText(changes.reason, 5000);
  if (Object.prototype.hasOwnProperty.call(changes, 'expectations')) entry.expectations = cleanText(changes.expectations, 5000);
  if (Object.prototype.hasOwnProperty.call(changes, 'outcome')) entry.outcome = cleanText(changes.outcome, 5000);
  if (Object.prototype.hasOwnProperty.call(changes, 'reviewDate')) entry.reviewDate = cleanText(changes.reviewDate, 20);
  entry.updatedAt = nowIso();
  addAudit(store, 'watch_record_updated', actor, { recordNumber: entry.recordNumber, status: entry.status });
  writeStore(store);
  return entry;
}

function listRestrictedRecords({ guildId, limit = 250 } = {}) {
  return readStore().restrictedRecords
    .filter((entry) => !guildId || String(entry.guildId) === String(guildId))
    .slice(0, Math.max(1, Math.min(1000, Number(limit) || 250)));
}

function getRestrictedRecord(recordId, guildId = null) {
  return readStore().restrictedRecords.find((entry) =>
    (entry.id === recordId || entry.recordNumber === recordId) &&
    (!guildId || String(entry.guildId) === String(guildId))
  ) || null;
}

function createRestrictedRecord(input, actor) {
  const store = readStore();
  const createdAt = nowIso();
  const entry = {
    id: makeId('restricted'),
    recordNumber: nextNumber(store, 'restricted', 'GH-RR'),
    guildId: cleanText(input.guildId, 40),
    subjectId: cleanText(input.subjectId, 40),
    subjectName: cleanText(input.subjectName, 120),
    category: cleanText(input.category || 'Confidential', 100),
    summary: cleanText(input.summary, 8000),
    evidence: cleanText(input.evidence, 5000),
    status: 'open',
    resolution: '',
    createdById: cleanText(actor?.id, 40),
    createdByTag: cleanText(actor?.tag || actor?.username, 100),
    createdAt,
    updatedAt: createdAt,
  };
  store.restrictedRecords.unshift(entry);
  addAudit(store, 'restricted_record_created', actor, { recordNumber: entry.recordNumber, subjectId: entry.subjectId });
  writeStore(store);
  return entry;
}

function updateRestrictedRecord(recordId, changes, actor) {
  const store = readStore();
  const entry = store.restrictedRecords.find((item) => item.id === recordId || item.recordNumber === recordId);
  if (!entry) return null;
  const allowedStatus = new Set(['open', 'under_review', 'resolved', 'do_not_rehire', 'archived']);
  if (changes.status && allowedStatus.has(String(changes.status))) entry.status = String(changes.status);
  if (Object.prototype.hasOwnProperty.call(changes, 'summary')) entry.summary = cleanText(changes.summary, 8000);
  if (Object.prototype.hasOwnProperty.call(changes, 'evidence')) entry.evidence = cleanText(changes.evidence, 5000);
  if (Object.prototype.hasOwnProperty.call(changes, 'resolution')) entry.resolution = cleanText(changes.resolution, 8000);
  entry.updatedAt = nowIso();
  addAudit(store, 'restricted_record_updated', actor, { recordNumber: entry.recordNumber, status: entry.status });
  writeStore(store);
  return entry;
}

function listDocuments({ guildId, limit = 250 } = {}) {
  return readStore().documents
    .filter((entry) => !guildId || String(entry.guildId) === String(guildId))
    .slice(0, Math.max(1, Math.min(1000, Number(limit) || 250)));
}

function createDocument(input, actor) {
  const store = readStore();
  const createdAt = nowIso();
  const entry = {
    id: makeId('doc'),
    guildId: cleanText(input.guildId, 40),
    title: cleanText(input.title, 150),
    category: cleanText(input.category || 'General', 80),
    content: cleanText(input.content, 30000),
    visibilityTier: Math.max(1, Math.min(8, Number(input.visibilityTier) || 5)),
    createdById: cleanText(actor?.id, 40),
    createdByTag: cleanText(actor?.tag || actor?.username, 100),
    createdAt,
    updatedAt: createdAt,
  };
  store.documents.unshift(entry);
  addAudit(store, 'document_created', actor, { documentId: entry.id, title: entry.title });
  writeStore(store);
  return entry;
}

function updateDocument(documentId, changes, actor) {
  const store = readStore();
  const entry = store.documents.find((item) => item.id === documentId);
  if (!entry) return null;
  if (Object.prototype.hasOwnProperty.call(changes, 'title')) entry.title = cleanText(changes.title, 150);
  if (Object.prototype.hasOwnProperty.call(changes, 'category')) entry.category = cleanText(changes.category, 80);
  if (Object.prototype.hasOwnProperty.call(changes, 'content')) entry.content = cleanText(changes.content, 30000);
  if (Object.prototype.hasOwnProperty.call(changes, 'visibilityTier')) entry.visibilityTier = Math.max(1, Math.min(8, Number(changes.visibilityTier) || 5));
  entry.updatedAt = nowIso();
  addAudit(store, 'document_updated', actor, { documentId: entry.id, title: entry.title });
  writeStore(store);
  return entry;
}

function listPosts({ guildId, type, limit = 100 } = {}) {
  return readStore().posts
    .filter((entry) => (!guildId || String(entry.guildId) === String(guildId)) && (!type || entry.type === type))
    .slice(0, Math.max(1, Math.min(500, Number(limit) || 100)));
}

function createPost(input, actor) {
  const store = readStore();
  const createdAt = nowIso();
  const type = ['schedule', 'update'].includes(String(input.type)) ? String(input.type) : 'update';
  const entry = {
    id: makeId('post'),
    guildId: cleanText(input.guildId, 40),
    type,
    title: cleanText(input.title, 150),
    content: cleanText(input.content, 10000),
    channelId: cleanText(input.channelId, 40),
    messageId: cleanText(input.messageId, 40),
    posted: Boolean(input.posted),
    createdById: cleanText(actor?.id, 40),
    createdByTag: cleanText(actor?.tag || actor?.username, 100),
    createdAt,
    updatedAt: createdAt,
  };
  store.posts.unshift(entry);
  addAudit(store, `${type}_created`, actor, { postId: entry.id, title: entry.title, posted: entry.posted });
  writeStore(store);
  return entry;
}

function listAudit({ limit = 250 } = {}) {
  return readStore().audit.slice(0, Math.max(1, Math.min(1000, Number(limit) || 250)));
}

module.exports = {
  STORE_PATH,
  listCases,
  getCase,
  createCase,
  updateCase,
  listWatchRecords,
  getWatchRecord,
  createWatchRecord,
  updateWatchRecord,
  listRestrictedRecords,
  getRestrictedRecord,
  createRestrictedRecord,
  updateRestrictedRecord,
  listDocuments,
  createDocument,
  updateDocument,
  listPosts,
  createPost,
  listAudit,
};
