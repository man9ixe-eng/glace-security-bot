'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_DIR = path.resolve(process.env.DATA_DIR || DEFAULT_DATA_DIR);

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  return DATA_DIR;
}

function resolveDataPath(filename, explicitPath) {
  ensureDataDir();
  const target = path.resolve(explicitPath || path.join(DATA_DIR, filename));
  const bundled = path.resolve(path.join(DEFAULT_DATA_DIR, filename));

  // First boot on a persistent disk: preserve any JSON bundled with the old project.
  if (target !== bundled && !fs.existsSync(target) && fs.existsSync(bundled) && fs.statSync(bundled).isFile()) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(bundled, target);
  }
  return target;
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return structuredClone(fallback);
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return structuredClone(fallback);
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[DATA] Failed to read ${filePath}:`, err);
    return structuredClone(fallback);
  }
}

function atomicWriteJson(filePath, value) {
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, filePath);
}

module.exports = {
  DATA_DIR,
  ensureDataDir,
  resolveDataPath,
  readJsonFile,
  atomicWriteJson,
};
