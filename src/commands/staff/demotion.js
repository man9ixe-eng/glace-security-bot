const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const axios = require("axios");
const rolesConfig = require("../../config/roles");

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const BOARD_ID = process.env.STAFF_JOURNEY_BOARD_ID;

// =========================
// RANK CONFIG
// =========================
const RANK_CONFIG = {
  "Leadership Intern": {
    listId: process.env.LEADERSHIP_INTERN_LIST_ID,
    rankLabel: process.env.LABEL_LEADERSHIP_INTERN,
    teamLabel: process.env.LABEL_INTERN,
    teamKey: "intern",
  },
  "Supervisor": {
    listId: process.env.SUPERVISOR_LIST_ID,
    rankLabel: process.env.LABEL_SUPERVISOR,
    teamLabel: process.env.LABEL_MANAGEMENT,
    teamKey: "management",
  },
  "Assistant Manager": {
    listId: process.env.ASSISTANT_MANAGER_LIST_ID,
    rankLabel: process.env.LABEL_ASSISTANT_MANAGER,
    teamLabel: process.env.LABEL_MANAGEMENT,
    teamKey: "management",
  },
  "Hotel Manager": {
    listId: process.env.HOTEL_MANAGER_LIST_ID,
    rankLabel: process.env.LABEL_HOTEL_MANAGER,
    teamLabel: process.env.LABEL_MANAGEMENT,
    teamKey: "management",
  },
  "Executive Manager": {
    listId: process.env.EXECUTIVE_MANAGER_LIST_ID,
    rankLabel: process.env.LABEL_EXECUTIVE_MANAGER,
    teamLabel: process.env.LABEL_SENIOR_MANAGEMENT,
    teamKey: "senior_management",
  },
  "Corporate Intern": {
    listId: process.env.CORPORATE_INTERN_LIST_ID,
    rankLabel: process.env.LABEL_CORPORATE_INTERN,
    teamLabel: process.env.LABEL_SENIOR_MANAGEMENT,
    teamKey: "senior_management",
  },
  "Junior Corporate": {
    listId: process.env.JUNIOR_CORPORATE_LIST_ID,
    rankLabel: process.env.LABEL_JUNIOR_CORPORATE,
    teamLabel: process.env.LABEL_CORPORATE,
    teamKey: "corporate",
  },
  "Senior Corporate": {
    listId: process.env.SENIOR_CORPORATE_LIST_ID,
    rankLabel: process.env.LABEL_SENIOR_CORPORATE,
    teamLabel: process.env.LABEL_CORPORATE,
    teamKey: "corporate",
  },
  "Head Corporate": {
    listId: process.env.HEAD_CORPORATE_LIST_ID,
    rankLabel: process.env.LABEL_HEAD_CORPORATE,
    teamLabel: process.env.LABEL_CORPORATE,
    teamKey: "corporate",
  },
  "Board Of Director": {
    listId: process.env.BOARD_OF_DIRECTOR_LIST_ID || process.env.BOARD_OF_DIRECTORS_LIST_ID,
    rankLabel: process.env.LABEL_BOARD_OF_DIRECTOR || process.env.LABEL_BOARD_OF_DIRECTORS,
    teamLabel: process.env.LABEL_CORPORATE_BOARD,
    teamKey: "corporate_board",
  },
  "Presidential Intern": {
    listId: process.env.PRESIDENTIAL_INTERN_LIST_ID,
    rankLabel: process.env.LABEL_PRESIDENTIAL_INTERN,
    teamLabel: process.env.LABEL_CORPORATE_BOARD,
    teamKey: "corporate_board",
  },
  "Chief Executive Officer": {
    listId: process.env.CHIEF_EXECUTIVE_OFFICER_LIST_ID,
    rankLabel: process.env.LABEL_CHIEF_EXECUTIVE_OFFICER,
    teamLabel: process.env.LABEL_PRESIDENTIAL,
    teamKey: "presidential",
  },
  "Vice President": {
    listId: process.env.VICE_PRESIDENT_LIST_ID,
    rankLabel: process.env.LABEL_VICE_PRESIDENT,
    teamLabel: process.env.LABEL_PRESIDENTIAL,
    teamKey: "presidential",
  },
  "President": {
    listId: process.env.PRESIDENT_LIST_ID,
    rankLabel: process.env.LABEL_PRESIDENT,
    teamLabel: process.env.LABEL_PRESIDENTIAL,
    teamKey: "presidential",
  },
};

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

