// src/commands/staff/promotion.js
// /promotion — Discord team/ticket roles + Staff Journey Trello automation.

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const axios = require('axios');
const rolesConfig = require('../../config/roles');
const { hasAnyRole } = require('../../utils/permissions');

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const BOARD_ID = process.env.STAFF_JOURNEY_BOARD_ID;

// =========================
// RANK CONFIG
// =========================
const RANKS = {
  supervisor: {
    display: 'Supervisor',
    choice: 'Supervisor - Management Team',
    listId: process.env.SUPERVISOR_LIST_ID,
    rankLabel: process.env.LABEL_SUPERVISOR,
    teamLabel: process.env.LABEL_MANAGEMENT,
    teamKey: 'management',
    requiredAuthority: 'corporate',
  },
  assistant_manager: {
    display: 'Assistant Manager',
    choice: 'Assistant Manager',
    listId: process.env.ASSISTANT_MANAGER_LIST_ID,
    rankLabel: process.env.LABEL_ASSISTANT_MANAGER,
    teamLabel: process.env.LABEL_MANAGEMENT,
    teamKey: 'management',
    requiredAuthority: 'corporate',
  },
  hotel_manager: {
    display: 'Hotel Manager',
    choice: 'Hotel Manager',
    listId: process.env.HOTEL_MANAGER_LIST_ID,
    rankLabel: process.env.LABEL_HOTEL_MANAGER,
    teamLabel: process.env.LABEL_MANAGEMENT,
    teamKey: 'management',
    requiredAuthority: 'corporate',
  },
  executive_manager: {
    display: 'Executive Manager',
    choice: 'Executive Manager - Senior Management Team',
    listId: process.env.EXECUTIVE_MANAGER_LIST_ID,
    rankLabel: process.env.LABEL_EXECUTIVE_MANAGER,
    teamLabel: process.env.LABEL_SENIOR_MANAGEMENT,
    teamKey: 'senior_management',
    requiredAuthority: 'corporate',
  },
  corporate_intern: {
    display: 'Corporate Intern',
    choice: 'Corporate Intern',
    listId: process.env.CORPORATE_INTERN_LIST_ID,
    rankLabel: process.env.LABEL_CORPORATE_INTERN,
    teamLabel: process.env.LABEL_SENIOR_MANAGEMENT,
    teamKey: 'senior_management',
    requiredAuthority: 'corporate',
  },
  junior_corporate: {
    display: 'Junior Corporate',
    choice: 'Junior Corporate - Corporate Team',
    listId: process.env.JUNIOR_CORPORATE_LIST_ID,
    rankLabel: process.env.LABEL_JUNIOR_CORPORATE,
    teamLabel: process.env.LABEL_CORPORATE,
    teamKey: 'corporate',
    requiredAuthority: 'board',
  },
  senior_corporate: {
    display: 'Senior Corporate',
    choice: 'Senior Corporate',
    listId: process.env.SENIOR_CORPORATE_LIST_ID,
    rankLabel: process.env.LABEL_SENIOR_CORPORATE,
    teamLabel: process.env.LABEL_CORPORATE,
    teamKey: 'corporate',
    requiredAuthority: 'board',
  },
  head_corporate: {
    display: 'Head Corporate',
    choice: 'Head Corporate',
    listId: process.env.HEAD_CORPORATE_LIST_ID,
    rankLabel: process.env.LABEL_HEAD_CORPORATE,
    teamLabel: process.env.LABEL_CORPORATE,
    teamKey: 'corporate',
    requiredAuthority: 'board',
  },
  board_of_director: {
    display: 'Board Of Director',
    choice: 'Board Of Director - Corporate Board',
    listId: process.env.BOARD_OF_DIRECTORS_LIST_ID,
    rankLabel: process.env.LABEL_BOARD_OF_DIRECTORS,
    teamLabel: process.env.LABEL_CORPORATE_BOARD,
    teamKey: 'corporate_board',
    requiredAuthority: 'board',
  },
  presidential_intern: {
    display: 'Presidential Intern',
    choice: 'Presidential Intern',
    listId: process.env.PRESIDENTIAL_INTERN_LIST_ID,
    rankLabel: process.env.LABEL_PRESIDENTIAL_INTERN,
    teamLabel: process.env.LABEL_CORPORATE_BOARD,
    teamKey: 'corporate_board',
    requiredAuthority: 'board',
  },
  chief_executive_officer: {
    display: 'Chief Executive Officer',
    choice: 'Chief Executive Officer - Presidential',
    listId: process.env.CHIEF_EXECUTIVE_OFFICER_LIST_ID,
    rankLabel: process.env.LABEL_CHIEF_EXECUTIVE_OFFICER,
    teamLabel: process.env.LABEL_PRESIDENTIAL,
    teamKey: 'presidential',
    requiredAuthority: 'president',
  },
  vice_president: {
    display: 'Vice President',
    choice: 'Vice President',
    listId: process.env.VICE_PRESIDENT_LIST_ID,
    rankLabel: process.env.LABEL_VICE_PRESIDENT,
    teamLabel: process.env.LABEL_PRESIDENTIAL,
    teamKey: 'presidential',
    requiredAuthority: 'president',
  },
  president: {
    display: 'President',
    choice: 'President',
    listId: process.env.PRESIDENT_LIST_ID,
    rankLabel: process.env.LABEL_PRESIDENT,
    teamLabel: process.env.LABEL_PRESIDENTIAL,
    teamKey: 'presidential',
    requiredAuthority: 'president',
  },
};

