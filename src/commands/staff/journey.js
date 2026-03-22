const { SlashCommandBuilder } = require("discord.js");
const axios = require("axios");

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const BOARD_ID = process.env.STAFF_JOURNEY_BOARD_ID;

const MONTHLY_MILESTONES_LIST_ID = process.env.MONTHLY_MILESTONES_LIST_ID;
const PROMOTIONS_LIST_ID = process.env.PROMOTIONS_LIST_ID;
const RESIGNITIONS_LIST_ID = process.env.RESIGNITIONS_LIST_ID;
const LABEL_HAPPY_MONTHS = process.env.LABEL_HAPPY_MONTHS;

// Active staff rank lists only
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

// =========================
// HELPERS
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

function getNYNow() {
  return new Date();
}

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

function getNYDateKey(date = new Date()) {
  const { year, month, day } = getNYParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getNYMonthDayHeader(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
  }).format(date);
}

function getTodayHeaderText() {
  return `[ ${getNYMonthDayHeader()} | Monthly Staff Journey ]`;
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

function getCurrentRankFromDesc(desc) {
  const lines = normalizeLines(desc);
  if (lines.length === 0) return "Unknown Rank";

  const parsed = parseJourneyLine(lines[lines.length - 1]);
  return parsed?.rank || "Unknown Rank";
}

function getUsernameFromCardName(name) {
  if (!name || typeof name !== "string") return "Unknown User";
  return name.split(" - ")[0].trim();
}

function buildMilestoneCardName(username, months, rank) {
  return `${username} - ${months} ${months === 1 ? "Month" : "Months"} - ${rank}`;
}

async function getAllBoardCards() {
  const res = await trelloGet(`https://api.trello.com/1/boards/${BOARD_ID}/cards`, {
    fields: "id,name,desc,idList,closed,due,idLabels",
  });
  return res.data || [];
}

async function clearMonthlyMilestonesList() {
  const res = await trelloGet(`https://api.trello.com/1/lists/${MONTHLY_MILESTONES_LIST_ID}/cards`, {
    fields: "id,name,closed",
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
    fields: "id,name,due,closed",
  });

  const todayKey = getNYDateKey();

  return (res.data || []).some((card) => {
    if (card.closed) return false;
    if (!card.due) return false;
    return card.due.slice(0, 10) === todayKey;
  });
}

// =========================
// COMMAND
// =========================
module.exports = {
  data: new SlashCommandBuilder()
    .setName("staff-journey")
    .setDescription("Generate today's monthly milestone cards and post the daily journey list"),

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

      const allCards = await getAllBoardCards();
      const todayParts = getNYParts();
      const dueIso = getTodayDueESTIso();

      const eligible = [];

      for (const card of allCards) {
        if (card.closed) continue;
        if (!ACTIVE_RANK_LIST_IDS.includes(card.idList)) continue;
        if (card.idList === PROMOTIONS_LIST_ID) continue;
        if (card.idList === RESIGNITIONS_LIST_ID) continue;

        const lines = normalizeLines(card.desc || "");
        if (lines.length === 0) continue;

        const firstParsed = parseJourneyLine(lines[0]);
        if (!firstParsed) continue;

        const firstPromotionDate = new Date(firstParsed.startDate);
        if (Number.isNaN(firstPromotionDate.getTime())) continue;

        if (!shouldCelebrateToday(firstPromotionDate, todayParts)) continue;

        const totalMonths = monthsBetween(firstPromotionDate, todayParts);
        if (totalMonths < 1) continue;

        const username = getUsernameFromCardName(card.name);
        const currentRank = getCurrentRankFromDesc(card.desc || "");

        eligible.push({
          sourceCard: card,
          username,
          currentRank,
          months: totalMonths,
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

        const copyRes = await trelloPost("https://api.trello.com/1/cards", {
          idList: MONTHLY_MILESTONES_LIST_ID,
          idCardSource: entry.sourceCard.id,
          keepFromSource: "desc",
          name: milestoneName,
          due: dueIso,
          pos: "bottom",
        });

        await trelloPost(`https://api.trello.com/1/cards/${copyRes.data.id}/idLabels`, {
          value: LABEL_HAPPY_MONTHS,
        });

        copied += 1;
      }

      const header = `[ ${getNYMonthDayHeader()} | Monthly Staff Journey ]`;

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