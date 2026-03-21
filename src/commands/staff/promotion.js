const { SlashCommandBuilder } = require("discord.js");
const axios = require("axios");

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const BOARD_ID = process.env.STAFF_JOURNEY_BOARD_ID;

// =========================
// RANK -> LIST / LABEL / TEAM
// Add more env vars as you create them
// =========================
const RANK_CONFIG = {
  "Leadership Intern": {
    listId: process.env.LEADERSHIP_INTERN_LIST_ID,
    rankLabel: process.env.LABEL_LEADERSHIP_INTERN,
    teamLabel: process.env.LABEL_INTERN,
  },
  Supervisor: {
    listId: process.env.SUPERVISOR_LIST_ID,
    rankLabel: process.env.LABEL_SUPERVISOR,
    teamLabel: process.env.LABEL_MANAGEMENT,
  },
  "Assistant Manager": {
    listId: process.env.ASSISTANT_MANAGER_LIST_ID,
    rankLabel: process.env.LABEL_ASSISTANT_MANAGER,
    teamLabel: process.env.LABEL_MANAGEMENT,
  },
  "Hotel Manager": {
    listId: process.env.HOTEL_MANAGER_LIST_ID,
    rankLabel: process.env.LABEL_HOTEL_MANAGER,
    teamLabel: process.env.LABEL_MANAGEMENT,
  },
  "Executive Manager": {
    listId: process.env.EXECUTIVE_MANAGER_LIST_ID,
    rankLabel: process.env.LABEL_EXECUTIVE_MANAGER,
    teamLabel: process.env.LABEL_SENIOR_MANAGEMENT,
  },
  "Corporate Intern": {
    listId: process.env.CORPORATE_INTERN_LIST_ID,
    rankLabel: process.env.LABEL_CORPORATE_INTERN,
    teamLabel: process.env.LABEL_SENIOR_MANAGEMENT,
  },
  "Junior Corporate": {
    listId: process.env.JUNIOR_CORPORATE_LIST_ID,
    rankLabel: process.env.LABEL_JUNIOR_CORPORATE,
    teamLabel: process.env.LABEL_CORPORATE,
  },
  "Senior Corporate": {
    listId: process.env.SENIOR_CORPORATE_LIST_ID,
    rankLabel: process.env.LABEL_SENIOR_CORPORATE,
    teamLabel: process.env.LABEL_CORPORATE,
  },
  "Head Corporate": {
    listId: process.env.HEAD_CORPORATE_LIST_ID,
    rankLabel: process.env.LABEL_HEAD_CORPORATE,
    teamLabel: process.env.LABEL_CORPORATE,
  },
  "Board Of Directors": {
    listId: process.env.BOARD_OF_DIRECTORS_LIST_ID,
    rankLabel: process.env.LABEL_BOARD_OF_DIRECTORS,
    teamLabel: process.env.LABEL_CORPORATE_BOARD,
  },
  "Presidential Intern": {
    listId: process.env.PRESIDENTIAL_INTERN_LIST_ID,
    rankLabel: process.env.LABEL_PRESIDENTIAL_INTERN,
    teamLabel: process.env.LABEL_CORPORATE_BOARD,
  },
  "Chief Executive Officer": {
    listId: process.env.CHIEF_EXECUTIVE_OFFICER_LIST_ID,
    rankLabel: process.env.LABEL_CHIEF_EXECUTIVE_OFFICER,
    teamLabel: process.env.LABEL_PRESIDENTIAL,
  },
  "Vice President": {
    listId: process.env.VICE_PRESIDENT_LIST_ID,
    rankLabel: process.env.LABEL_VICE_PRESIDENT,
    teamLabel: process.env.LABEL_PRESIDENTIAL,
  },
  President: {
    listId: process.env.PRESIDENT_LIST_ID,
    rankLabel: process.env.LABEL_PRESIDENT,
    teamLabel: process.env.LABEL_PRESIDENTIAL,
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
// DATE HELPERS
// =========================
function parseMmDdYyyy(dateStr) {
  const [mm, dd, yyyy] = dateStr.split("/").map(Number);
  return { mm, dd, yyyy };
}

function localNoonFromMmDdYyyy(dateStr) {
  const { mm, dd, yyyy } = parseMmDdYyyy(dateStr);
  return new Date(yyyy, mm - 1, dd, 12, 0, 0, 0);
}

function formatPrettyDate(dateStr) {
  const d = localNoonFromMmDdYyyy(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDueNextMonth(dateStr) {
  const d = localNoonFromMmDdYyyy(dateStr);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

function diffDurationString(fromPrettyDate, toDateStr) {
  const from = new Date(fromPrettyDate);
  const to = localNoonFromMmDdYyyy(toDateStr);

  let months =
    (to.getFullYear() - from.getFullYear()) * 12 +
    (to.getMonth() - from.getMonth());

  if (to.getDate() < from.getDate()) {
    months -= 1;
  }

  if (months >= 1) {
    return months === 1 ? "1 month" : `${months} months`;
  }

  let days = Math.round((to - from) / (1000 * 60 * 60 * 24));
  if (days <= 0) days = 1;

  return days === 1 ? "1 day" : `${days} days`;
}

// =========================
// DESCRIPTION HELPERS
// Expects lines like:
// - **Dec 7, 2025 - Leadership Intern**
// - **Mar 21, 2026 - Supervisor**
// and finalizes last unfinished line
// =========================
function normalizeDescription(desc) {
  if (!desc || !desc.trim()) return [];
  return desc
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractLineData(line) {
  // Matches:
  // - **Dec 7, 2025 - Leadership Intern**
  // - **Dec 7, 2025 - Leadership Intern - 3 months**
  const match = line.match(/^- \*\*(.+?) - (.+?)(?: - (\d+ month|\d+ months|\d+ day|\d+ days))?\*\*$/);
  if (!match) return null;

  return {
    startDate: match[1],
    rank: match[2],
    duration: match[3] || null,
  };
}

function finalizeLastRankLine(desc, newDateStr) {
  const lines = normalizeDescription(desc);
  if (lines.length === 0) return "";

  const lastIndex = lines.length - 1;
  const parsed = extractLineData(lines[lastIndex]);

  if (!parsed) return lines.join("\n");
  if (parsed.duration) return lines.join("\n");

  const duration = diffDurationString(parsed.startDate, newDateStr);
  lines[lastIndex] = `- **${parsed.startDate} - ${parsed.rank} - ${duration}**`;

  return lines.join("\n");
}

function appendNewRankLine(desc, newPrettyDate, newRank) {
  const lines = normalizeDescription(desc);
  lines.push(`- **${newPrettyDate} - ${newRank}**`);
  return lines.join("\n");
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

async function findStaffCardByUsername(username) {
  const res = await trelloGet(`https://api.trello.com/1/boards/${BOARD_ID}/cards`, {
    fields: "name,id,idLabels,desc,idList,closed",
  });

  const lower = username.toLowerCase();

  const card = res.data.find((c) => {
    if (c.closed) return false;
    return c.name.toLowerCase().startsWith(`${lower} - `);
  });

  return card || null;
}

// =========================
// COMMAND
// =========================
module.exports = {
  data: new SlashCommandBuilder()
    .setName("add-promotion")
    .setDescription("Promote a staff member in Staff Journey")
    .addStringOption((o) =>
      o.setName("username").setDescription("Username").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("rank").setDescription("New rank").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("promoter").setDescription("Promoter username").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("date").setDescription("MM/DD/YYYY").setRequired(true)
    ),

  async execute(interaction) {
    const username = interaction.options.getString("username");
    const newRank = interaction.options.getString("rank");
    const promoter = interaction.options.getString("promoter");
    const date = interaction.options.getString("date");

    const rankConfig = RANK_CONFIG[newRank];

    if (!BOARD_ID) {
      return interaction.reply({
        content: "❌ Missing STAFF_JOURNEY_BOARD_ID env.",
        ephemeral: true,
      });
    }

    if (!rankConfig) {
      return interaction.reply({
        content: `❌ Rank "${newRank}" is not configured in promotion.js yet.`,
        ephemeral: true,
      });
    }

    if (!rankConfig.listId || !rankConfig.rankLabel || !rankConfig.teamLabel) {
      return interaction.reply({
        content: `❌ Missing env vars for "${newRank}".`,
        ephemeral: true,
      });
    }

    try {
      const card = await findStaffCardByUsername(username);

      if (!card) {
        return interaction.reply({
          content: '❌ Oops, it seems you have not used the /enroll command.',
          ephemeral: true,
        });
      }

      const prettyDate = formatPrettyDate(date);
      const dueDate = formatDueNextMonth(date);

      // 1) finalize previous line
      const finalizedDesc = finalizeLastRankLine(card.desc || "", date);

      // 2) append new line
      const newDesc = appendNewRankLine(finalizedDesc, prettyDate, newRank);

      // 3) update description + move list + due date
      await trelloPut(`https://api.trello.com/1/cards/${card.id}`, {
        idList: rankConfig.listId,
        desc: newDesc,
        due: dueDate,
        pos: "bottom",
      });

      // 4) remove old rank/team labels
      const toRemove = card.idLabels.filter(
        (id) => ALL_RANK_LABELS.includes(id) || ALL_TEAM_LABELS.includes(id)
      );

      for (const labelId of toRemove) {
        await trelloPut(`https://api.trello.com/1/cards/${card.id}/idLabels/${labelId}`);
      }

      // 5) add new rank + team labels
      await trelloPost(`https://api.trello.com/1/cards/${card.id}/idLabels`, {
        value: rankConfig.rankLabel,
      });

      await trelloPost(`https://api.trello.com/1/cards/${card.id}/idLabels`, {
        value: rankConfig.teamLabel,
      });

      // 6) comment
      await trelloPost(`https://api.trello.com/1/cards/${card.id}/actions/comments`, {
        text: `Promoted to **${newRank}** by **${promoter}**`,
      });

      await interaction.reply(`✅ Promoted ${username} to ${newRank}`);
    } catch (err) {
      console.error("[PROMOTION ERROR]", err.response?.data || err.message || err);
      await interaction.reply("❌ Promotion Trello error");
    }
  },
};