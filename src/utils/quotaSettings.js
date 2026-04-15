
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

function getQuota(tierKey) {
  const all = getAllQuotas();
  return all[tierKey] || null;
}

function setQuota(tierKey, patch) {
  const all = getAllQuotas();
  if (!all[tierKey]) return null;
  all[tierKey] = {
    ...all[tierKey],
    ...patch,
  };
  saveAllQuotas(all);
  return all[tierKey];
}

module.exports = {
  DATA_PATH,
  DEFAULTS,
  getAllQuotas,
  getQuota,
  setQuota,
  saveAllQuotas,
};
