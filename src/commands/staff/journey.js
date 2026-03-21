const { SlashCommandBuilder } = require("discord.js");
const axios = require("axios");

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const BOARD_ID = process.env.STAFF_JOURNEY_BOARD_ID;

const MONTHLY_MILESTONES_LIST_ID = process.env.MONTHLY_MILESTONES_LIST_ID;
const PROMOTIONS_LIST_ID = process.env.PROMOTIONS_LIST_ID;
const RESIGNITIONS_LIST_ID = process.env.RESIGNITIONS_LIST_ID;

const LABEL_HAPPY_MONTHS = process.env.LABEL_HAPPY_MONTHS;

// Active rank lists only
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

function getNYParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });

  const parts = formatter.formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);

  return { year, month, day };
}

function getNYDateKey(date = new Date()) {
  const { year, month, day } = getNYParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getTodayHeaderText() {
  const now = new Date();
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
  }).format(now);

  return `[ ${formatted} | Monthly Staff Journey ]`;
}

function getTodayDueESTIso() {
  const now = new Date();

  const nyDateString = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // YYYY-MM-DD

  // Build 11:59 PM in New York by using local date text + explicit zone offset from NY at runtime
  const offsetText = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "longOffset",
    hour: "2-digit",
  })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName")?.value || "GMT-05:00";

  const isoOffset = offsetText.replace("GMT", "");

  return `${nyDateString}T23:59:00${isoOffset}`;
}

function shouldCelebrateToday(firstPromotionDate, todayParts) {
  const originalDay = firstPromotionDate.getDate();

  const lastDayOfCurrentMonth = new Date(
    todayParts.year,
    todayParts.month,
    0
  ).getDate();

  if (todayParts.day === originalDay) return true;

  if (originalDay > lastDayOfCurrentMonth && todayParts.day === lastDayOfCurrentMonth) {
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
  const cards = await getAllBoardCards();
  const todayKey = getNYDateKey();
  const header = getTodayHeaderText();

  return cards.some((card) => {
    if (card.closed) return false;
    if (card.idList !== MONTHLY_MILESTONES_LIST_ID) return false;

    const dueText = card.due ? card.due.slice(0, 10) : "";
    return card.name === header || dueText === todayKey;
  });
}

// =========================
// COMMAND
// =========================
module.exports = {
  data: new SlashCommandBuilder()
    .setName("staff-journey")
    .setDescription("Generate today's Monthly Staff Journey milestone cards"),

  async execute(interaction) {
    if (!BOARD_ID || !MONTHLY_MILESTONES_LIST_ID || !LABEL_HAPPY_MONTHS) {
      return interaction.reply({
        content: "❌ Missing STAFF_JOURNEY_BOARD_ID, MONTHLY_MILESTONES_LIST_ID, or LABEL_HAPPY_MONTHS env.",
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

      // Start fresh for the new day
      await clearMonthlyMilestonesList();

      const allCards = await getAllBoardCards();
      const todayParts = getNYParts();
      const dueIso = getTodayDueESTIso();

      const eligibleCards = allCards.filter((card) => {
        if (card.closed) return false;
        if (!ACTIVE_RANK_LIST_IDS.includes(card.idList)) return false;
        if (card.idList === PROMOTIONS_LIST_ID) return false;
        if (card.idList === RESIGNITIONS_LIST_ID) return false;

        const lines = normalizeLines(card.desc || "");
        if (lines.length === 0) return false;

        const firstParsed = parseJourneyLine(lines[0]);
        if (!firstParsed) return false;

        const firstPromotionDate = new Date(firstParsed.startDate);
        if (Number.isNaN(firstPromotionDate.getTime())) return false;

        if (!shouldCelebrateToday(firstPromotionDate, todayParts)) return false;

        const totalMonths = monthsBetween(firstPromotionDate, todayParts);
        return totalMonths >= 1;
      });

      // Optional header card so the list clearly marks the day's run
      const headerCard = await trelloPost("https://api.trello.com/1/cards", {
        idList: MONTHLY_MILESTONES_LIST_ID,
        name: getTodayHeaderText(),
        desc: "Auto-generated daily milestone post.",
        due: dueIso,
        pos: "top",
      });

      await trelloPost(`https://api.trello.com/1/cards/${headerCard.data.id}/idLabels`, {
        value: LABEL_HAPPY_MONTHS,
      });

      let copied = 0;

      for (const sourceCard of eligibleCards) {
        const copyRes = await trelloPost("https://api.trello.com/1/cards", {
          idList: MONTHLY_MILESTONES_LIST_ID,
          idCardSource: sourceCard.id,
          keepFromSource: "attachments,checklists,customFields,desc,due,start",
          name: sourceCard.name,
          due: dueIso,
          pos: "bottom",
        });

        const newCardId = copyRes.data.id;

        // Remove comments by not copying them in keepFromSource.
        // Add Happy Months label.
        await trelloPost(`https://api.trello.com/1/cards/${newCardId}/idLabels`, {
          value: LABEL_HAPPY_MONTHS,
        });

        copied += 1;
      }

      await interaction.reply(
        `✅ Posted ${copied} monthly milestone card${copied === 1 ? "" : "s"} for today.`
      );
    } catch (err) {
      console.error("[STAFF JOURNEY ERROR]", err.response?.data || err.message || err);
      await interaction.reply("❌ Trello error while generating monthly milestones");
    }
  },
};