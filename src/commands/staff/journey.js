const { SlashCommandBuilder } = require("discord.js");
const axios = require("axios");

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const BOARD_ID = process.env.STAFF_JOURNEY_BOARD_ID;

const MONTHLY_MILESTONES_LIST_ID = process.env.MONTHLY_MILESTONES_LIST_ID;
const PROMOTIONS_LIST_ID = process.env.PROMOTIONS_LIST_ID;
const RESIGNITIONS_LIST_ID = process.env.RESIGNITIONS_LIST_ID;
const LABEL_HAPPY_MONTHS = process.env.LABEL_HAPPY_MONTHS;

const ACTIVE_RANK_LIST_IDS = [
  process.env.LEADERSHIP_INTERN_LIST_ID,
  process.env.SUPERVISOR_LIST_ID,
  process.env.ASSISTANT_MANAGER_LIST_ID,
  process.env.HOTEL_MANAGER_LIST_ID,
  process.env.EXECUTIVE_MANAGER_LIST_ID,
  process.env.CORPORATE_INTERN_LIST_ID,
  process.env.JUNIOR_CORPORATE_LIST_ID,
  process.env.SENIOR_CORPORATE_LIST_ID,
  process.env.HEAD_CORPORATE_LIST_ID,
  process.env.BOARD_OF_DIRECTORS_LIST_ID,
  process.env.PRESIDENTIAL_INTERN_LIST_ID,
  process.env.CHIEF_EXECUTIVE_OFFICER_LIST_ID,
  process.env.VICE_PRESIDENT_LIST_ID,
  process.env.PRESIDENT_LIST_ID,
].filter(Boolean);

// Rank -> label mapping
const RANK_LABEL_MAP = {
  "Leadership Intern": process.env.LABEL_LEADERSHIP_INTERN,
  "Supervisor": process.env.LABEL_SUPERVISOR,
  "Assistant Manager": process.env.LABEL_ASSISTANT_MANAGER,
  "Hotel Manager": process.env.LABEL_HOTEL_MANAGER,
  "Executive Manager": process.env.LABEL_EXECUTIVE_MANAGER,
  "Corporate Intern": process.env.LABEL_CORPORATE_INTERN,
  "Junior Corporate": process.env.LABEL_JUNIOR_CORPORATE,
  "Senior Corporate": process.env.LABEL_SENIOR_CORPORATE,
  "Head Corporate": process.env.LABEL_HEAD_CORPORATE,
  "Board Of Directors": process.env.LABEL_BOARD_OF_DIRECTORS,
  "Presidential Intern": process.env.LABEL_PRESIDENTIAL_INTERN,
  "Chief Executive Officer": process.env.LABEL_CHIEF_EXECUTIVE_OFFICER,
  "Vice President": process.env.LABEL_VICE_PRESIDENT,
  "President": process.env.LABEL_PRESIDENT,
};

// =========================
// API HELPERS
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

async function trelloPost(url, params = {}) {
  return axios.post(url, null, {
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

// =========================
// DATE / TIME HELPERS
// =========================
function getNYParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });

  const parts = formatter.formatToParts(date);

  return {
    year: Number(parts.find((p) => p.type === "year")?.value),
    month: Number(parts.find((p) => p.type === "month")?.value),
    day: Number(parts.find((p) => p.type === "day")?.value),
  };
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function getNYMonthDayHeader(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
  }).format(date);
}

function getNYFullDateForList(date = new Date()) {
  const parts = getNYParts(date);
  const monthName = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
  }).format(date);

  return `${monthName} ${ordinal(parts.day)}, ${parts.year}`;
}

function getTodayHeaderText() {
  return `[ ${getNYMonthDayHeader()} | Monthly Staff Journey ]`;
}

function getTodayListName() {
  return `Milestones - ${getNYFullDateForList()}`;
}

