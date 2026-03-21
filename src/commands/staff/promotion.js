const { SlashCommandBuilder } = require("discord.js");
const axios = require("axios");

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
  },

  "Supervisor": {
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
  "President": {
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
// HELPERS
// =========================
function getTodayMmDdYyyy() {
  return new Date().toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
}

function parseMmDdYyyy(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;

  const parts = dateStr.split("/");
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

function durationBetweenPrettyAndInput(prettyStartDate, newDateStr) {
  const start = new Date(prettyStartDate);
  const end = localNoonFromMmDdYyyy(newDateStr);

  if (Number.isNaN(start.getTime()) || !end) return null;

  let months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth());

  if (end.getDate() < start.getDate()) {
    months -= 1;
  }

  if (months >= 1) {
    return months === 1 ? "1 month" : `${months} months`;
  }

  let days = Math.floor((end - start) / (1000 * 60 * 60 * 24));
  if (days < 1) days = 1;

  return days === 1 ? "1 day" : `${days} days`;
}

function normalizeLines(desc) {
  if (!desc || typeof desc !== "string") return [];
  return desc
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseJourneyLine(line) {
  const match = line.match(/^- \*\*(.+?) - (.+?)(?: - (.+?))?\*\*$/);
  if (!match) return null;

  return {
    startDate: match[1],
    rank: match[2],
    duration: match[3] || null,
  };
}

function finalizePreviousRankLine(desc, newDateStr) {
  const lines = normalizeLines(desc);
  if (lines.length === 0) return "";

  const lastIndex = lines.length - 1;
  const parsed = parseJourneyLine(lines[lastIndex]);

  if (!parsed) return lines.join("\n");
  if (parsed.duration) return lines.join("\n");

  const duration = durationBetweenPrettyAndInput(parsed.startDate, newDateStr);
  if (!duration) return lines.join("\n");

  lines[lastIndex] = `- **${parsed.startDate} - ${parsed.rank} - ${duration}**`;
  return lines.join("\n");
}

function appendNewRankLine(desc, prettyDate, rank) {
  const lines = normalizeLines(desc);
  lines.push(`- **${prettyDate} - ${rank}**`);
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

async function findStaffCardByUsername(username) {
  const res = await trelloGet(`https://api.trello.com/1/boards/${BOARD_ID}/cards`, {
    fields: "id,name,desc,idLabels,idList,closed,pos",
  });

  const lower = username.toLowerCase();

  return (
    res.data.find((card) => {
      if (card.closed) return false;
      return card.name.toLowerCase().startsWith(`${lower} - `);
    }) || null
  );
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
      o.setName("date").setDescription("MM/DD/YYYY").setRequired(false)
    ),

  async execute(interaction) {
    const username = interaction.options.getString("username");
    const newRank = interaction.options.getString("rank");
    const promoter = interaction.options.getString("promoter");
    const date = interaction.options.getString("date") || getTodayMmDdYyyy();

    const rankConfig = RANK_CONFIG[newRank];

    if (!BOARD_ID) {
      return interaction.reply({
        content: "❌ Missing STAFF_JOURNEY_BOARD_ID env.",
        ephemeral: true,
      });
    }

    if (!rankConfig) {
      return interaction.reply({
        content: `❌ Rank "${newRank}" is not configured.`,
        ephemeral: true,
      });
    }

    if (!rankConfig.listId || !rankConfig.rankLabel || !rankConfig.teamLabel) {
      return interaction.reply({
        content: `❌ Missing env vars for "${newRank}".`,
        ephemeral: true,
      });
    }

    const prettyDate = formatPrettyDate(date);
    const dueDate = formatDueNextMonth(date);

    if (!prettyDate || !dueDate) {
      return interaction.reply({
        content: "❌ Invalid date. Use MM/DD/YYYY.",
        ephemeral: true,
      });
    }

    try {
      const card = await findStaffCardByUsername(username);

      if (!card) {
        return interaction.reply({
          content: "❌ Oops, it seems you have not used the /enroll command.",
          ephemeral: true,
        });
      }

      const finalizedDesc = finalizePreviousRankLine(card.desc || "", date);
      const updatedDesc = appendNewRankLine(finalizedDesc, prettyDate, newRank);

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
        await trelloDelete(
          `https://api.trello.com/1/cards/${card.id}/idLabels/${labelId}`
        );
      }

      await trelloPost(`https://api.trello.com/1/cards/${card.id}/idLabels`, {
        value: rankConfig.rankLabel,
      });

      await trelloPost(`https://api.trello.com/1/cards/${card.id}/idLabels`, {
        value: rankConfig.teamLabel,
      });

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