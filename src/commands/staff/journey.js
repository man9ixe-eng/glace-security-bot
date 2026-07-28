const { SlashCommandBuilder } = require("discord.js");
const axios = require("axios");

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const BOARD_ID = process.env.STAFF_JOURNEY_BOARD_ID;

const MONTHLY_MILESTONES_LIST_ID = process.env.MONTHLY_MILESTONES_LIST_ID;
const PROMOTIONS_LIST_ID = process.env.PROMOTIONS_LIST_ID;
const RESIGNITIONS_LIST_ID = process.env.RESIGNITIONS_LIST_ID;
const LABEL_HAPPY_MONTHS = process.env.LABEL_HAPPY_MONTHS;

let staffJourneyRunInProgress = false;

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

function pad2(n) {
  return String(n).padStart(2, "0");
}

function buildNYDueIso(year, monthOneBased, day) {
  const probe = new Date(Date.UTC(year, monthOneBased - 1, day, 12, 0, 0));
  const offset = getNYOffsetString(probe);
  return `${year}-${pad2(monthOneBased)}-${pad2(day)}T23:59:00${offset}`;
}

function getNextMonthDueESTIso() {
  const today = getNYParts();
  let nextYear = today.year;
  let nextMonth = today.month + 1;

  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }

  const nextDay = Math.min(today.day, getLastDayOfMonth(nextYear, nextMonth));
  return buildNYDueIso(nextYear, nextMonth, nextDay);
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

async function getMonthlyMilestoneCards(filter = "open") {
  const res = await trelloGet(`https://api.trello.com/1/lists/${MONTHLY_MILESTONES_LIST_ID}/cards`, {
    filter,
    fields: "id,name,closed,due,idList",
  });

  return res.data || [];
}

async function closeCard(cardId) {
  return trelloPut(`https://api.trello.com/1/cards/${cardId}`, {
    closed: true,
  });
}