function getNYOffsetString(now = new Date()) {
  const tzName =
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      timeZoneName: "longOffset",
      hour: "2-digit",
    })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value || "GMT-05:00";

  return tzName.replace("GMT", "");
}

function getTodayDueESTIso() {
  const now = new Date();

  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const offset = getNYOffsetString(now);
  return `${ymd}T23:59:00${offset}`;
}

function getLastDayOfMonth(year, monthOneBased) {
  return new Date(year, monthOneBased, 0).getDate();
}

function shouldCelebrateToday(firstPromotionDate, todayParts) {
  const originalDay = firstPromotionDate.getDate();
  const lastDayThisMonth = getLastDayOfMonth(todayParts.year, todayParts.month);

  if (todayParts.day === originalDay) return true;

  if (originalDay > lastDayThisMonth && todayParts.day === lastDayThisMonth) {
    return true;
  }

  return false;
}

function monthsBetween(startDate, todayParts) {
  const end = new Date(todayParts.year, todayParts.month - 1, todayParts.day, 12, 0, 0);

  let months =
    (end.getFullYear() - startDate.getFullYear()) * 12 +
    (end.getMonth() - startDate.getMonth());

  if (end.getDate() < startDate.getDate()) {
    months -= 1;
  }

  return months;
}

// =========================
// DESCRIPTION HELPERS
// =========================
function normalizeLines(desc) {
  if (!desc || typeof desc !== "string") return [];
  return desc
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseJourneyLine(line) {
  if (!line || typeof line !== "string") return null;

  let cleaned = line.trim();

  cleaned = cleaned
    .replace(/^-+\s*/, "")
    .replace(/^_+/, "")
    .replace(/_+$/, "")
    .replace(/^\*+/, "")
    .replace(/\*+$/, "")
    .trim();

  const parts = cleaned.split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);

  if (parts.length < 2) return null;

  return {
    startDate: parts[0],
    rank: parts[1],
    duration: parts[2] || null,
  };
}

function getCurrentRankFromDesc(desc) {
  const lines = normalizeLines(desc);
  if (lines.length === 0) return "Unknown Rank";

  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = parseJourneyLine(lines[i]);
    if (parsed?.rank) return parsed.rank;
  }

  return "Unknown Rank";
}

