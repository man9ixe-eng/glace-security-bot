const { SlashCommandBuilder } = require("discord.js");
const axios = require("axios");

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

function timeSinceFirstPromotion(desc, resignationDateStr) {
  const lines = normalizeLines(desc);
  if (lines.length === 0) return "Unknown duration";

  const firstParsed = parseJourneyLine(lines[0]);
  if (!firstParsed) return "Unknown duration";

  const start = new Date(firstParsed.startDate);
  const end = localNoonFromMmDdYyyy(resignationDateStr);

  if (Number.isNaN(start.getTime()) || !end) return "Unknown duration";

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

function removeRecentlyPromotedLabel(idLabels = []) {
  const recentlyPromoted = process.env.LABEL_RECENTLY_PROMOTED;
  if (!recentlyPromoted) return idLabels;
  return idLabels.filter((id) => id !== recentlyPromoted);
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
    .setName("add-resignation")
    .setDescription("Mark a staff member as resigned in Staff Journey")
    .addStringOption((o) =>
      o.setName("username").setDescription("Username").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("date").setDescription("MM/DD/YYYY").setRequired(false)
    ),

  async execute(interaction) {
    const username = interaction.options.getString("username");
    const date = interaction.options.getString("date") || getTodayMmDdYyyy();

    if (!BOARD_ID || !RESIGNATIONS_LIST_ID || !LABEL_RECENTLY_RESIGNED) {
      return interaction.reply({
        content:
          "❌ Missing STAFF_JOURNEY_BOARD_ID, RESIGNITIONS_LIST_ID, or LABEL_RECENTLY_RESIGNED env.",
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

      const sinceFirst = timeSinceFirstPromotion(card.desc || "", date);

      await trelloPut(`https://api.trello.com/1/cards/${card.id}`, {
        idList: RESIGNATIONS_LIST_ID,
        due: dueDate,
        pos: "bottom",
      });

      // remove Recently Promoted if present
      if (process.env.LABEL_RECENTLY_PROMOTED && (card.idLabels || []).includes(process.env.LABEL_RECENTLY_PROMOTED)) {
        await trelloDelete(
          `https://api.trello.com/1/cards/${card.id}/idLabels/${process.env.LABEL_RECENTLY_PROMOTED}`
        );
      }

      // add Recently Resigned if not already there
      if (!(card.idLabels || []).includes(LABEL_RECENTLY_RESIGNED)) {
        await trelloPost(`https://api.trello.com/1/cards/${card.id}/idLabels`, {
          value: LABEL_RECENTLY_RESIGNED,
        });
      }

      await trelloPost(`https://api.trello.com/1/cards/${card.id}/actions/comments`, {
        text: `Resigned on ${prettyDate} - ${sinceFirst}`,
      });

      await interaction.reply(`✅ Marked ${username} as resigned`);
    } catch (err) {
      console.error("[RESIGNATION ERROR]", err.response?.data || err.message || err);
      await interaction.reply("❌ Resignation Trello error");
    }
  },
};