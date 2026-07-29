'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'glace-validate-'));
// All stores loaded during validation use an isolated directory.
process.env.DATA_DIR = temp;

let failures = 0;
function pass(message) { console.log(`✓ ${message}`); }
function fail(message) { failures += 1; console.error(`✗ ${message}`); }

async function main() {
  // 1. Syntax validation
  const jsFiles = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (name === 'node_modules') continue;
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (name.endsWith('.js')) jsFiles.push(full);
    }
  }
  walk(path.join(root, 'src'));
  walk(path.join(root, 'scripts'));
  for (const file of jsFiles) {
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (check.status !== 0) fail(`Syntax error in ${path.relative(root, file)}: ${check.stderr.trim()}`);
  }
  if (!failures) pass(`${jsFiles.length} JavaScript files pass syntax validation`);

  // 2. Command loading + access coverage
  const { getCommandRequirement } = require(path.join(root, 'src/utils/commandAccess'));
  const names = new Map();
  const commandsRoot = path.join(root, 'src/commands');
  for (const folder of fs.readdirSync(commandsRoot)) {
    const dir = path.join(commandsRoot, folder);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.js'))) {
      const full = path.join(dir, file);
      try {
        const command = require(full);
        if (!command?.data || typeof command.execute !== 'function') {
          fail(`${path.relative(root, full)} is not a valid command module`);
          continue;
        }
        const json = command.data.toJSON();
        if (names.has(json.name)) fail(`Duplicate command /${json.name}`);
        names.set(json.name, full);
        if (getCommandRequirement(json.name) === null) fail(`/${json.name} has no central access rule`);
        if (json.default_member_permissions != null) fail(`/${json.name} still has a conflicting native permission gate`);
        if (json.dm_permission !== false) fail(`/${json.name} is not explicitly guild-only`);
      } catch (error) {
        fail(`${path.relative(root, full)} could not load: ${error.stack || error.message}`);
      }
    }
  }
  pass(`${names.size} slash commands loaded and checked against the access matrix`);

  // 3. Permission ladder behavior
  const { getTier, getOpsLevel } = require(path.join(root, 'src/utils/permissions'));
  function member(id, roleNames = [], ownerId = 'owner') {
    return {
      id,
      guild: { ownerId },
      roles: { cache: new Map(roleNames.map((name, index) => [`${1000 + index}`, { id: `${1000 + index}`, name }])) },
    };
  }
  const tierCases = [
    [member('a', ['Leadership Intern']), 3, 1, 'Leadership Intern'],
    [member('b', ['Corporate Intern']), 5, 2, 'Corporate Intern stays Senior Management'],
    [member('c', ['Corporate Team']), 6, 3, 'Corporate Team'],
    [member('d', ['Board of Directors']), 7, 4, 'Corporate Board'],
    [member('e', ['Presidential Intern']), 7, 4, 'Presidential Intern stays Corporate Board'],
    [member('f', ['Vice President']), 8, 5, 'Presidential'],
    [member('owner', []), 8, 5, 'Guild owner'],
  ];
  for (const [mock, expectedTier, expectedOps, label] of tierCases) {
    const actualTier = getTier(mock);
    const actualOps = getOpsLevel(mock);
    if (actualTier !== expectedTier) fail(`${label} resolved to Tier ${actualTier}, expected ${expectedTier}`);
    if (actualOps !== expectedOps) fail(`${label} resolved to Ops ${actualOps}, expected ${expectedOps}`);
  }
  pass('The Glace tier ladder and internal access bands resolve correctly');

  // 4. Bundled JSON data validity
  for (const file of fs.readdirSync(path.join(root, 'src/data')).filter((name) => name.endsWith('.json'))) {
    try { JSON.parse(fs.readFileSync(path.join(root, 'src/data', file), 'utf8')); }
    catch (error) { fail(`Invalid JSON in src/data/${file}: ${error.message}`); }
  }
  pass('Bundled JSON data files are valid');

  // 5. Staff Operations store round-trip
  const staffOps = require(path.join(root, 'src/utils/staffOpsStore'));
  const created = staffOps.createCase({
    guildId: 'guild', targetName: 'TestUser', targetUsername: 'TestUser', targetRank: 'Leadership Intern',
    actionType: 'suspension', reason: 'Validation only', staffWarningCount: 2,
  }, { id: '1', tag: 'Validator' });
  const updated = staffOps.updateCase(created.id, { status: 'approved', decisionReason: 'Validated' }, { id: '2', tag: 'Board Validator' });
  const doc = staffOps.createDocument({ guildId: 'guild', title: 'Test Policy', content: 'Validation', visibilityTier: 5 }, { id: '1', tag: 'Validator' });
  const post = staffOps.createPost({ guildId: 'guild', type: 'schedule', title: 'Test Schedule', content: 'Validation' }, { id: '1', tag: 'Validator' });
  const restricted = staffOps.createRestrictedRecord({ guildId: 'guild', subjectName: 'Restricted User', summary: 'Validation' }, { id: '2', tag: 'Board Validator' });
  if (!created.caseNumber || created.status !== 'pending_approval' || updated?.status !== 'approved' || !doc.id || !post.id || !restricted.recordNumber) {
    fail('Staff Operations store create/approval/document/restricted/post round-trip failed');
  } else {
    pass('Staff Hub stores pass staff action, restricted, document, and post validation');
  }

  // 5b. Promotion submission ownership and approval/completion round-trip
  const promotions = require(path.join(root, 'src/utils/promotionStore'));
  let promotion = await promotions.create({ guildId: 'guild', candidateId: '3', candidateUsername: 'Candidate', currentRank: 'Leadership Intern', proposedRank: 'Supervisor', proposedTier: 4, reason: 'Ready', evidence: 'Reviewed', strengths: 'Reliable', diligenceConfirmed: true }, { id: '1', tag: 'Corporate Validator' });
  promotion = await promotions.boardDecision(promotion.id, 'approve', 'Board reviewed', { id: '2', tag: 'Board Validator' });
  promotion = await promotions.presidentialDecision(promotion.id, 'approve', 'Final approval', { id: '4', tag: 'Presidential Validator' });
  promotion = await promotions.complete(promotion.id, { discordVerified: true, verifiedTier: 4 }, { id: '1', tag: 'Corporate Validator' });
  if (promotion.status !== 'completed' || promotion.completedById !== '1') fail('Promotion submission approval/completion round-trip failed');
  else pass('Promotion submissions preserve Corporate ownership through verified completion');

  // 6. LOA active/history round-trip
  const loa = require(path.join(root, 'src/utils/loaStore'));
  loa.setLoaRecord('guild', 'user', { officialStartDate: '2026-07-01', officialEndDate: '2026-07-10', reason: 'Validation' });
  loa.clearLoaRecord('guild', 'user', { officialEndDate: '2026-07-09', endedById: '1' });
  if (loa.listActiveLoas('guild').length !== 0 || loa.listLoaHistory('guild', 10).length !== 1) fail('LOA active/history round-trip failed');
  else pass('LOA store preserves ended records in website history');

  // 7. Command audit round-trip
  const operationsAudit = require(path.join(root, 'src/utils/operationsAudit'));
  const audit = operationsAudit.appendAudit({ guildId: 'guild', command: 'validate', actorId: '1', status: 'executed' });
  if (!audit.id || operationsAudit.listAudit({ guildId: 'guild' }).length !== 1) fail('Operations audit round-trip failed');
  else pass('Operations audit uses the persistent data directory');

  // 8. Legacy ticket counter migration
  const legacyTicketsPath = path.join(temp, 'tickets.json');
  const ticketStatePath = path.join(temp, 'ticketState.json');
  fs.writeFileSync(legacyTicketsPath, JSON.stringify({ counters: { corporate: 4 }, open: {} }, null, 2));
  fs.rmSync(ticketStatePath, { force: true });
  const ticketsStore = require(path.join(root, 'src/utils/ticketsStore'));
  const nextTicket = await ticketsStore.getNextNumberAndBump({ channels: { fetch: async () => null } }, 'corporate', 'user');
  if (nextTicket.number !== 5) fail('Legacy ticket counter migration failed');
  else pass('Legacy ticket counters migrate into the persistent ticket store');

  // 9. Website public route smoke test
  const { handleOpsWebRequest } = require(path.join(root, 'src/web/opsPortal'));
  let statusCode = null;
  let body = '';
  const headers = {};
  const req = { url: '/ops', method: 'GET', headers: { host: 'localhost:3000' } };
  const res = {
    headersSent: false,
    setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
    writeHead(code, extra = {}) { statusCode = code; this.headersSent = true; Object.assign(headers, extra); },
    end(value = '') { body += String(value); },
  };
  const handled = await handleOpsWebRequest(req, res, { guilds: { cache: new Map() } });
  if (!handled || statusCode !== 200 || !body.includes('Glace Hotels') || !body.includes('Management Portal')) fail('Staff Hub public route smoke test failed');
  else pass('Staff Hub public route responds successfully');

  // 10. Browser-side portal JavaScript syntax
  const browserScriptPath = path.join(root, 'src/web/assets/ops.js');
  const browserCheck = spawnSync(process.execPath, ['--check', browserScriptPath], { encoding: 'utf8' });
  if (browserCheck.status !== 0) fail(`Staff Hub browser JavaScript has a syntax error: ${browserCheck.stderr.trim()}`);
  else pass('Staff Hub browser JavaScript passes syntax validation');

  if (failures) {
    console.error(`\nValidation failed with ${failures} problem(s).`);
    process.exitCode = 1;
  } else {
    console.log('\nGlace Security Bot validation passed.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(temp, { recursive: true, force: true });
  });