function getFirstPromotionDateFromDesc(desc) {
  const lines = normalizeLines(desc);
  if (lines.length === 0) return null;

  for (const line of lines) {
    const parsed = parseJourneyLine(line);
    if (!parsed?.startDate) continue;

    const date = new Date(parsed.startDate);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  return null;
}

function getUsernameFromCardName(name) {
  if (!name || typeof name !== "string") return "Unknown User";
  return name.split(" - ")[0].trim();
}

function buildMilestoneCardName(username, months, rank) {
  return `${username} - ${months} ${months === 1 ? "Month" : "Months"} - ${rank}`;
}

// =========================
// BOARD HELPERS
// =========================
async function getAllBoardCards() {
  const res = await trelloGet(`https://api.trello.com/1/boards/${BOARD_ID}/cards`, {
    fields: "id,name,desc,idList,closed,due,idLabels",
  });
  return res.data || [];
}

async function clearMonthlyMilestonesList() {
  const res = await trelloGet(`https://api.trello.com/1/lists/${MONTHLY_MILESTONES_LIST_ID}/cards`, {
    fields: "id,closed",
  });

  for (const card of res.data || []) {
    if (!card.closed) {
      await trelloPut(`https://api.trello.com/1/cards/${card.id}`, {
        closed: true,
      });
    }
  }
}

async function hasAlreadyPostedToday() {
  const res = await trelloGet(`https://api.trello.com/1/lists/${MONTHLY_MILESTONES_LIST_ID}/cards`, {
    fields: "id,due,closed",
  });

  const duePrefix = getTodayDueESTIso().slice(0, 10);

  return (res.data || []).some((card) => {
    if (card.closed) return false;
    if (!card.due) return false;
    return card.due.slice(0, 10) === duePrefix;
  });
}

// =========================
// COMMAND
// =========================
module.exports = {
  data: new SlashCommandBuilder()
    .setName("staff-journey")
    .setDescription("Generate today's monthly milestone cards and post the journey list"),

  async execute(interaction) {
    if (!BOARD_ID || !MONTHLY_MILESTONES_LIST_ID || !LABEL_HAPPY_MONTHS) {
      return interaction.reply({
        content:
          "❌ Missing STAFF_JOURNEY_BOARD_ID, MONTHLY_MILESTONES_LIST_ID, or LABEL_HAPPY_MONTHS env.",
        ephemeral: true,
      });
    }

    try {
      const alreadyPosted = await hasAlreadyPostedToday();
      if (alreadyPosted) {
        return interaction.reply({
          content: "❌ Monthly milestones have already been posted for today.",
          ephemeral: true,
        });
      }

      await clearMonthlyMilestonesList();

      // Rename the list instead of making a header card
      await trelloPut(`https://api.trello.com/1/lists/${MONTHLY_MILESTONES_LIST_ID}`, {
        name: getTodayListName(),
      });

      const allCards = await getAllBoardCards();
      const todayParts = getNYParts();
      const dueIso = getTodayDueESTIso();

      const eligible = [];

      for (const card of allCards) {
        if (card.closed) continue;
        if (!ACTIVE_RANK_LIST_IDS.includes(card.idList)) continue;
        if (card.idList === PROMOTIONS_LIST_ID) continue;
        if (card.idList === RESIGNITIONS_LIST_ID) continue;

        const firstPromotionDate = getFirstPromotionDateFromDesc(card.desc || "");
        if (!firstPromotionDate) continue;

        if (!shouldCelebrateToday(firstPromotionDate, todayParts)) continue;

        const totalMonths = monthsBetween(firstPromotionDate, todayParts);
        if (totalMonths < 1) continue;

        const username = getUsernameFromCardName(card.name);
        const currentRank = getCurrentRankFromDesc(card.desc || "");
        const rankLabelId = RANK_LABEL_MAP[currentRank] || null;

        eligible.push({
          sourceCard: card,
          username,
          currentRank,
          months: totalMonths,
          rankLabelId,
        });
      }

      eligible.sort((a, b) => {
        if (b.months !== a.months) return b.months - a.months;
        return a.username.localeCompare(b.username);
      });

      let copied = 0;

      for (const entry of eligible) {
        const milestoneName = buildMilestoneCardName(
          entry.username,
          entry.months,
          entry.currentRank
        );

        const newCard = await trelloPost("https://api.trello.com/1/cards", {
          idList: MONTHLY_MILESTONES_LIST_ID,
          name: milestoneName,
          desc: entry.sourceCard.desc || "",
          due: dueIso,
          pos: "bottom",
        });

        await trelloPost(`https://api.trello.com/1/cards/${newCard.data.id}/idLabels`, {
          value: LABEL_HAPPY_MONTHS,
        });

        if (entry.rankLabelId) {
          await trelloPost(`https://api.trello.com/1/cards/${newCard.data.id}/idLabels`, {
            value: entry.rankLabelId,
          });
        }

        copied += 1;
      }

      const header = getTodayHeaderText();

      if (eligible.length === 0) {
        return interaction.reply({
          content: `${header}\n=========================\n\nNo monthly milestones today.`,
        });
      }

      const body = eligible
        .map(
          (entry) =>
            `${entry.username} - ${entry.currentRank} - ${entry.months} ${
              entry.months === 1 ? "month" : "months"
            }`
        )
        .join("\n\n");

      await interaction.reply({
        content: `${header}\n=========================\n\n${body}`,
      });
    } catch (err) {
      console.error("[STAFF JOURNEY ERROR]", err.response?.data || err.message || err);
      await interaction.reply("❌ Trello error while generating monthly milestones");
    }
  },
};