async function clearMonthlyMilestonesList() {
  let closedCount = 0;

  // Trello can sometimes return slightly stale list data, so this does a few
  // safe passes until the milestone list has no open cards left.
  for (let pass = 0; pass < 3; pass += 1) {
    const cards = await getMonthlyMilestoneCards("open");
    const openCards = (cards || []).filter((card) => !card.closed);

    if (openCards.length === 0) return closedCount;

    for (const card of openCards) {
      await closeCard(card.id);
      closedCount += 1;
    }
  }

  return closedCount;
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function closeExistingMilestoneCardsByName(cardName) {
  const target = normalizeName(cardName);
  const cards = await getMonthlyMilestoneCards("open");
  let closedCount = 0;

  for (const card of cards || []) {
    if (card.closed) continue;
    if (normalizeName(card.name) !== target) continue;

    await closeCard(card.id);
    closedCount += 1;
  }

  return closedCount;
}

function rankListPriority(idList) {
  const index = ACTIVE_RANK_LIST_IDS.indexOf(idList);
  return index === -1 ? -1 : index;
}

function pickBestEligibleCard(current, next) {
  if (!current) return next;

  const currentPriority = rankListPriority(current.sourceCard.idList);
  const nextPriority = rankListPriority(next.sourceCard.idList);

  // If a duplicate active card exists for the same username, keep the card in
  // the highest rank list. This prevents one user from getting two milestone cards.
  if (nextPriority !== currentPriority) {
    return nextPriority > currentPriority ? next : current;
  }

  // If both are in the same rank priority, keep the one with more months.
  if (next.months !== current.months) {
    return next.months > current.months ? next : current;
  }

  return current;
}

// =========================
// COMMAND
// =========================
module.exports = {
  data: new SlashCommandBuilder()
    .setName("staff-journey")
    .setDescription("Generate today's monthly milestone cards and post the journey list")
    .setDMPermission(false),

  async execute(interaction) {
    if (!BOARD_ID || !MONTHLY_MILESTONES_LIST_ID || !LABEL_HAPPY_MONTHS) {
      return interaction.reply({
        content:
          "❌ Missing STAFF_JOURNEY_BOARD_ID, MONTHLY_MILESTONES_LIST_ID, or LABEL_HAPPY_MONTHS env.",
        ephemeral: true,
      });
    }

    if (staffJourneyRunInProgress) {
      return interaction.reply({
        content: "❌ Staff Journey is already refreshing. Please run it again after the current refresh finishes.",
        ephemeral: true,
      });
    }

    staffJourneyRunInProgress = true;

    try {
      await interaction.deferReply();

      // Always clear the milestone list first. This makes the command safe to rerun:
      // it refreshes today's milestone cards instead of stacking duplicates.
      const clearedCards = await clearMonthlyMilestonesList();

      await trelloPut(`https://api.trello.com/1/lists/${MONTHLY_MILESTONES_LIST_ID}`, {
        name: getTodayListName(),
      });

      const allCards = await getAllBoardCards();
      const todayParts = getNYParts();
      const dueIso = getTodayDueESTIso();
      const nextMonthDueIso = getNextMonthDueESTIso();

      const eligibleByUsername = new Map();

      for (const card of allCards) {
        if (card.closed) continue;
        if (card.idList === MONTHLY_MILESTONES_LIST_ID) continue;
        if (card.idList === PROMOTIONS_LIST_ID) continue;
        if (card.idList === RESIGNITIONS_LIST_ID) continue;
        if (!ACTIVE_RANK_LIST_IDS.includes(card.idList)) continue;

        const firstPromotionDate = getFirstPromotionDateFromDesc(card.desc || "");
        if (!firstPromotionDate) continue;

        if (!shouldCelebrateToday(firstPromotionDate, todayParts)) continue;

        const totalMonths = monthsBetween(firstPromotionDate, todayParts);
        if (totalMonths < 1) continue;

        const username = getUsernameFromCardName(card.name);
        const currentRank = getCurrentRankFromDesc(card.desc || "");
        const usernameKey = username.toLowerCase();

        const entry = {
          sourceCard: card,
          username,
          currentRank,
          months: totalMonths,
        };

        eligibleByUsername.set(
          usernameKey,
          pickBestEligibleCard(eligibleByUsername.get(usernameKey), entry)
        );
      }

      const eligible = Array.from(eligibleByUsername.values()).sort((a, b) => {
        if (b.months !== a.months) return b.months - a.months;
        return a.username.localeCompare(b.username);
      });

      const posted = [];
      const failed = [];
      let duplicateCardsClosed = 0;

      for (const entry of eligible) {
        try {
          const milestoneName = buildMilestoneCardName(
            entry.username,
            entry.months,
            entry.currentRank
          );

          // Extra safety: if a matching milestone card somehow exists from a retry,
          // close it before making the fresh card.
          duplicateCardsClosed += await closeExistingMilestoneCardsByName(milestoneName);

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

          // Move the main Staff Journey card due date forward so next month is smooth.
          await trelloPut(`https://api.trello.com/1/cards/${entry.sourceCard.id}`, {
            due: nextMonthDueIso,
          });

          posted.push(entry);
        } catch (cardErr) {
          console.error(
            "[STAFF JOURNEY CARD ERROR]",
            entry.username,
            entry.currentRank,
            cardErr.response?.data || cardErr.message || cardErr
          );
          failed.push(`${entry.username} (${entry.currentRank})`);
        }
      }

      const header = getTodayHeaderText();

      if (posted.length === 0) {
        let msg = `${header}\n=========================\n\nNo monthly milestones were posted today.`;

        if (clearedCards > 0 || duplicateCardsClosed > 0) {
          msg += `\n\nCleared old milestone cards: ${clearedCards + duplicateCardsClosed}`;
        }

        if (failed.length > 0) {
          msg += `\n\nFailed:\n${failed.join("\n")}`;
        }

        return interaction.editReply({ content: msg });
      }

      const body = posted
        .map(
          (entry) =>
            `${entry.username} - ${entry.currentRank} - ${entry.months} ${
              entry.months === 1 ? "month" : "months"
            }`
        )
        .join("\n\n");

      let content = `${header}\n=========================\n\n${body}`;

      if (clearedCards > 0 || duplicateCardsClosed > 0) {
        content += `\n\nRefreshed old milestone cards: ${clearedCards + duplicateCardsClosed}`;
      }

      if (failed.length > 0) {
        content += `\n\nFailed:\n${failed.join("\n")}`;
      }

      await interaction.editReply({ content });
    } catch (err) {
      console.error("[STAFF JOURNEY ERROR]", err.response?.data || err.message || err);

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply("❌ Trello error while generating monthly milestones");
      } else {
        await interaction.reply("❌ Trello error while generating monthly milestones");
      }
    } finally {
      staffJourneyRunInProgress = false;
    }
  },
};