const TEAM_ROLE_CONFIG = {
  management: {
    label: 'Management',
    teamIdsKey: 'MANAGEMENT_ROLE_IDS',
    teamNameMatchers: [['management']],
    excludeTargetKeywords: ['senior'],
    ticketLabel: 'Ticket Mod',
    ticketEnvNames: ['TICKET_ROLE_MOD_ID'],
    ticketNameMatchers: [['ticket', 'mod'], ['ticket', 'moderator']],
  },
  senior_management: {
    label: 'Senior Management',
    teamIdsKey: 'SENIOR_MANAGEMENT_ROLE_IDS',
    teamNameMatchers: [['senior', 'management']],
    ticketLabel: 'Ticket Admin',
    ticketEnvNames: ['TICKET_ROLE_ADMIN_ID'],
    ticketNameMatchers: [['ticket', 'admin']],
  },
  corporate: {
    label: 'Corporate',
    teamIdsKey: 'CORPORATE_ROLE_IDS',
    teamNameMatchers: [['corporate']],
    excludeTargetKeywords: ['intern', 'board', 'director'],
    ticketLabel: 'Ticket Reviewer',
    ticketEnvNames: ['TICKET_ROLE_REVIEWER_ID'],
    ticketNameMatchers: [['ticket', 'reviewer']],
  },
  corporate_board: {
    label: 'Corporate Board',
    teamIdsKey: 'CORPORATE_BOARD_ROLE_IDS',
    teamNameMatchers: [['corporate', 'board'], ['board', 'director']],
    ticketLabel: 'Ticket Chief',
    ticketEnvNames: ['TICKET_ROLE_CHIEF_ID'],
    ticketNameMatchers: [['ticket', 'chief']],
  },
  presidential: {
    label: 'Presidential',
    teamIdsKey: 'PRESIDENTIAL_ROLE_IDS',
    teamNameMatchers: [['presidential']],
    excludeTargetKeywords: ['intern'],
    ticketLabel: 'Ticket Chief',
    ticketEnvNames: ['TICKET_ROLE_CHIEF_ID'],
    ticketNameMatchers: [['ticket', 'chief']],
  },
};

const TEAM_REMOVE_KEYS = [
  'JUNIOR_STAFF_ROLE_IDS',
  'INTERN_ROLE_IDS',
  'MANAGEMENT_ROLE_IDS',
  'SENIOR_MANAGEMENT_ROLE_IDS',
  'CORPORATE_ROLE_IDS',
  'CORPORATE_BOARD_ROLE_IDS',
  'PRESIDENTIAL_ROLE_IDS',
];

const TEAM_REMOVE_MATCHERS = [
  ['junior', 'staff'],
  ['intern'],
  ['management'],
  ['senior', 'management'],
  ['corporate'],
  ['corporate', 'board'],
  ['board', 'director'],
  ['presidential'],
];

