'use strict';

// Non-fatal startup diagnostics. Optional systems stay disabled instead of crashing the bot.

const groups = {
  core: ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID'],
  staffOperationsWebsite: ['CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'PUBLIC_BASE_URL', 'GUILD_ID'],
  persistentData: ['DATA_DIR'],
  operationsLog: ['OPERATIONS_LOG_CHANNEL_ID'],
  trelloSessions: [
    'TRELLO_KEY', 'TRELLO_TOKEN', 'TRELLO_BOARD_ID',
    'TRELLO_LIST_INTERVIEW_ID', 'TRELLO_LIST_TRAINING_ID', 'TRELLO_LIST_MASS_SHIFT_ID',
    'TRELLO_LIST_COMPLETED_ID',
  ],
  staffJourney: ['TRELLO_KEY', 'TRELLO_TOKEN', 'STAFF_JOURNEY_BOARD_ID'],
  tickets: [
    'SUPPORT_CATEGORY_ID',
    'TICKET_ROLE_TRIAL_ID', 'TICKET_ROLE_MOD_ID', 'TICKET_ROLE_ADMIN_ID', 'TICKET_ROLE_REVIEWER_ID',
  ],
  loaRoles: ['MR_LOA_ROLE_ID', 'HR_LOA_ROLE_ID'],
};

function has(name) {
  return Boolean(String(process.env[name] || '').trim());
}

function missingFor(names) {
  return names.filter((name) => !has(name));
}

function makeState(missing) {
  return { enabled: missing.length === 0, missing };
}

function getConfigurationReport() {
  const report = {};
  for (const [name, required] of Object.entries(groups)) report[name] = makeState(missingFor(required));

  report.currentLoas = makeState(
    has('CURRENT_LOAS_CHANNEL_ID') || has('LOA_LOG_CHANNEL_ID')
      ? []
      : ['CURRENT_LOAS_CHANNEL_ID or LOA_LOG_CHANNEL_ID'],
  );

  report.staffPosts = makeState(
    has('STAFF_POSTS_CHANNEL_ID') || (has('STAFF_SCHEDULE_CHANNEL_ID') && has('STAFF_UPDATES_CHANNEL_ID'))
      ? []
      : ['STAFF_POSTS_CHANNEL_ID or both STAFF_SCHEDULE_CHANNEL_ID and STAFF_UPDATES_CHANNEL_ID'],
  );

  report.sessionChannels = makeState(
    has('SESSION_HUB_CHANNEL_ID') && has('SESSION_LOG_CHANNEL_ID')
      ? []
      : ['SESSION_HUB_CHANNEL_ID', 'SESSION_LOG_CHANNEL_ID'].filter((name) => !has(name)),
  );

  report.portalStaffJourney = makeState(
    has('STAFF_JOURNEY_CHANNEL_ID') || has('STAFF_UPDATES_CHANNEL_ID') || has('STAFF_POSTS_CHANNEL_ID')
      ? []
      : ['STAFF_JOURNEY_CHANNEL_ID or STAFF_UPDATES_CHANNEL_ID'],
  );

  return report;
}

function logConfigurationReport() {
  const report = getConfigurationReport();
  for (const [name, state] of Object.entries(report)) {
    if (state.enabled) console.log(`[CONFIG] ${name}: ready`);
    else console.warn(`[CONFIG] ${name}: incomplete (${state.missing.join(', ')})`);
  }
  return report;
}

module.exports = { getConfigurationReport, logConfigurationReport };
