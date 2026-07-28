const fs = require('node:fs');
const path = require('node:path');
const { resolveDataPath, atomicWriteJson } = require('./dataPaths');

const DATA_PATH = resolveDataPath('quotaSettings.json', process.env.QUOTA_SETTINGS_PATH);

function splitRequirement(total) {
  const value = Number(total || 0);
  if (value <= 1) return { interview: 0, training: 0 };
  if (value === 2) return { interview: 1, training: 1 };
  if (value === 3) return { interview: 1, training: 1 };
  return {
    interview: Math.floor(value / 2),
    training: Math.ceil(value / 2),
  };
}

const DEFAULTS = {
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
    // Corporate Interns need 4 sessions total:
    // 2 non-cohost/support sessions (1 interview + 1 training) PLUS 2 co-hosted sessions.
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

  // Alias kept so older saved settings still load safely.
  corporate: {
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
};

const DISPLAY_NAME_TO_KEY = {
  Intern: 'intern',
  Management: 'management',
  'Senior Management': 'senior_management',
  'Corporate Intern': 'corporate_intern',
  Corporate: 'junior_corporate',
  'Junior Corporate': 'junior_corporate',
  'Head Corporate': 'head_corporate',
  'Corporate Board': 'corporate_board',
  Presidential: 'presidential',
};

const FORCED_MODES = {
  intern: 'regular',
  management: 'regular',
  senior_management: 'regular',
  corporate_intern: 'regular_and_cohost',
  junior_corporate: 'hosted_and_cohost',
  head_corporate: 'hosted_and_cohost',
  corporate_board: 'hosted_and_overseer',
  presidential: 'hosted_and_overseer',
  corporate: 'hosted_and_cohost',
};

function ensureStore() {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(DEFAULTS, null, 2));
  }
}

function withDerivedSplits(key, quota) {
  const next = { ...quota };
  next.mode = FORCED_MODES[key] || next.mode;

  if (['intern', 'management', 'senior_management', 'corporate_intern'].includes(key)) {
    const split = splitRequirement(next.total);
    if (next.minInterview == null) next.minInterview = split.interview;
    if (next.minTraining == null) next.minTraining = split.training;
  }

  if ((next.hostedTotal || 0) > 0) {
    const split = splitRequirement(next.hostedTotal);
    if (next.hostedInterview == null) next.hostedInterview = split.interview;
    if (next.hostedTraining == null) next.hostedTraining = split.training;
  }

  if ((next.cohostTotal || 0) > 0) {
    const split = splitRequirement(next.cohostTotal);
    if (next.cohostInterview == null) next.cohostInterview = split.interview;
    if (next.cohostTraining == null) next.cohostTraining = split.training;
  }

  if ((next.minOverseer || 0) > 0) {
    const split = splitRequirement(next.minOverseer);
    if (next.overseerInterview == null) next.overseerInterview = split.interview;
    if (next.overseerTraining == null) next.overseerTraining = split.training;
  }

  next.total = Number(next.total || 0);
  next.hostedTotal = Number(next.hostedTotal || 0);
  next.cohostTotal = Number(next.cohostTotal || 0);
  next.minOverseer = Number(next.minOverseer || 0);
  next.shiftMinutes = Number(next.shiftMinutes || 0);

  return next;
}

function normalize(data) {
  const merged = JSON.parse(JSON.stringify(DEFAULTS));
  if (data && typeof data === 'object') {
    for (const [key, value] of Object.entries(data)) {
      if (!merged[key]) continue;
      merged[key] = {
        ...merged[key],
        ...value,
      };
    }

    if (!data.junior_corporate && data.corporate) {
      merged.junior_corporate = {
        ...merged.junior_corporate,
        ...data.corporate,
        label: merged.junior_corporate.label,
      };
    }
  }

  for (const key of Object.keys(merged)) {
    merged[key] = withDerivedSplits(key, merged[key]);
  }

  return merged;
}

function getAllQuotas() {
  ensureStore();
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    return normalize(JSON.parse(raw));
  } catch {
    return normalize({});
  }
}

function saveAllQuotas(data) {
  ensureStore();
  atomicWriteJson(DATA_PATH, normalize(data));
}

