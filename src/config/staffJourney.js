'use strict';

// Glace Hotels Staff Journey v3
// Rank order still controls what a promotion/demotion means. Departments never affect this file.

const STAFF_JOURNEY_TEST_CHANNEL_ID = String(
  process.env.STAFF_JOURNEY_TEST_CHANNEL_ID || '1540333948817776721',
).trim();

const ANNOUNCEMENT_CHANNEL_ID = '1419193236018302996';

const STAFF_PING_ROLE_ID = String(
  process.env.STAFF_JOURNEY_PROMOTION_PING_ROLE_ID || '1419194037403123855',
).trim();

const GLACE_EMOJI = '<:GlaceHotels:1489052500341297344>';

const TEAM_EMOJIS = Object.freeze({
  junior_staff: '<:juniorstaff_team:1476916492539789408>',
  former: '<:former_team:1478648150028980334>',
  intern: '<:intern_team:1476916364877758505>',
  management: '<:manager_team:1476916258036514837>',
  senior_management: '<:senior_team:1476916038602985614>',
  corporate: '<:corp_team:1478642239155474533>',
  corporate_board: '<:board_team:1476915796730187868>',
  presidential: '<:pres_team:1476915718644699136>',
});

const TEAM_LABELS = Object.freeze({
  intern: process.env.LABEL_INTERN,
  management: process.env.LABEL_MANAGEMENT,
  senior_management: process.env.LABEL_SENIOR_MANAGEMENT,
  corporate: process.env.LABEL_CORPORATE,
  corporate_board: process.env.LABEL_CORPORATE_BOARD,
  presidential: process.env.LABEL_PRESIDENTIAL,
});

const RANKS = Object.freeze([
  { key: 'leadership_intern', display: 'Leadership Intern', team: 'intern', listId: process.env.LEADERSHIP_INTERN_LIST_ID, labelId: process.env.LABEL_LEADERSHIP_INTERN },
  { key: 'supervisor', display: 'Supervisor', team: 'management', listId: process.env.SUPERVISOR_LIST_ID, labelId: process.env.LABEL_SUPERVISOR },
  { key: 'assistant_manager', display: 'Assistant Manager', team: 'management', listId: process.env.ASSISTANT_MANAGER_LIST_ID, labelId: process.env.LABEL_ASSISTANT_MANAGER },
  { key: 'hotel_manager', display: 'Hotel Manager', team: 'management', listId: process.env.HOTEL_MANAGER_LIST_ID, labelId: process.env.LABEL_HOTEL_MANAGER },
  { key: 'executive_manager', display: 'Executive Manager', team: 'senior_management', listId: process.env.EXECUTIVE_MANAGER_LIST_ID, labelId: process.env.LABEL_EXECUTIVE_MANAGER },
  { key: 'corporate_intern', display: 'Corporate Intern', team: 'senior_management', listId: process.env.CORPORATE_INTERN_LIST_ID, labelId: process.env.LABEL_CORPORATE_INTERN },
  { key: 'junior_corporate', display: 'Junior Corporate', team: 'corporate', listId: process.env.JUNIOR_CORPORATE_LIST_ID, labelId: process.env.LABEL_JUNIOR_CORPORATE },
  { key: 'senior_corporate', display: 'Senior Corporate', team: 'corporate', listId: process.env.SENIOR_CORPORATE_LIST_ID, labelId: process.env.LABEL_SENIOR_CORPORATE },
  { key: 'head_corporate', display: 'Head Corporate', team: 'corporate', listId: process.env.HEAD_CORPORATE_LIST_ID, labelId: process.env.LABEL_HEAD_CORPORATE },
  { key: 'board_of_director', display: 'Board Of Director', team: 'corporate_board', listId: process.env.BOARD_OF_DIRECTORS_LIST_ID || process.env.BOARD_OF_DIRECTOR_LIST_ID, labelId: process.env.LABEL_BOARD_OF_DIRECTORS || process.env.LABEL_BOARD_OF_DIRECTOR },
  { key: 'presidential_intern', display: 'Presidential Intern', team: 'corporate_board', listId: process.env.PRESIDENTIAL_INTERN_LIST_ID, labelId: process.env.LABEL_PRESIDENTIAL_INTERN },
  { key: 'chief_executive_officer', display: 'Chief Executive Officer', team: 'presidential', listId: process.env.CHIEF_EXECUTIVE_OFFICER_LIST_ID, labelId: process.env.LABEL_CHIEF_EXECUTIVE_OFFICER },
  { key: 'vice_president', display: 'Vice President', team: 'presidential', listId: process.env.VICE_PRESIDENT_LIST_ID, labelId: process.env.LABEL_VICE_PRESIDENT },
  { key: 'president', display: 'President', team: 'presidential', listId: process.env.PRESIDENT_LIST_ID, labelId: process.env.LABEL_PRESIDENT },
]);

const RANK_BY_KEY = new Map(RANKS.map((rank, index) => [rank.key, { ...rank, index }]));
const RANK_BY_NAME = new Map(RANKS.map((rank, index) => [rank.display.toLowerCase(), { ...rank, index }]));

const ALL_RANK_LABEL_IDS = RANKS.map((rank) => rank.labelId).filter(Boolean);
const ALL_TEAM_LABEL_IDS = Object.values(TEAM_LABELS).filter(Boolean);
const ACTIVE_LIST_IDS = RANKS.map((rank) => rank.listId).filter(Boolean);

module.exports = {
  boardId: process.env.STAFF_JOURNEY_BOARD_ID,
  recentlyResignedListId: process.env.RESIGNATION_LIST_ID || process.env.RESIGNATIONS_LIST_ID || process.env.RESIGNITIONS_LIST_ID,
  monthlyMilestonesListId: process.env.MONTHLY_MILESTONES_LIST_ID,
  recentlyResignedLabelId: process.env.LABEL_RECENTLY_RESIGNED,
  recentlyPromotedLabelId: process.env.LABEL_RECENTLY_PROMOTED,
  happyMonthsLabelId: process.env.LABEL_HAPPY_MONTHS,
  ANNOUNCEMENT_CHANNEL_ID,
  STAFF_PING_ROLE_ID,
  STAFF_JOURNEY_TEST_CHANNEL_ID,
  GLACE_EMOJI,
  TEAM_EMOJIS,
  TEAM_LABELS,
  RANKS,
  RANK_BY_KEY,
  RANK_BY_NAME,
  ALL_RANK_LABEL_IDS,
  ALL_TEAM_LABEL_IDS,
  ACTIVE_LIST_IDS,
};