const TICKET_REMOVE_ENV_NAMES = [
  'TICKET_ROLE_INTERN_ID',
  'TICKET_ROLE_TRIAL_ID',
  'TICKET_ROLE_MOD_ID',
  'TICKET_ROLE_ADMIN_ID',
  'TICKET_ROLE_REVIEWER_ID',
  'TICKET_ROLE_CHIEF_ID',
];

const TICKET_REMOVE_MATCHERS = [
  ['ticket', 'intern'],
  ['ticket', 'trial'],
  ['ticket', 'mod'],
  ['ticket', 'moderator'],
  ['ticket', 'admin'],
  ['ticket', 'reviewer'],
  ['ticket', 'chief'],
];

const ALL_RANK_LABELS = [
  process.env.LABEL_LEADERSHIP_INTERN,
  process.env.LABEL_SUPERVISOR,
  process.env.LABEL_ASSISTANT_MANAGER,
  process.env.LABEL_HOTEL_MANAGER,
  process.env.LABEL_EXECUTIVE_MANAGER,
  process.env.LABEL_CORPORATE_INTERN,
  process.env.LABEL_JUNIOR_CORPORATE,
  process.env.LABEL_SENIOR_CORPORATE,
  process.env.LABEL_HEAD_CORPORATE,
  process.env.LABEL_BOARD_OF_DIRECTORS,
  process.env.LABEL_PRESIDENTIAL_INTERN,
  process.env.LABEL_CHIEF_EXECUTIVE_OFFICER,
  process.env.LABEL_VICE_PRESIDENT,
  process.env.LABEL_PRESIDENT,
].filter(Boolean);

const ALL_TEAM_LABELS = [
  process.env.LABEL_INTERN,
  process.env.LABEL_MANAGEMENT,
  process.env.LABEL_SENIOR_MANAGEMENT,
  process.env.LABEL_CORPORATE,
  process.env.LABEL_CORPORATE_BOARD,
  process.env.LABEL_PRESIDENTIAL,
].filter(Boolean);

// =========================
// DISCORD HELPERS
// =========================
function configuredIdsForKey(key) {
  const value = rolesConfig[key];
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [];
}

