const fs = require('node:fs');
const path = require('node:path');

const FILE_PATH = path.join(__dirname, '..', 'data', 'quotaSettings.json');

const DEFAULTS = {
  Intern: { total: 2, interview: 1, training: 1, hosting: 0 },
  Management: { total: 3, interview: 0, training: 0, hosting: 0 },
  'Senior Management': { total: 4, interview: 2, training: 2, hosting: 0 },
  Corporate: { total: 4, interview: 2, training: 2, hosting: 4 },
  'Corporate Board': { total: 2, interview: 1, training: 1, hosting: 2 },
  Presidentials: { total: 1, interview: 0, training: 0, hosting: 1 },
};

function ensureFile() {
  const dir = path.dirname(FILE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(FILE_PATH)) {
    fs.writeFileSync(FILE_PATH, JSON.stringify(DEFAULTS, null, 2));
  }
}

function readFile() {
  ensureFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
    return { ...DEFAULTS, ...(parsed || {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeFile(data) {
  ensureFile();
  fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2));
}

function getQuota(tier) {
  const data = readFile();
  return data[tier] || null;
}

function getAllQuotas() {
  return readFile();
}

function setQuota(tier, quota) {
  const data = readFile();
  data[tier] = {
    total: Number(quota.total || 0),
    interview: Number(quota.interview || 0),
    training: Number(quota.training || 0),
    hosting: Number(quota.hosting || 0),
  };
  writeFile(data);
  return data[tier];
}

module.exports = {
  FILE_PATH,
  DEFAULTS,
  getQuota,
  getAllQuotas,
  setQuota,
};
