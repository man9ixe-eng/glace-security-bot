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

  report.promotionDatabase = makeState(
    has('SUPABASE_URL') && (has('SUPABASE_SERVICE_ROLE_KEY') || has('SUPABASE_SECRET_KEY'))
      ? []
      : ['SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY'],
  );

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

  const hasMassShiftChannel = has('SESSION_MASS_SHIFT_CHANNEL_ID') || has('SESSION_MASSSHIFT_CHANNEL_ID');
  const hasSeparateSessionChannels =
    has('SESSION_INTERVIEW_CHANNEL_ID') &&
    has('SESSION_TRAINING_CHANNEL_ID') &&
    hasMassShiftChannel;
  const hasSessionDestination = has('SESSION_HUB_CHANNEL_ID') || hasSeparateSessionChannels;
  const hasSessionLog = has('SESSION_LOG_CHANNEL_ID') || has('SESSION_ATTENDEES_CHANNEL_ID');

  const sessionMissing = [];
  if (!hasSessionDestination) {
    sessionMissing.push('SESSION_HUB_CHANNEL_ID or all separate interview/training/mass-shift channel IDs');
  }
  if (!hasSessionLog) sessionMissing.push('SESSION_LOG_CHANNEL_ID or SESSION_ATTENDEES_CHANNEL_ID');
  report.sessionChannels = makeState(sessionMissing);

  report.staffRequestDatabase = report.promotionDatabase;

  report.staffRequestChannels = makeState([
    ...(!has('STAFF_REQUEST_PANEL_CHANNEL_ID') ? ['STAFF_REQUEST_PANEL_CHANNEL_ID'] : []),
    ...(!(has('STAFF_REQUEST_CORPORATE_REVIEW_CHANNEL_ID') || has('CORPORATE_REQUEST_REVIEW_CHANNEL_ID')) ? ['STAFF_REQUEST_CORPORATE_REVIEW_CHANNEL_ID'] : []),
    ...(!(has('STAFF_REQUEST_BOARD_REVIEW_CHANNEL_ID') || has('RESIGNATION_REVIEW_CHANNEL_ID') || has('PROMOTION_BOARD_REVIEW_CHANNEL_ID')) ? ['STAFF_REQUEST_BOARD_REVIEW_CHANNEL_ID or PROMOTION_BOARD_REVIEW_CHANNEL_ID'] : []),
    ...(!(has('STAFF_REQUEST_PRESIDENTIAL_REVIEW_CHANNEL_ID') || has('PRESIDENTIAL_REQUEST_REVIEW_CHANNEL_ID')) ? ['STAFF_REQUEST_PRESIDENTIAL_REVIEW_CHANNEL_ID'] : []),
  ]);

  report.promotionReviewChannels = makeState([
    ...(!(has('PROMOTION_BOARD_REVIEW_CHANNEL_ID') || has('CORPORATE_BOARD_PROMOTION_CHANNEL_ID')) ? ['PROMOTION_BOARD_REVIEW_CHANNEL_ID'] : []),
    ...(!(has('PROMOTION_PRESIDENTIAL_REVIEW_CHANNEL_ID') || has('PRESIDENTIAL_PROMOTION_REVIEW_CHANNEL_ID')) ? ['PROMOTION_PRESIDENTIAL_REVIEW_CHANNEL_ID'] : []),
  ]);

  report.robloxStaffDirectory = makeState(
    has('ROBLOX_GROUP_ID') || has('ROBLOX_COMMUNITY_ID') ? [] : ['ROBLOX_GROUP_ID'],
  );

  report.reviewOnCallPanel = makeState([
    ...(!has('CORPORATE_REVIEW_PING_ROLE_ID') ? ['CORPORATE_REVIEW_PING_ROLE_ID'] : []),
    ...(!(has('CORPORATE_BOARD_REVIEW_PING_ROLE_ID') || has('BOARD_REVIEW_PING_ROLE_ID')) ? ['CORPORATE_BOARD_REVIEW_PING_ROLE_ID'] : []),
    ...(!has('PRESIDENTIAL_REVIEW_PING_ROLE_ID') ? ['PRESIDENTIAL_REVIEW_PING_ROLE_ID'] : []),
  ]);

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
