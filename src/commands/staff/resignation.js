// src/commands/staff/resignation.js
// /resignation — Staff Journey resignation automation + Discord former/resigned role.

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const axios = require('axios');
const rolesConfig = require('../../config/roles');

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const BOARD_ID = process.env.STAFF_JOURNEY_BOARD_ID;
const RESIGNATIONS_LIST_ID = process.env.RESIGNITIONS_LIST_ID;
const LABEL_RECENTLY_RESIGNED = process.env.LABEL_RECENTLY_RESIGNED;

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

const STAFF_ROLE_KEYS = [
  'JUNIOR_STAFF_ROLE_IDS',
  'INTERN_ROLE_IDS',
  'MANAGEMENT_ROLE_IDS',
  'SENIOR_MANAGEMENT_ROLE_IDS',
  'CORPORATE_ROLE_IDS',
  'CORPORATE_BOARD_ROLE_IDS',
  'PRESIDENTIAL_ROLE_IDS',
];

const STAFF_ROLE_MATCHERS = [
  ['junior', 'staff'],
  ['intern'],
  ['management'],
  ['senior', 'management'],
  ['corporate'],
  ['corporate', 'board'],
  ['board', 'director'],
  ['presidential'],
  ['ticket', 'intern'],
  ['ticket', 'trial'],
  ['ticket', 'mod'],
  ['ticket', 'moderator'],
  ['ticket', 'admin'],
  ['ticket', 'reviewer'],
  ['ticket', 'chief'],
];

const TICKET_REMOVE_ENV_NAMES = [
  'TICKET_ROLE_INTERN_ID',
  'TICKET_ROLE_TRIAL_ID',
  'TICKET_ROLE_MOD_ID',
  'TICKET_ROLE_ADMIN_ID',
  'TICKET_ROLE_REVIEWER_ID',
  'TICKET_ROLE_CHIEF_ID',
];

const SENIOR_PLUS_RANKS = new Set([
  'executive manager',
  'corporate intern',
  'junior corporate',
  'senior corporate',
  'head corporate',
  'board of director',
  'board of directors',
  'presidential intern',
  'chief executive officer',
  'vice president',
  'president',
]);

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

function getFirstJourneyLine(desc) {
  for (const line of normalizeLines(desc)) {
    const parsed = parseJourneyLine(line);
    if (parsed) return parsed;
  }
  return null;
}

function getCurrentRank(desc) {
  const lines = normalizeLines(desc);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const parsed = parseJourneyLine(lines[i]);
    if (parsed?.rank) return parsed.rank;
  }
  return 'Unknown Rank';
}

