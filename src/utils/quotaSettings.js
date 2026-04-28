
const fs = require('node:fs');
const path = require('node:path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'quotaSettings.json');

const DEFAULTS = {
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
  corporate_intern: {
    label: 'Corporate Interns',
    mode: 'cohost',
    total: 2,
    minInterview: 1,
    minTraining: 1,
  },
  junior_corporate: {
    label: 'Junior Corporate+',
    mode: 'hosted',
    total: 2,
    minInterview: 1,
    minTraining: 1,
  },
  head_corporate: {
    label: 'Head Corporate+',
    mode: 'head_corporate_mixed',
    total: 3,
    hostedTotal: 2,
    hostedInterview: 1,
    hostedTraining: 1,
    minOverseer: 1,
  },
  corporate_board: {
    label: 'Corporate Board',
    mode: 'overseer_only',
    total: 3,
    minOverseer: 3,
  },
  presidential: {
    label: 'Presidentials',
    mode: 'combined_any',
    total: 1,
    minInterview: 0,
    minTraining: 0,
  },

  // Kept as an alias so older /activitysettings data does not disappear.
  corporate: {
    label: 'Corporate',
    mode: 'hosted',
    total: 2,
    minInterview: 1,
    minTraining: 1,
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

function ensureStore() {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify(DEFAULTS, null, 2));
  }
}

function normalize(data) {
  const merged = JSON.parse(JSON.stringify(DEFAULTS));
  if (!data || typeof data !== 'object') return merged;

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
      mode: 'hosted',
    };
  }

  merged.corporate_board = {
    ...merged.corporate_board,
    mode: 'overseer_only',
    minOverseer:
      merged.corporate_board.minOverseer ??
      merged.corporate_board.total ??
      DEFAULTS.corporate_board.minOverseer,
  };

  merged.presidential = {
    ...merged.presidential,
    mode: 'combined_any',
  };

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
  fs.writeFileSync(DATA_PATH, JSON.stringify(normalize(data), null, 2));
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
  all[key] = {
    ...all[key],
    ...patch,
  };
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
    total: q.total ?? q.hostedTotal ?? q.minOverseer ?? 0,
    training: q.minTraining ?? q.hostedTraining ?? 0,
    interview: q.minInterview ?? q.hostedInterview ?? 0,
    hosting: q.hostedTotal ?? (q.mode === 'hosted' ? q.total : 0),
    raw: q,
  };
}

function updateQuotaSettings(tierKey, next) {
  const key = resolveKey(tierKey);
  const all = getAllQuotas();
  if (!all[key]) return null;

  const current = all[key];
  const patch = {
    total: next.total ?? current.total,
    minTraining: next.training ?? current.minTraining,
    minInterview: next.interview ?? current.minInterview,
  };

  if (current.mode === 'hosted') {
    patch.total = next.hosting ?? next.total ?? current.total;
  }

  if (current.mode === 'head_corporate_mixed') {
    patch.hostedTotal = next.hosting ?? current.hostedTotal;
    patch.hostedTraining = next.training ?? current.hostedTraining;
    patch.hostedInterview = next.interview ?? current.hostedInterview;
  }

  if (current.mode === 'overseer_only') {
    patch.minOverseer = next.total ?? current.minOverseer ?? current.total;
  }

  return setQuota(key, patch);
}

module.exports = {
  DATA_PATH,
  DEFAULTS,
  getAllQuotas,
  getQuota,
  setQuota,
  saveAllQuotas,
  getQuotaSettings,
  getQuotaEntry,
  updateQuotaSettings,
};