const TEAM_ROLE_CONFIG = {
  intern: {
    label: "Intern",
    teamIdsKey: "INTERN_ROLE_IDS",
    teamNameMatchers: [["intern"]],
    excludeTargetKeywords: ["corporate"],
    ticketLabel: "Ticket Intern",
    ticketEnvNames: ["TICKET_ROLE_INTERN_ID", "TICKET_ROLE_TRIAL_ID"],
    ticketNameMatchers: [["ticket", "intern"], ["ticket", "trial"]],
  },
  management: {
    label: "Management",
    teamIdsKey: "MANAGEMENT_ROLE_IDS",
    teamNameMatchers: [["management"]],
    excludeTargetKeywords: ["senior"],
    ticketLabel: "Ticket Mod",
    ticketEnvNames: ["TICKET_ROLE_MOD_ID"],
    ticketNameMatchers: [["ticket", "mod"], ["ticket", "moderator"]],
  },
  senior_management: {
    label: "Senior Management",
    teamIdsKey: "SENIOR_MANAGEMENT_ROLE_IDS",
    teamNameMatchers: [["senior", "management"]],
    ticketLabel: "Ticket Admin",
    ticketEnvNames: ["TICKET_ROLE_ADMIN_ID"],
    ticketNameMatchers: [["ticket", "admin"]],
  },
  corporate: {
    label: "Corporate",
    teamIdsKey: "CORPORATE_ROLE_IDS",
    teamNameMatchers: [["corporate"]],
    excludeTargetKeywords: ["intern", "board", "director"],
    ticketLabel: "Ticket Reviewer",
    ticketEnvNames: ["TICKET_ROLE_REVIEWER_ID"],
    ticketNameMatchers: [["ticket", "reviewer"]],
  },
  corporate_board: {
    label: "Corporate Board",
    teamIdsKey: "CORPORATE_BOARD_ROLE_IDS",
    teamNameMatchers: [["corporate", "board"], ["board", "director"]],
    ticketLabel: "Ticket Chief",
    ticketEnvNames: ["TICKET_ROLE_CHIEF_ID"],
    ticketNameMatchers: [["ticket", "chief"]],
  },
  presidential: {
    label: "Presidential",
    teamIdsKey: "PRESIDENTIAL_ROLE_IDS",
    teamNameMatchers: [["presidential"]],
    excludeTargetKeywords: ["intern"],
    ticketLabel: "Ticket Chief",
    ticketEnvNames: ["TICKET_ROLE_CHIEF_ID"],
    ticketNameMatchers: [["ticket", "chief"]],
  },
};

const TEAM_REMOVE_KEYS = [
  "JUNIOR_STAFF_ROLE_IDS",
  "INTERN_ROLE_IDS",
  "MANAGEMENT_ROLE_IDS",
  "SENIOR_MANAGEMENT_ROLE_IDS",
  "CORPORATE_ROLE_IDS",
  "CORPORATE_BOARD_ROLE_IDS",
  "PRESIDENTIAL_ROLE_IDS",
];

