'use strict';

/**
 * One source of truth for Glace Discord and website access.
 *
 * Staff tiers:
 * 1 Regular member
 * 2 Junior Staff
 * 3 Intern
 * 4 Management
 * 5 Senior Management
 * 6 Corporate
 * 7 Corporate Board
 * 8 Presidential / Owner
 *
 * Legacy access bands are retained internally for command compatibility.
 * The website and user-facing messages always use the real Glace tier names.
 */
const TIERS = Object.freeze({
  MEMBER: 1,
  JUNIOR_STAFF: 2,
  INTERN: 3,
  MANAGEMENT: 4,
  SENIOR_MANAGEMENT: 5,
  CORPORATE: 6,
  CORPORATE_BOARD: 7,
  PRESIDENTIAL: 8,
});

const OPS_LEVELS = Object.freeze({
  NONE: 0,
  INTERN_MANAGEMENT: 1,
  SENIOR_MANAGEMENT: 2,
  CORPORATE: 3,
  CORPORATE_BOARD: 4,
  PRESIDENTIAL: 5,
});

// Dispatcher backstop. No command runs unless it is listed here.
const COMMAND_MIN_TIER = Object.freeze({
  // Self-service / utility
  ping: TIERS.MEMBER,
  stafftier: TIERS.MEMBER,
  warnings: TIERS.MEMBER,
  activity: TIERS.JUNIOR_STAFF,
  sessions: TIERS.JUNIOR_STAFF,

  // Activity viewing and settings
  viewactivity: TIERS.MANAGEMENT,
  junioractivity: TIERS.MANAGEMENT,
  activitylist: TIERS.SENIOR_MANAGEMENT,
  activitysettings: TIERS.CORPORATE_BOARD,

  // Moderation
  clear: TIERS.JUNIOR_STAFF,
  warn: TIERS.MANAGEMENT,
  checkwarnings: TIERS.MANAGEMENT,
  kick: TIERS.MANAGEMENT,
  timeout: TIERS.MANAGEMENT,
  slowmode: TIERS.MANAGEMENT,
  ban: TIERS.SENIOR_MANAGEMENT,
  unban: TIERS.SENIOR_MANAGEMENT,
  lock: TIERS.SENIOR_MANAGEMENT,
  unlock: TIERS.SENIOR_MANAGEMENT,
  clearwarn: TIERS.SENIOR_MANAGEMENT,
  sendappeal: TIERS.SENIOR_MANAGEMENT,
  clearwarnall: TIERS.CORPORATE,
  appealpanel: TIERS.PRESIDENTIAL,

  // Session operations
  addsession: TIERS.MANAGEMENT,
  sessionqueue: TIERS.MANAGEMENT,
  sessionattendees: TIERS.MANAGEMENT,
  logsession: TIERS.CORPORATE,
  editactivity: TIERS.CORPORATE,
  cancelsession: TIERS.CORPORATE,
  removesession: TIERS.CORPORATE,

  // Staff operations
  opspanel: TIERS.SENIOR_MANAGEMENT,
  addloa: TIERS.CORPORATE,
  extendloa: TIERS.CORPORATE,
  removeloa: TIERS.CORPORATE,
  promotion: TIERS.CORPORATE,
  enroll: TIERS.CORPORATE,
  changeuser: TIERS.CORPORATE,
  resignation: TIERS.CORPORATE,
  'staff-journey': TIERS.CORPORATE,
  'announce-promotion': TIERS.CORPORATE,
  'add-demotion': TIERS.CORPORATE_BOARD,
  unenroll: TIERS.CORPORATE_BOARD,

  // Ticket commands. Ticket context applies finer rules.
  ticketpanel: TIERS.CORPORATE,
  claim: TIERS.JUNIOR_STAFF,
  close: TIERS.MEMBER,
  forceclose: TIERS.JUNIOR_STAFF,
  adduser: TIERS.JUNIOR_STAFF,
});

const COMMANDS_REQUIRING_OUTRANK = Object.freeze({
  warn: 'user',
  kick: 'user',
  timeout: 'user',
  ban: 'user',
  clearwarn: 'user',
  clearwarnall: 'user',
  'add-demotion': 'member',
  promotion: 'username',
  resignation: 'member',
});

const WEBSITE_CAPABILITIES = Object.freeze({
  // The portal is available to every Leadership Intern+ staff member. Data is
  // still filtered server-side, so logging in never grants confidential tabs.
  viewDashboard: TIERS.INTERN,
  viewPosts: TIERS.INTERN,
  viewLoas: TIERS.INTERN,
  viewDocuments: TIERS.MANAGEMENT,
  viewStaffCases: TIERS.SENIOR_MANAGEMENT,
  createNotes: TIERS.SENIOR_MANAGEMENT,

  // Corporate owns submissions and routine documentation.
  viewPromotions: TIERS.CORPORATE,
  submitPromotion: TIERS.CORPORATE,
  completePromotion: TIERS.CORPORATE,
  createRoutineCase: TIERS.CORPORATE,
  viewWatchRecords: TIERS.CORPORATE,
  manageWatchRecords: TIERS.CORPORATE,
  publishSchedule: TIERS.CORPORATE,
  publishUpdate: TIERS.CORPORATE,
  manageDocuments: TIERS.CORPORATE,

  // Corporate Board is the approval and restricted-record layer.
  reviewPromotionBoard: TIERS.CORPORATE_BOARD,
  approveSeriousCase: TIERS.CORPORATE_BOARD,
  viewRestrictedRecords: TIERS.CORPORATE_BOARD,
  manageRestrictedRecords: TIERS.CORPORATE_BOARD,
  viewAudit: TIERS.CORPORATE_BOARD,

  // Presidential provides the final promotion decision and system control.
  approvePromotionPresidential: TIERS.PRESIDENTIAL,
  manageConfiguration: TIERS.PRESIDENTIAL,
});

module.exports = {
  TIERS,
  OPS_LEVELS,
  COMMAND_MIN_TIER,
  COMMANDS_REQUIRING_OUTRANK,
  WEBSITE_CAPABILITIES,
};
