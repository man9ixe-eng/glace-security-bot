const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const axios = require("axios");
const rolesConfig = require("../../config/roles");

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const BOARD_ID = process.env.STAFF_JOURNEY_BOARD_ID;
const RESIGNATIONS_LIST_ID_ENV =
  process.env.RESIGNATION_LIST_ID ||
  process.env.RESIGNATIONS_LIST_ID ||
  process.env.RESIGNITIONS_LIST_ID;
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
  process.env.LABEL_BOARD_OF_DIRECTOR,
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
  "JUNIOR_STAFF_ROLE_IDS",
  "INTERN_ROLE_IDS",
  "MANAGEMENT_ROLE_IDS",
  "SENIOR_MANAGEMENT_ROLE_IDS",
  "CORPORATE_ROLE_IDS",
  "CORPORATE_BOARD_ROLE_IDS",
  "PRESIDENTIAL_ROLE_IDS",
];

const STAFF_ROLE_MATCHERS = [
  ["junior", "staff"],
  ["intern"],
  ["management"],
  ["senior", "management"],
  ["corporate"],
  ["corporate", "board"],
  ["board", "director"],
  ["presidential"],
];

const TICKET_REMOVE_ENV_NAMES = [
  "TICKET_ROLE_INTERN_ID",
  "TICKET_ROLE_TRIAL_ID",
  "TICKET_ROLE_MOD_ID",
  "TICKET_ROLE_ADMIN_ID",
  "TICKET_ROLE_REVIEWER_ID",
  "TICKET_ROLE_CHIEF_ID",
];

const TICKET_REMOVE_MATCHERS = [
  ["ticket", "intern"],
  ["ticket", "trial"],
  ["ticket", "mod"],
  ["ticket", "moderator"],
  ["ticket", "admin"],
  ["ticket", "reviewer"],
  ["ticket", "chief"],
];

const SENIOR_PLUS_RANKS = new Set([
  "executive manager",
  "corporate intern",
  "junior corporate",
  "senior corporate",
  "head corporate",
  "board of director",
  "board of directors",
  "presidential intern",
  "chief executive officer",
  "vice president",
  "president",
]);


function isUnknownInteractionError(err) {
  return err?.code === 10062 || String(err?.message || "").toLowerCase().includes("unknown interaction");
}

async function ensureDeferred(interaction) {
  if (interaction.deferred || interaction.replied) return true;

  try {
    await interaction.deferReply({ ephemeral: true });
    return true;
  } catch (err) {
    if (isUnknownInteractionError(err)) {
      console.warn(`[${String(interaction.commandName || "STAFF").toUpperCase()}] Interaction expired before the bot could defer. Continuing safely without an interaction reply.`);
      return false;
    }

    throw err;
  }
}

async function safeEditReply(interaction, content) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(content);
      return;
    }

    if (typeof content === "string") {
      await interaction.reply({ content, ephemeral: true });
      return;
    }

    await interaction.reply({ ...content, ephemeral: true });
  } catch (err) {
    if (isUnknownInteractionError(err)) {
      console.warn(`[${String(interaction.commandName || "STAFF").toUpperCase()}] Could not send the Discord reply because the interaction expired.`);
      return;
    }

    console.error(`[${String(interaction.commandName || "STAFF").toUpperCase()}] Could not send interaction reply:`, err.response?.data || err.message || err);
  }
}

// =========================
// DATE HELPERS
// =========================
function getTodayMmDdYyyy() {
  return new Date().toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
}

function parseMmDdYyyy(dateStr) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(String(dateStr || ""))) return null;
  const [mm, dd, yyyy] = dateStr.split("/").map(Number);
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
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
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

// =========================
// TEXT HELPERS
// =========================
function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/<a?:\w+:\d+>/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanUsername(value) {
  return String(value || "")
    .replace(/^\s*\[\s*LOA\s*\]\s*/i, "")
    .replace(/^\s*LOA\s*[-|:]\s*/i, "")
    .trim();
}

function normalizeLines(desc) {
  if (!desc || typeof desc !== "string") return [];
  return desc.split("\n").map((line) => line.trim()).filter(Boolean);
}

function parseJourneyLine(line) {
  const match = String(line || "").match(/^- \*\*(.+?) - (.+?)(?: - (.+?))?\*\*$/);
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
  return "Unknown Rank";
}

function timeSinceFirstPromotion(desc, resignationDateStr) {
  const firstParsed = getFirstJourneyLine(desc);
  if (!firstParsed?.startDate) return "Unknown duration";

  const start = new Date(firstParsed.startDate);
  const end = localNoonFromMmDdYyyy(resignationDateStr);

  if (Number.isNaN(start.getTime()) || !end) return "Unknown duration";

  let months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth());

  if (end.getDate() < start.getDate()) months -= 1;

  if (months >= 1) return months === 1 ? "1 month" : `${months} months`;

  let days = Math.floor((end - start) / (1000 * 60 * 60 * 24));
  if (days < 1) days = 1;
  return days === 1 ? "1 day" : `${days} days`;
}