function envIds(names = []) {
  return names.map((name) => process.env[name]).filter(Boolean).map(String);
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/<a?:\w+:\d+>/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function roleMatches(role, matchers, { requireTeam = false } = {}) {
  const name = normalizeName(role?.name);
  if (!name) return false;
  if (name.includes('former') || name.includes('retired') || name.includes('alumni') || name.includes('resigned')) return false;
  if (requireTeam && !name.includes('team')) return false;

  return matchers.some((keywords) => keywords.every((keyword) => name.includes(keyword)));
}

function uniqueRoles(roles) {
  const seen = new Set();
  return roles.filter((role) => {
    if (!role || seen.has(role.id)) return false;
    seen.add(role.id);
    return true;
  });
}

function findRolesByIdsAndNames(guild, ids = [], matchers = [], opts = {}) {
  const roleIds = new Set(ids.filter(Boolean).map(String));
  const found = [];

  for (const role of guild.roles.cache.values()) {
    if (roleIds.has(role.id) || roleMatches(role, matchers, opts)) {
      found.push(role);
    }
  }

  return uniqueRoles(found);
}

function memberHasTeamName(member, matchers) {
  const roleNames = [...(member?.roles?.cache?.values?.() || [])].map((role) => normalizeName(role.name));
  return roleNames.some((name) => {
    if (!name.includes('team')) return false;
    if (name.includes('former') || name.includes('retired') || name.includes('alumni') || name.includes('resigned')) return false;
    return matchers.some((keywords) => keywords.every((keyword) => name.includes(keyword)));
  });
}

function getPresidentOwnerIds() {
  const fromRolesConfig = Array.isArray(rolesConfig.OWNER_IDS) ? rolesConfig.OWNER_IDS : [];
  const fromEnvSingle = process.env.PRESIDENT_USER_ID ? [process.env.PRESIDENT_USER_ID] : [];
  const fromEnvMany = String(process.env.PRESIDENT_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  return new Set([...fromRolesConfig, ...fromEnvSingle, ...fromEnvMany].map(String));
}

function isPresidentActor(member) {
  if (!member || !member.guild) return false;
  if (member.id === member.guild.ownerId) return true;
  return getPresidentOwnerIds().has(String(member.id));
}

function getAuthority(member) {
  if (!member || !member.guild) return 'none';

  if (isPresidentActor(member)) return 'president';

  if (
    hasAnyRole(member, rolesConfig.PRESIDENTIAL_ROLE_IDS || []) ||
    memberHasTeamName(member, [['presidential']])
  ) {
    // Presidential team members are Board+ for Corporate/Corporate Board promotions,
    // but only OWNER_IDS/PRESIDENT_USER_ID/guild owner can add Presidential ranks.
    return 'board';
  }

  if (
    hasAnyRole(member, rolesConfig.CORPORATE_BOARD_ROLE_IDS || []) ||
    memberHasTeamName(member, [['corporate', 'board'], ['board', 'director']])
  ) {
    return 'board';
  }

  if (
    hasAnyRole(member, rolesConfig.CORPORATE_ROLE_IDS || []) ||
    memberHasTeamName(member, [['corporate']])
  ) {
    return 'corporate';
  }

  return 'none';
}

function canPromoteTo(member, requiredAuthority) {
  const authority = getAuthority(member);

  if (requiredAuthority === 'corporate') {
    return authority === 'corporate' || authority === 'board' || authority === 'president';
  }

  if (requiredAuthority === 'board') {
    return authority === 'board' || authority === 'president';
  }

  if (requiredAuthority === 'president') {
    return authority === 'president';
  }

  return false;
}

function authorityError(requiredAuthority) {
  if (requiredAuthority === 'president') {
    return '❌ Only Mani / President can add Presidential ranks. Add your Discord ID to `OWNER_IDS` in `src/config/roles.js` or set `PRESIDENT_USER_ID` in Render if needed.';
  }
  if (requiredAuthority === 'board') {
    return '❌ Only Corporate Board+ can add Corporate, Corporate Board, or Presidential Intern ranks.';
  }
  return '❌ Only Corporate+ can add Management or Senior Management ranks.';
}

function roleMentionList(roles) {
  return roles.length ? roles.map((role) => `<@&${role.id}>`).join(', ') : 'None';
}

function cleanStaffUsernameFromMember(member) {
  return String(member?.displayName || member?.user?.username || '')
    .replace(/^\s*\[\s*LOA\s*\]\s*/i, '')
    .replace(/^\s*LOA\s*[-|:]\s*/i, '')
    .trim();
}

// =========================
// DATE HELPERS
// =========================
function getTodayMmDdYyyy() {
  return new Date().toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });
}

function parseMmDdYyyy(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  const [mm, dd, yyyy] = parts.map(Number);
  if (!mm || !dd || !yyyy) return null;
  return { mm, dd, yyyy };
}

function localNoonFromMmDdYyyy(dateStr) {
  const parsed = parseMmDdYyyy(dateStr);
  if (!parsed) return null;
  return new Date(parsed.yyyy, parsed.mm - 1, parsed.dd, 12, 0, 0, 0);
}

function formatPrettyDate(dateStr) {
  const d = localNoonFromMmDdYyyy(dateStr);
  if (!d) return null;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDueNextMonth(dateStr) {
  const d = localNoonFromMmDdYyyy(dateStr);
  if (!d) return null;

  const originalDay = d.getDate();
  d.setMonth(d.getMonth() + 1);

  if (d.getDate() !== originalDay) {
    d.setDate(0);
    d.setHours(12, 0, 0, 0);
  }

  return d.toISOString();
}

function formatDurationBetweenPrettyDates(startPrettyDate, endDateStr) {
  const start = new Date(startPrettyDate);
  const end = localNoonFromMmDdYyyy(endDateStr);

  if (Number.isNaN(start.getTime()) || !end) return 'Unknown duration';

  let months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth());

  if (end.getDate() < start.getDate()) months -= 1;

  if (months >= 1) return months === 1 ? '1 month' : `${months} months`;

  let days = Math.floor((end - start) / (1000 * 60 * 60 * 24));
  if (days < 1) days = 1;
  return days === 1 ? '1 day' : `${days} days`;
}

// =========================
// TRELLO HELPERS
// =========================
async function trelloGet(url, params = {}) {
  return axios.get(url, {
    params: { key: TRELLO_KEY, token: TRELLO_TOKEN, ...params },
  });
}