function timeSinceFirstPromotion(desc, resignationDateStr) {
  const firstParsed = getFirstJourneyLine(desc);
  if (!firstParsed?.startDate) return 'Unknown duration';

  const start = new Date(firstParsed.startDate);
  const end = localNoonFromMmDdYyyy(resignationDateStr);

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

function appendResignationToDescription(desc, prettyDate, finalRank, sinceFirst) {
  const lines = normalizeLines(desc);
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push(`**Resigned:** ${prettyDate}`);
  lines.push(`**Final Rank:** ${finalRank}`);
  lines.push(`**Total Time:** ${sinceFirst}`);
  return lines.join('\n');
}

// =========================
// DISCORD HELPERS
// =========================
function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/<a?:\w+:\d+>/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanUsername(value) {
  return String(value || '')
    .replace(/^\s*\[\s*LOA\s*\]\s*/i, '')
    .replace(/^\s*LOA\s*[-|:]\s*/i, '')
    .trim();
}

function configuredIdsForKey(key) {
  const value = rolesConfig[key];
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [];
}

function envIds(names = []) {
  return names.map((name) => process.env[name]).filter(Boolean).map(String);
}

function roleMatches(role, matchers) {
  const name = normalizeName(role?.name);
  if (!name) return false;
  if (name.includes('former') || name.includes('retired') || name.includes('alumni') || name.includes('resigned')) return false;
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

function findRoleByIdOrName(guild, envName, nameMatchers) {
  const id = process.env[envName];
  if (id) {
    const byId = guild.roles.cache.get(id);
    if (byId) return byId;
  }

  return guild.roles.cache.find((role) => {
    const name = normalizeName(role.name);
    return nameMatchers.some((keywords) => keywords.every((keyword) => name.includes(keyword)));
  }) || null;
}

async function findGuildMemberByStaffUsername(guild, username) {
  const target = normalizeName(username);
  if (!target) return null;

  const cached = guild.members.cache.find((member) => {
    const display = normalizeName(cleanUsername(member.displayName));
    const user = normalizeName(member.user?.username);
    const global = normalizeName(member.user?.globalName);
    return display === target || user === target || global === target;
  });
  if (cached) return cached;

  const fetched = await guild.members.fetch({ query: username, limit: 10 }).catch(() => null);
  if (!fetched) return null;

  return fetched.find((member) => {
    const display = normalizeName(cleanUsername(member.displayName));
    const user = normalizeName(member.user?.username);
    const global = normalizeName(member.user?.globalName);
    return display === target || user === target || global === target;
  }) || null;
}

async function updateDiscordResignationRoles(interaction, member, seniorPlus) {
  if (!member) return '⚠️ Discord member not found, so I only updated Trello.';

  const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return '⚠️ I updated Trello, but I need **Manage Roles** to update Discord roles.';
  }

  const finalRole = seniorPlus
    ? findRoleByIdOrName(interaction.guild, 'FORMER_EMPLOYEE_ROLE_ID', [['former', 'employee']])
    : findRoleByIdOrName(interaction.guild, 'RESIGNED_ROLE_ID', [['resigned']]);

  if (!finalRole) {
    return seniorPlus
      ? '⚠️ I updated Trello, but I could not find the **Former Employee** role.'
      : '⚠️ I updated Trello, but I could not find the **Resigned** role.';
  }

  const staffRoleIds = STAFF_ROLE_KEYS.flatMap(configuredIdsForKey);
  const ticketRoleIds = envIds(TICKET_REMOVE_ENV_NAMES);

  const rolesToRemove = uniqueRoles(
    [...member.roles.cache.values()].filter((role) =>
      staffRoleIds.includes(role.id) || ticketRoleIds.includes(role.id) || roleMatches(role, STAFF_ROLE_MATCHERS),
    ),
  ).filter((role) => role.id !== finalRole.id);

  const manageableProblem = [...rolesToRemove, finalRole].find(
    (role) => role.managed || role.position >= botMember.roles.highest.position,
  );

  if (manageableProblem) {
    return `⚠️ I updated Trello, but I cannot manage **${manageableProblem.name}**. Move my bot role above it first.`;
  }

  const reason = `/resignation used by ${interaction.user.tag} (${interaction.user.id})`;
  if (rolesToRemove.length) await member.roles.remove(rolesToRemove, reason);
  await member.roles.add(finalRole, reason);

  return seniorPlus
    ? `✅ Discord updated: added **Former Employee** to ${member}.`
    : `✅ Discord updated: added **Resigned** to ${member}.`;
}

// =========================
// TRELLO HELPERS
// =========================
async function trelloGet(url, params = {}) {
  return axios.get(url, { params: { key: TRELLO_KEY, token: TRELLO_TOKEN, ...params } });
}

async function trelloPut(url, params = {}) {
  return axios.put(url, null, { params: { key: TRELLO_KEY, token: TRELLO_TOKEN, ...params } });
}

async function trelloPost(url, params = {}) {
  return axios.post(url, null, { params: { key: TRELLO_KEY, token: TRELLO_TOKEN, ...params } });
}

async function trelloDelete(url, params = {}) {
  return axios.delete(url, { params: { key: TRELLO_KEY, token: TRELLO_TOKEN, ...params } });
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
  const openCards = (res.data || []).filter((card) => !card.closed);

  return (
    openCards.find((card) => extractCardUsername(card.name).toLowerCase() === lower) ||
    openCards.find((card) => String(card.name || '').toLowerCase().startsWith(`${lower} - `)) ||
    null
  );
}

async function removeOldLabels(card) {
  const labelsToRemove = (card.idLabels || []).filter(
    (id) =>
      ALL_RANK_LABELS.includes(id) ||
      ALL_TEAM_LABELS.includes(id) ||
      id === process.env.LABEL_RECENTLY_PROMOTED,
  );

  for (const labelId of labelsToRemove) {
    await trelloDelete(`https://api.trello.com/1/cards/${card.id}/idLabels/${labelId}`);
  }
}

async function addLabelIfPresent(cardId, labelId) {
  if (!labelId) return;
  await trelloPost(`https://api.trello.com/1/cards/${cardId}/idLabels`, { value: labelId });
}

// =========================
// COMMAND
// =========================
module.exports = {
  data: new SlashCommandBuilder()
    .setName('resignation')
    .setDescription('Mark a staff member as resigned in Staff Journey.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('username')
        .setDescription('Staff username on the Staff Journey card')
        .setRequired(true),
    )
    .addUserOption((option) =>
      option
        .setName('member')
        .setDescription('Discord member, if their server nickname does not match')
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('date')
        .setDescription('MM/DD/YYYY, defaults to today')
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const username = cleanUsername(interaction.options.getString('username', true));
    const date = interaction.options.getString('date') || getTodayMmDdYyyy();
    const providedMember = interaction.options.getMember('member');

    if (!TRELLO_KEY || !TRELLO_TOKEN || !BOARD_ID) {
      await interaction.editReply('❌ Missing TRELLO_KEY, TRELLO_TOKEN, or STAFF_JOURNEY_BOARD_ID env.');
      return;
    }

    if (!RESIGNATIONS_LIST_ID || !LABEL_RECENTLY_RESIGNED) {
      await interaction.editReply('❌ Missing RESIGNITIONS_LIST_ID or LABEL_RECENTLY_RESIGNED env.');
      return;
    }

    const prettyDate = formatPrettyDate(date);
    const dueDate = formatDueNextMonth(date);

    if (!prettyDate || !dueDate) {
      await interaction.editReply('❌ Invalid date. Use MM/DD/YYYY.');
      return;
    }

    try {
      const card = await findStaffCardByUsername(username);
      if (!card) {
        await interaction.editReply('❌ Oops, it seems you have not used the /enroll command.');
        return;
      }

      const finalRank = getCurrentRank(card.desc || '');
      const seniorPlus = SENIOR_PLUS_RANKS.has(normalizeName(finalRank));
      const sinceFirst = timeSinceFirstPromotion(card.desc || '', date);
      const member = providedMember || await findGuildMemberByStaffUsername(interaction.guild, username);

      const discordNote = await updateDiscordResignationRoles(interaction, member, seniorPlus);

      await removeOldLabels(card);
      await addLabelIfPresent(card.id, LABEL_RECENTLY_RESIGNED);

      await trelloPost(`https://api.trello.com/1/cards/${card.id}/actions/comments`, {
        text: `Resigned on ${prettyDate} - ${finalRank} - ${sinceFirst}`,
      });

      if (seniorPlus) {
        const updatedDesc = appendResignationToDescription(card.desc || '', prettyDate, finalRank, sinceFirst);

        await trelloPut(`https://api.trello.com/1/cards/${card.id}`, {
          idList: RESIGNATIONS_LIST_ID,
          due: dueDate,
          desc: updatedDesc,
          pos: 'bottom',
        });
      } else {
        // Lower ranks do not need to stay on the resigned archive list.
        // Their card is removed from active Staff Journey by archiving it.
        await trelloPut(`https://api.trello.com/1/cards/${card.id}`, {
          closed: true,
        });
      }

      await interaction.editReply(
        [
          seniorPlus
            ? `✅ Marked **${username}** as resigned and moved their card to the resignations list.`
            : `✅ Marked **${username}** as resigned and archived their Staff Journey card.`,
          `Final rank: **${finalRank}**`,
          `Time in journey: **${sinceFirst}**`,
          discordNote,
        ].join('\n'),
      );
    } catch (err) {
      console.error('[RESIGNATION ERROR]', err.response?.data || err.message || err);
      await interaction.editReply('❌ Resignation Trello/Discord error. Check Render logs for details.');
    }
  },
};