function appendResignationToDescription(desc, prettyDate, finalRank, sinceFirst) {
  const lines = normalizeLines(desc);

  const alreadyHasResignation = lines.some((line) => normalizeName(line).startsWith("resigned"));
  if (alreadyHasResignation) return lines.join("\n");

  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━━");
  lines.push(`**Resigned:** ${prettyDate}`);
  lines.push(`**Final Rank:** ${finalRank}`);
  lines.push(`**Total Time:** ${sinceFirst}`);
  return lines.join("\n");
}

function extractCardUsername(cardName) {
  const raw = String(cardName || "").trim();

  const enrolledFormat = raw.match(/^(.+?)\s+-\s+\d{2}\/\d{2}\/\d{4}\s*$/);
  if (enrolledFormat) return enrolledFormat[1].trim();

  const resignedFormat = raw.match(/^(.+?)\s+-\s+.+?\s+-\s+\d{2}\/\d{2}\/\d{4}\s*$/);
  if (resignedFormat) return resignedFormat[1].trim();

  return raw.split(" - ")[0].trim();
}

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

function roleMatches(role, matchers, { requireTeam = false } = {}) {
  const name = normalizeName(role?.name);
  if (!name) return false;
  if (name.includes("former") || name.includes("retired") || name.includes("alumni") || name.includes("resigned")) return false;
  if (requireTeam && !name.includes("team")) return false;
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

function findRoleByIdOrName(guild, envNames, nameMatchers) {
  const names = Array.isArray(envNames) ? envNames : [envNames];

  for (const envName of names) {
    const id = process.env[envName];
    if (!id) continue;
    const byId = guild.roles.cache.get(id);
    if (byId) return byId;
  }

  return (
    guild.roles.cache.find((role) => {
      const name = normalizeName(role.name);
      return nameMatchers.some((keywords) => keywords.every((keyword) => name.includes(keyword)));
    }) || null
  );
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

  return (
    fetched.find((member) => {
      const display = normalizeName(cleanUsername(member.displayName));
      const user = normalizeName(member.user?.username);
      const global = normalizeName(member.user?.globalName);
      return display === target || user === target || global === target;
    }) || null
  );
}

async function updateDiscordResignationRoles(interaction, member, seniorPlus) {
  if (!member) return "⚠️ Discord member not found, so I only updated Trello.";

  const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return "⚠️ I updated Trello, but I need **Manage Roles** to update Discord roles.";
  }

  const finalRole = seniorPlus
    ? findRoleByIdOrName(interaction.guild, ["FORMER_EMPLOYEE_ROLE_ID"], [["former", "employee"]])
    : findRoleByIdOrName(interaction.guild, ["RESIGNED_ROLE_ID"], [["resigned"]]);

  if (!finalRole) {
    return seniorPlus
      ? "⚠️ I updated Trello, but I could not find the **Former Employee** role."
      : "⚠️ I updated Trello, but I could not find the **Resigned** role.";
  }

  const staffRoleIds = STAFF_ROLE_KEYS.flatMap(configuredIdsForKey);
  const ticketRoleIds = envIds(TICKET_REMOVE_ENV_NAMES);

  const staffRolesToRemove = member.roles.cache.filter((role) =>
    staffRoleIds.includes(role.id) || roleMatches(role, STAFF_ROLE_MATCHERS, { requireTeam: true })
  );

  const ticketRolesToRemove = member.roles.cache.filter((role) =>
    ticketRoleIds.includes(role.id) || roleMatches(role, TICKET_REMOVE_MATCHERS)
  );

  const rolesToRemove = uniqueRoles([...staffRolesToRemove.values(), ...ticketRolesToRemove.values()])
    .filter((role) => role.id !== finalRole.id);

  const manageableProblem = [...rolesToRemove, finalRole].find(
    (role) => role.managed || role.position >= botMember.roles.highest.position
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
  return axios.get(url, {
    params: {
      key: TRELLO_KEY,
      token: TRELLO_TOKEN,
      ...params,
    },
  });
}

async function trelloPut(url, params = {}) {
  return axios.put(url, null, {
    params: {
      key: TRELLO_KEY,
      token: TRELLO_TOKEN,
      ...params,
    },
  });
}

async function trelloPost(url, params = {}) {
  return axios.post(url, null, {
    params: {
      key: TRELLO_KEY,
      token: TRELLO_TOKEN,
      ...params,
    },
  });
}

async function trelloDelete(url, params = {}) {
  return axios.delete(url, {
    params: {
      key: TRELLO_KEY,
      token: TRELLO_TOKEN,
      ...params,
    },
  });
}

async function resolveResignationListId() {
  if (RESIGNATIONS_LIST_ID_ENV) return RESIGNATIONS_LIST_ID_ENV;

  const res = await trelloGet(`https://api.trello.com/1/boards/${BOARD_ID}/lists`, {
    fields: "id,name,closed",
  });

  const lists = (res.data || []).filter((list) => !list.closed);
  const found = lists.find((list) => ["resignation", "resignations"].includes(normalizeName(list.name)));

  return found?.id || null;
}

async function findStaffCardByUsername(username, resignationListId) {
  const res = await trelloGet(`https://api.trello.com/1/boards/${BOARD_ID}/cards`, {
    fields: "id,name,desc,idLabels,idList,closed,pos,due,url",
  });

  const lower = normalizeName(username);
  const openCards = (res.data || []).filter((card) => !card.closed);

  // Prefer active staff card first, but allow already-resigned card as a fallback.
  return (
    openCards.find((card) => normalizeName(extractCardUsername(card.name)) === lower && card.idList !== resignationListId) ||
    openCards.find((card) => normalizeName(extractCardUsername(card.name)) === lower) ||
    null
  );
}

async function removeOldLabels(card) {
  const labelsToRemove = (card.idLabels || []).filter(
    (id) =>
      ALL_RANK_LABELS.includes(id) ||
      ALL_TEAM_LABELS.includes(id) ||
      id === process.env.LABEL_RECENTLY_PROMOTED
  );

  for (const labelId of labelsToRemove) {
    await trelloDelete(`https://api.trello.com/1/cards/${card.id}/idLabels/${labelId}`);
  }
}

async function addLabelIfPresent(cardId, labelId) {
  if (!labelId) return;
  await trelloPost(`https://api.trello.com/1/cards/${cardId}/idLabels`, { value: labelId });
}

async function addCommentOnce(cardId, text) {
  const res = await trelloGet(`https://api.trello.com/1/cards/${cardId}/actions`, {
    filter: "commentCard",
    limit: 1000,
    fields: "data,type",
  });

  const exists = (res.data || []).some((action) => action?.data?.text?.trim() === text.trim());
  if (exists) return false;

  await trelloPost(`https://api.trello.com/1/cards/${cardId}/actions/comments`, { text });
  return true;
}

// =========================
// COMMAND
// =========================
module.exports = {
  data: new SlashCommandBuilder()
    .setName("resignation")
    .setDescription("Mark a staff member as resigned in Staff Journey")
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName("username")
        .setDescription("Staff Journey username")
        .setRequired(true)
    )
    .addUserOption((option) =>
      option
        .setName("member")
        .setDescription("Discord member to update, if needed")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("date")
        .setDescription("MM/DD/YYYY, defaults to today")
        .setRequired(false)
    ),

  async execute(interaction) {
    await ensureDeferred(interaction);

    const username = cleanUsername(interaction.options.getString("username", true));
    const providedMember = interaction.options.getMember("member");
    const date = interaction.options.getString("date") || getTodayMmDdYyyy();

    if (!TRELLO_KEY || !TRELLO_TOKEN || !BOARD_ID) {
      await safeEditReply(interaction, "❌ Missing TRELLO_KEY, TRELLO_TOKEN, or STAFF_JOURNEY_BOARD_ID env.");
      return;
    }

    const prettyDate = formatPrettyDate(date);
    const dueDate = formatDueNextMonth(date);

    if (!prettyDate || !dueDate) {
      await safeEditReply(interaction, "❌ Invalid date. Use MM/DD/YYYY.");
      return;
    }

    try {
      const resignationListId = await resolveResignationListId();
      if (!resignationListId) {
        await safeEditReply(interaction, "❌ I could not find the **RESIGNATION** Trello list. Add RESIGNATION_LIST_ID, RESIGNATIONS_LIST_ID, or RESIGNITIONS_LIST_ID in Render.");
        return;
      }

      const card = await findStaffCardByUsername(username, resignationListId);
      if (!card) {
        await safeEditReply(interaction, "❌ Oops, it seems you have not used the /enroll command.");
        return;
      }

      const finalRank = getCurrentRank(card.desc || "");
      const seniorPlus = SENIOR_PLUS_RANKS.has(normalizeName(finalRank));
      const sinceFirst = timeSinceFirstPromotion(card.desc || "", date);
      const member = providedMember || await findGuildMemberByStaffUsername(interaction.guild, username);
      const discordNote = await updateDiscordResignationRoles(interaction, member, seniorPlus);

      const updatedDesc = appendResignationToDescription(card.desc || "", prettyDate, finalRank, sinceFirst);
      const resignationCardName = `${username} - ${finalRank} - ${date}`;
      const commentText = `Resigned on ${prettyDate} - ${finalRank} - ${sinceFirst}`;

      await removeOldLabels(card);
      await addLabelIfPresent(card.id, LABEL_RECENTLY_RESIGNED);
      await addCommentOnce(card.id, commentText);

      await trelloPut(`https://api.trello.com/1/cards/${card.id}`, {
        idList: resignationListId,
        name: resignationCardName,
        due: dueDate,
        desc: updatedDesc,
        pos: "bottom",
      });

      await safeEditReply(interaction, 
        [
          `✅ Marked **${username}** as resigned.`,
          `Moved card to **RESIGNATION** as: **${resignationCardName}**`,
          `Final rank: **${finalRank}**`,
          `Time in journey: **${sinceFirst}**`,
          discordNote,
        ].join("\n")
      );
    } catch (err) {
      console.error("[RESIGNATION ERROR]", err.response?.data || err.message || err);
      await safeEditReply(interaction, "❌ Resignation Trello/Discord error. Check Render logs for details.");
    }
  },
};