async function trelloPut(url, params = {}) {
  return axios.put(url, null, {
    params: { key: TRELLO_KEY, token: TRELLO_TOKEN, ...params },
  });
}

async function trelloPost(url, params = {}) {
  return axios.post(url, null, {
    params: { key: TRELLO_KEY, token: TRELLO_TOKEN, ...params },
  });
}

async function trelloDelete(url, params = {}) {
  return axios.delete(url, {
    params: { key: TRELLO_KEY, token: TRELLO_TOKEN, ...params },
  });
}

function extractCardUsername(cardName) {
  const match = String(cardName || '').match(/^(.+?)\s+-\s+\d{2}\/\d{2}\/\d{4}\s*$/);
  if (match) return match[1].trim();
  return String(cardName || '').split(' - ')[0].trim();
}

async function findStaffCardByUsername(username) {
  const res = await trelloGet(`https://api.trello.com/1/boards/${BOARD_ID}/cards`, {
    fields: 'id,name,desc,idLabels,idList,closed,pos,due,url',
  });

  const lower = String(username || '').trim().toLowerCase();
  if (!lower) return null;

  const openCards = (res.data || []).filter((card) => !card.closed);

  return (
    openCards.find((card) => extractCardUsername(card.name).toLowerCase() === lower) ||
    openCards.find((card) => String(card.name || '').toLowerCase().startsWith(`${lower} - `)) ||
    null
  );
}

function normalizeLines(desc) {
  if (!desc || typeof desc !== 'string') return [];
  return desc.split('\n').map((line) => line.trim()).filter(Boolean);
}

function parseJourneyLine(line) {
  const match = String(line || '').match(/^- \*\*(.+?) - (.+?)(?: - (.+?))?\*\*$/);
  if (!match) return null;
  return {
    startDate: match[1],
    rank: match[2],
    duration: match[3] || null,
  };
}

function rebuildDescriptionForPromotion(desc, newPrettyDate, newRank, dateStr) {
  const lines = normalizeLines(desc);

  if (!lines.length) {
    return `- **${newPrettyDate} - ${newRank}**`;
  }

  const lastIndex = lines.length - 1;
  const parsedLast = parseJourneyLine(lines[lastIndex]);

  if (parsedLast && !parsedLast.duration) {
    const duration = formatDurationBetweenPrettyDates(parsedLast.startDate, dateStr);
    lines[lastIndex] = `- **${parsedLast.startDate} - ${parsedLast.rank} - ${duration}**`;
  }

  lines.push(`- **${newPrettyDate} - ${newRank}**`);
  return lines.join('\n');
}

async function removeOldJourneyLabels(card) {
  const labelsToRemove = (card.idLabels || []).filter(
    (id) =>
      ALL_RANK_LABELS.includes(id) ||
      ALL_TEAM_LABELS.includes(id) ||
      id === process.env.LABEL_RECENTLY_RESIGNED
  );

  for (const labelId of labelsToRemove) {
    await trelloDelete(`https://api.trello.com/1/cards/${card.id}/idLabels/${labelId}`);
  }
}

async function addLabelIfPresent(cardId, labelId) {
  if (!labelId) return;
  await trelloPost(`https://api.trello.com/1/cards/${cardId}/idLabels`, { value: labelId });
}

function parsePromoterCardName(name) {
  const raw = String(name || '').trim();
  const match = raw.match(/^(.+?)\s*\/\s*(.+?)\s+-\s*(\d+)\s*$/);
  if (!match) {
    return {
      nickname: raw,
      username: raw,
      count: null,
      base: raw.replace(/\s+-\s*\d+\s*$/, '').trim(),
    };
  }

  return {
    nickname: match[1].trim(),
    username: match[2].trim(),
    count: Number(match[3]),
    base: `${match[1].trim()} / ${match[2].trim()}`,
  };
}

async function findPromoterCard(promoter) {
  const res = await trelloGet(`https://api.trello.com/1/boards/${BOARD_ID}/cards`, {
    fields: 'id,name,closed,url',
  });

  const wanted = normalizeName(promoter);
  if (!wanted) return null;

  const cards = (res.data || []).filter((card) => !card.closed);

  return (
    cards.find((card) => {
      const parsed = parsePromoterCardName(card.name);
      return normalizeName(parsed.nickname) === wanted || normalizeName(parsed.username) === wanted;
    }) ||
    cards.find((card) => normalizeName(card.name).includes(wanted)) ||
    null
  );
}