function resolveKey(tierKey) {
  return DISPLAY_NAME_TO_KEY[tierKey] || tierKey;
}

function getQuota(tierKey) {
  const all = getAllQuotas();
  return all[resolveKey(tierKey)] || null;
}

function setQuota(tierKey, patch) {
  const key = resolveKey(tierKey);
  const all = getAllQuotas();
  if (!all[key]) return null;

  all[key] = withDerivedSplits(key, {
    ...all[key],
    ...patch,
  });

  saveAllQuotas(all);
  return all[key];
}

// Backwards-compatible names for older activitysettings.js versions.
function getQuotaSettings() {
  return getAllQuotas();
}

function getQuotaEntry(tierKey) {
  const q = getQuota(tierKey);
  if (!q) return null;

  return {
    total: q.total ?? 0,
    training: q.minTraining ?? q.hostedTraining ?? q.cohostTraining ?? q.overseerTraining ?? 0,
    interview: q.minInterview ?? q.hostedInterview ?? q.cohostInterview ?? q.overseerInterview ?? 0,
    hosting: q.hostedTotal ?? 0,
    cohost: q.cohostTotal ?? 0,
    overseer: q.minOverseer ?? 0,
    shiftMinutes: q.shiftMinutes ?? 0,
    raw: q,
  };
}

function deriveAndApplyTypeSplits(patch, baseKey, count, interview, training) {
  if (count == null && interview == null && training == null) return;

  const split = splitRequirement(count ?? patch[`${baseKey}Total`] ?? patch.minOverseer ?? 0);
  const interviewKey = baseKey === 'regular' ? 'minInterview' : `${baseKey}Interview`;
  const trainingKey = baseKey === 'regular' ? 'minTraining' : `${baseKey}Training`;

  patch[interviewKey] = interview ?? split.interview;
  patch[trainingKey] = training ?? split.training;
}

function updateQuotaSettings(tierKey, next) {
  const key = resolveKey(tierKey);
  const all = getAllQuotas();
  if (!all[key]) return null;

  const current = all[key];
  const patch = {};

  if (next.total != null) patch.total = Number(next.total);
  if (next.hosting != null) patch.hostedTotal = Number(next.hosting);
  if (next.cohost != null) patch.cohostTotal = Number(next.cohost);
  if (next.overseer != null) patch.minOverseer = Number(next.overseer);
  if (next.shiftMinutes != null) patch.shiftMinutes = Number(next.shiftMinutes);

  const interview = next.interview != null ? Number(next.interview) : null;
  const training = next.training != null ? Number(next.training) : null;

  if (current.mode === 'regular' || current.mode === 'regular_and_cohost') {
    deriveAndApplyTypeSplits(patch, 'regular', patch.total ?? current.total, interview, training);
  }

  if ((patch.hostedTotal != null || ['hosted', 'hosted_and_cohost', 'hosted_and_overseer'].includes(current.mode)) && (patch.hostedTotal ?? current.hostedTotal ?? 0) > 0) {
    const split = splitRequirement(patch.hostedTotal ?? current.hostedTotal);
    patch.hostedInterview = interview ?? split.interview;
    patch.hostedTraining = training ?? split.training;
  }

  if ((patch.cohostTotal != null || ['cohost', 'regular_and_cohost', 'hosted_and_cohost'].includes(current.mode)) && (patch.cohostTotal ?? current.cohostTotal ?? 0) > 0) {
    const split = splitRequirement(patch.cohostTotal ?? current.cohostTotal);
    patch.cohostInterview = interview ?? split.interview;
    patch.cohostTraining = training ?? split.training;
  }

  if ((patch.minOverseer != null || ['overseer_only', 'hosted_and_overseer'].includes(current.mode)) && (patch.minOverseer ?? current.minOverseer ?? 0) > 0) {
    const split = splitRequirement(patch.minOverseer ?? current.minOverseer);
    patch.overseerInterview = interview ?? split.interview;
    patch.overseerTraining = training ?? split.training;
  }

  return setQuota(key, patch);
}

module.exports = {
  DATA_PATH,
  DEFAULTS,
  splitRequirement,
  getAllQuotas,
  getQuota,
  setQuota,
  saveAllQuotas,
  getQuotaSettings,
  getQuotaEntry,
  updateQuotaSettings,
};