const TEAM_REMOVE_MATCHERS = [
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

// =========================
// HELPERS
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

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/<a?:\w+:\d+>/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

function roleMentionList(roles) {
  return roles.length ? roles.map((role) => `<@&${role.id}>`).join(", ") : "None";
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

function rebuildDescriptionForDemotion(desc, newPrettyDate, newRank) {
  const lines = normalizeLines(desc);

  if (lines.length === 0) {
    return `- **${newPrettyDate} - ${newRank}**`;
  }

  const parsedLast = parseJourneyLine(lines[lines.length - 1]);

  // Remove current active public line so the new rank becomes the active line.
  if (parsedLast && !parsedLast.duration) {
    lines.pop();
  }

  lines.push(`- **${newPrettyDate} - ${newRank}**`);
  return lines.join("\n");
}

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

function extractCardUsername(cardName) {
  const raw = String(cardName || "").trim();

  const enrolledFormat = raw.match(/^(.+?)\s+-\s+\d{2}\/\d{2}\/\d{4}\s*$/);
  if (enrolledFormat) return enrolledFormat[1].trim();

  const resignedFormat = raw.match(/^(.+?)\s+-\s+.+?\s+-\s+\d{2}\/\d{2}\/\d{4}\s*$/);
  if (resignedFormat) return resignedFormat[1].trim();

  return raw.split(" - ")[0].trim();
}

async function findStaffCardByUsername(username) {
  const res = await trelloGet(`https://api.trello.com/1/boards/${BOARD_ID}/cards`, {
    fields: "id,name,desc,idLabels,idList,closed,pos",
  });

  const lower = normalizeName(username);

  return (
    (res.data || []).find((card) => !card.closed && normalizeName(extractCardUsername(card.name)) === lower) ||
    null
  );
}

async function updateDiscordTeamAndTicketRoles(interaction, member, rankConfig) {
  const teamRank = TEAM_ROLE_CONFIG[rankConfig.teamKey];
  if (!teamRank) {
    return { ok: false, message: `❌ Missing Discord role config for **${rankConfig.teamKey}**.` };
  }

  const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { ok: false, message: "❌ I need the **Manage Roles** permission to update Discord roles." };
  }

  const teamRemoveIds = TEAM_REMOVE_KEYS.flatMap(configuredIdsForKey);
  const ticketRemoveIds = envIds(TICKET_REMOVE_ENV_NAMES);

  const teamRolesToRemove = member.roles.cache.filter((role) =>
    teamRemoveIds.includes(role.id) || roleMatches(role, TEAM_REMOVE_MATCHERS, { requireTeam: true })
  );

  const ticketRolesToRemove = member.roles.cache.filter((role) =>
    ticketRemoveIds.includes(role.id) || roleMatches(role, TICKET_REMOVE_MATCHERS)
  );

  let targetTeamRoles = findRolesByIdsAndNames(
    interaction.guild,
    configuredIdsForKey(teamRank.teamIdsKey),
    teamRank.teamNameMatchers,
    { requireTeam: true }
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
    teamRank.ticketNameMatchers
  );

  if (!targetTeamRoles.length) {
    return {
      ok: false,
      message: `❌ I could not find the **${teamRank.label} Team** role. Add the role ID in \`src/config/roles.js\` or make sure the role name includes “${teamRank.label} Team”.`,
    };
  }

  if (!targetTicketRoles.length) {
    return {
      ok: false,
      message: `❌ I could not find the **${teamRank.ticketLabel}** role. Add the matching env var (${teamRank.ticketEnvNames.join(" or ")}) or make sure the Discord role is named **${teamRank.ticketLabel}**.`,
    };
  }

  const removeRoles = uniqueRoles([...teamRolesToRemove.values(), ...ticketRolesToRemove.values()])
    .filter((role) => !targetTeamRoles.some((targetRole) => targetRole.id === role.id))
    .filter((role) => !targetTicketRoles.some((targetRole) => targetRole.id === role.id));

  const addRoles = uniqueRoles([...targetTeamRoles, ...targetTicketRoles]);

  const manageableProblem = [...removeRoles, ...addRoles].find(
    (role) => role.managed || role.position >= botMember.roles.highest.position
  );

  if (manageableProblem) {
    return {
      ok: false,
      message: `❌ I cannot manage **${manageableProblem.name}**. Move my bot role above that role in the role list, then try again.`,
    };
  }

  const reason = `/add-demotion used by ${interaction.user.tag} (${interaction.user.id})`;
  if (removeRoles.length) await member.roles.remove(removeRoles, reason);
  await member.roles.add(addRoles, reason);

  return {
    ok: true,
    removeRoles,
    targetTeamRoles,
    targetTicketRoles,
  };
}

// =========================
// COMMAND
// =========================
module.exports = {
  data: new SlashCommandBuilder()
    .setName("add-demotion")
    .setDescription("Demote a staff member in Staff Journey and update Discord roles")
    .addStringOption((o) =>
      o.setName("username").setDescription("Staff Journey username").setRequired(true)
    )
    .addStringOption((o) => {
      o.setName("rank").setDescription("New rank").setRequired(true);

      for (const rankName of Object.keys(RANK_CONFIG)) {
        o.addChoices({ name: rankName, value: rankName });
      }

      return o;
    })
    .addUserOption((o) =>
      o.setName("member").setDescription("Discord user to update team/ticket roles for").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("date").setDescription("MM/DD/YYYY, defaults to today").setRequired(false)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const username = interaction.options.getString("username", true).trim();
    const newRank = interaction.options.getString("rank", true);
    const member = interaction.options.getMember("member");
    const date = interaction.options.getString("date") || getTodayMmDdYyyy();

    const rankConfig = RANK_CONFIG[newRank];

    if (!TRELLO_KEY || !TRELLO_TOKEN || !BOARD_ID) {
      await interaction.editReply("❌ Missing TRELLO_KEY, TRELLO_TOKEN, or STAFF_JOURNEY_BOARD_ID env.");
      return;
    }

    if (!member || !rankConfig) {
      await interaction.editReply("❌ I could not find that Discord member or rank.");
      return;
    }

    if (!rankConfig.listId || !rankConfig.rankLabel || !rankConfig.teamLabel) {
      await interaction.editReply(`❌ Missing env vars for **${newRank}**.`);
      return;
    }

    const prettyDate = formatPrettyDate(date);
    const dueDate = formatDueNextMonth(date);

    if (!prettyDate || !dueDate) {
      await interaction.editReply("❌ Invalid date. Use MM/DD/YYYY.");
      return;
    }

    try {
      const card = await findStaffCardByUsername(username);

      if (!card) {
        await interaction.editReply("❌ Oops, it seems you have not used the /enroll command.");
        return;
      }

      const roleResult = await updateDiscordTeamAndTicketRoles(interaction, member, rankConfig);
      if (!roleResult.ok) {
        await interaction.editReply(roleResult.message);
        return;
      }

      const updatedDesc = rebuildDescriptionForDemotion(card.desc || "", prettyDate, newRank);

      await trelloPut(`https://api.trello.com/1/cards/${card.id}`, {
        idList: rankConfig.listId,
        due: dueDate,
        desc: updatedDesc,
        pos: "bottom",
      });

      const labelsToRemove = (card.idLabels || []).filter(
        (id) => ALL_RANK_LABELS.includes(id) || ALL_TEAM_LABELS.includes(id)
      );

      for (const labelId of labelsToRemove) {
        await trelloDelete(`https://api.trello.com/1/cards/${card.id}/idLabels/${labelId}`);
      }

      await trelloPost(`https://api.trello.com/1/cards/${card.id}/idLabels`, {
        value: rankConfig.rankLabel,
      });

      await trelloPost(`https://api.trello.com/1/cards/${card.id}/idLabels`, {
        value: rankConfig.teamLabel,
      });

      await interaction.editReply(
        [
          `✅ Updated **${username}** to **${newRank}**.`,
          `Discord member: ${member}`,
          `Removed old team/ticket roles: ${roleMentionList(roleResult.removeRoles)}`,
          `Added team role: ${roleMentionList(roleResult.targetTeamRoles)}`,
          `Added ticket role: ${roleMentionList(roleResult.targetTicketRoles)}`,
        ].join("\n")
      );
    } catch (err) {
      console.error("[DEMOTION ERROR]", err.response?.data || err.message || err);
      await interaction.editReply("❌ Demotion Trello/Discord error. Check Render logs for details.");
    }
  },
};