async function countComments(cardId) {
  const res = await trelloGet(`https://api.trello.com/1/cards/${cardId}/actions`, {
    filter: 'commentCard',
    limit: 1000,
    fields: 'id,type',
  });

  return Array.isArray(res.data) ? res.data.length : 0;
}

function buildPromoterCardName(oldName, count) {
  const parsed = parsePromoterCardName(oldName);
  const base = parsed.base || String(oldName || '').replace(/\s+-\s*\d+\s*$/, '').trim();
  return `${base} - ${count}`;
}

// =========================
// COMMAND
// =========================
module.exports = {
  data: new SlashCommandBuilder()
    .setName('promotion')
    .setDescription('Promote a staff member and update their Staff Journey card.')
    .setDMPermission(false)
    .addUserOption((option) =>
      option
        .setName('username')
        .setDescription('Member being promoted')
        .setRequired(true),
    )
    .addStringOption((option) => {
      option
        .setName('rank')
        .setDescription('New rank')
        .setRequired(true);

      for (const [value, rank] of Object.entries(RANKS)) {
        option.addChoices({ name: rank.choice, value });
      }

      return option;
    })
    .addStringOption((option) =>
      option
        .setName('promoter')
        .setDescription('Promoter name matching the promoter count card')
        .setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const target = interaction.options.getMember('username');
    const rankKey = interaction.options.getString('rank', true);
    const promoter = interaction.options.getString('promoter', true).trim();
    const rank = RANKS[rankKey];

    if (!target || !rank) {
      await interaction.editReply('❌ I could not find that member or rank.');
      return;
    }

    if (!canPromoteTo(interaction.member, rank.requiredAuthority)) {
      await interaction.editReply(authorityError(rank.requiredAuthority));
      return;
    }

    if (!TRELLO_KEY || !TRELLO_TOKEN || !BOARD_ID) {
      await interaction.editReply('❌ Missing TRELLO_KEY, TRELLO_TOKEN, or STAFF_JOURNEY_BOARD_ID env.');
      return;
    }

    if (!rank.listId || !rank.rankLabel || !rank.teamLabel) {
      await interaction.editReply(`❌ Missing Staff Journey env vars for **${rank.display}**.`);
      return;
    }

    const teamRank = TEAM_ROLE_CONFIG[rank.teamKey];
    if (!teamRank) {
      await interaction.editReply(`❌ Missing Discord role config for **${rank.display}**.`);
      return;
    }

    const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.editReply('❌ I need the **Manage Roles** permission to update roles.');
      return;
    }

    const staffUsername = cleanStaffUsernameFromMember(target);
    if (!staffUsername) {
      await interaction.editReply('❌ I could not read that member’s server username/nickname.');
      return;
    }

    const date = getTodayMmDdYyyy();
    const prettyDate = formatPrettyDate(date);
    const dueDate = formatDueNextMonth(date);

    if (!prettyDate || !dueDate) {
      await interaction.editReply('❌ Could not build today’s Staff Journey date.');
      return;
    }

    try {
      const card = await findStaffCardByUsername(staffUsername);
      if (!card) {
        await interaction.editReply(`❌ I could not find a Staff Journey card named **${staffUsername} - MM/DD/YYYY**.`);
        return;
      }

      const teamRemoveIds = TEAM_REMOVE_KEYS.flatMap(configuredIdsForKey);
      const ticketRemoveIds = envIds(TICKET_REMOVE_ENV_NAMES);

      const teamRolesToRemove = target.roles.cache.filter((role) =>
        teamRemoveIds.includes(role.id) || roleMatches(role, TEAM_REMOVE_MATCHERS, { requireTeam: true }),
      );

      const ticketRolesToRemove = target.roles.cache.filter((role) =>
        ticketRemoveIds.includes(role.id) || roleMatches(role, TICKET_REMOVE_MATCHERS),
      );

      let targetTeamRoles = findRolesByIdsAndNames(
        interaction.guild,
        configuredIdsForKey(teamRank.teamIdsKey),
        teamRank.teamNameMatchers,
        { requireTeam: true },
      );

      if (Array.isArray(teamRank.excludeTargetKeywords) && teamRank.excludeTargetKeywords.length) {
        targetTeamRoles = targetTeamRoles.filter((role) => {
          const name = normalizeName(role.name);
          return !teamRank.excludeTargetKeywords.some((keyword) => name.includes(keyword));
        });
      }

      const targetTicketRoles = findRolesByIdsAndNames(
        interaction.guild,
        envIds(teamRank.ticketEnvNames),
        teamRank.ticketNameMatchers,
      );

      if (!targetTeamRoles.length) {
        await interaction.editReply(
          `❌ I could not find the **${teamRank.label} Team** role. Add the role ID in \`src/config/roles.js\` or make sure the role name includes “${teamRank.label} Team”.`,
        );
        return;
      }

      if (!targetTicketRoles.length) {
        await interaction.editReply(
          `❌ I could not find the **${teamRank.ticketLabel}** role. Add the matching env var (${teamRank.ticketEnvNames.join(' or ')}) or make sure the Discord role is named **${teamRank.ticketLabel}**.`,
        );
        return;
      }

      const removeRoles = uniqueRoles([...teamRolesToRemove.values(), ...ticketRolesToRemove.values()])
        .filter((role) => !targetTeamRoles.some((targetRole) => targetRole.id === role.id))
        .filter((role) => !targetTicketRoles.some((targetRole) => targetRole.id === role.id));

      const addRoles = uniqueRoles([...targetTeamRoles, ...targetTicketRoles]);

      const manageableProblem = [...removeRoles, ...addRoles].find(
        (role) => role.managed || role.position >= botMember.roles.highest.position,
      );

      if (manageableProblem) {
        await interaction.editReply(
          `❌ I cannot manage **${manageableProblem.name}**. Move my bot role above that role in the role list, then try again.`,
        );
        return;
      }

      // 1) Discord roles
      const reason = `/promotion used by ${interaction.user.tag} (${interaction.user.id})`;
      if (removeRoles.length) await target.roles.remove(removeRoles, reason);
      await target.roles.add(addRoles, reason);

      // 2) Trello staff card
      const updatedDesc = rebuildDescriptionForPromotion(card.desc || '', prettyDate, rank.display, date);

      await trelloPut(`https://api.trello.com/1/cards/${card.id}`, {
        idList: rank.listId,
        due: dueDate,
        desc: updatedDesc,
        pos: 'bottom',
      });

      await removeOldJourneyLabels(card);
      await addLabelIfPresent(card.id, rank.rankLabel);
      await addLabelIfPresent(card.id, rank.teamLabel);
      await addLabelIfPresent(card.id, process.env.LABEL_RECENTLY_PROMOTED);

      await trelloPost(`https://api.trello.com/1/cards/${card.id}/actions/comments`, {
        text: `Promoted to **${rank.display}** by **${promoter}**`,
      });

      // 3) Promoter count card
      let promoterNote = '';
      const promoterCard = await findPromoterCard(promoter);
      if (promoterCard) {
        await trelloPost(`https://api.trello.com/1/cards/${promoterCard.id}/actions/comments`, {
          text: `${staffUsername} - ${rank.display}`,
        });
        const commentCount = await countComments(promoterCard.id);
        await trelloPut(`https://api.trello.com/1/cards/${promoterCard.id}`, {
          name: buildPromoterCardName(promoterCard.name, commentCount),
        });
        promoterNote = `\n✅ Updated promoter count card to **${commentCount}**.`;
      } else {
        promoterNote = `\n⚠️ Promoted successfully, but I could not find a promoter count card for **${promoter}**.`;
      }

      await interaction.editReply(
        [
          `✅ Promoted ${target} to **${rank.display}**.`,
          '',
          `Staff Journey card: **${card.name}**`,
          `Removed old team/ticket roles: ${roleMentionList(removeRoles)}`,
          `Added team role: ${roleMentionList(targetTeamRoles)}`,
          `Added ticket role: ${roleMentionList(targetTicketRoles)}`,
          promoterNote,
        ].join('\n'),
      );
    } catch (err) {
      console.error('[PROMOTION ERROR]', err.response?.data || err.message || err);
      await interaction.editReply('❌ Promotion error while updating Discord/Trello. Check Render logs for details.');
    }
  },
};
