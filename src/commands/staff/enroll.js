const { SlashCommandBuilder } = require("discord.js");
const axios = require("axios");

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const BOARD_ID = process.env.STAFF_JOURNEY_BOARD_ID;

const LIST_ID = process.env.LEADERSHIP_INTERN_LIST_ID;
const LABEL_RANK = process.env.LABEL_LEADERSHIP_INTERN;
const LABEL_TEAM = process.env.LABEL_INTERN;

const EXCLUDED_LIST_IDS = [
  process.env.PROMOTIONS_LIST_ID,
  process.env.RESIGNATION_LIST_ID,
  process.env.RESIGNATIONS_LIST_ID,
  process.env.RESIGNITIONS_LIST_ID,
  process.env.MONTHLY_MILESTONES_LIST_ID,
].filter(Boolean);

// =========================
// DATE HELPERS
// =========================
function parseDate(dateStr) {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(String(dateStr || ""))) return null;
  const [mm, dd, yyyy] = dateStr.split("/").map(Number);
  if (!mm || !dd || !yyyy) return null;
  return new Date(yyyy, mm - 1, dd, 12, 0, 0);
}

function nextMonthSameDay(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return null;

  const originalDay = d.getDate();
  d.setMonth(d.getMonth() + 1);

  if (d.getDate() !== originalDay) {
    d.setDate(0);
    d.setHours(12, 0, 0, 0);
  }

  return d.toISOString();
}

function formatPretty(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return null;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/<a?:\w+:\d+>/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCardUsername(cardName) {
  const raw = String(cardName || "").trim();

  const enrolledFormat = raw.match(/^(.+?)\s+-\s+\d{2}\/\d{2}\/\d{4}\s*$/);
  if (enrolledFormat) return enrolledFormat[1].trim();

  const resignedFormat = raw.match(/^(.+?)\s+-\s+.+?\s+-\s+\d{2}\/\d{2}\/\d{4}\s*$/);
  if (resignedFormat) return resignedFormat[1].trim();

  return raw.split(" - ")[0].trim();
}

function isActiveJourneyCard(card) {
  if (!card || card.closed) return false;
  if (EXCLUDED_LIST_IDS.includes(card.idList)) return false;
  return true;
}

async function getActiveStaffCardsByUsername(username) {
  const res = await trelloGet(`https://api.trello.com/1/boards/${BOARD_ID}/cards`, {
    fields: "id,name,desc,idLabels,idList,closed,pos,due,url",
  });

  const wanted = normalizeName(username);

  return (res.data || [])
    .filter(isActiveJourneyCard)
    .filter((card) => normalizeName(extractCardUsername(card.name)) === wanted)
    .sort((a, b) => (a.pos || 0) - (b.pos || 0));
}

async function addLabelIfMissing(card, labelId) {
  if (!labelId) return;
  if ((card.idLabels || []).includes(labelId)) return;

  await trelloPost(`https://api.trello.com/1/cards/${card.id}/idLabels`, {
    value: labelId,
  });
}

async function getCardCommentTexts(cardId) {
  const res = await trelloGet(`https://api.trello.com/1/cards/${cardId}/actions`, {
    filter: "commentCard",
    limit: 1000,
    fields: "data,type",
  });

  return (res.data || [])
    .map((action) => action?.data?.text)
    .filter(Boolean);
}

async function addCommentOnce(cardId, text) {
  const comments = await getCardCommentTexts(cardId);
  if (comments.some((comment) => comment.trim() === text.trim())) return false;

  await trelloPost(`https://api.trello.com/1/cards/${cardId}/actions/comments`, {
    text,
  });
  return true;
}

function parsePromoterCardName(name) {
  const raw = String(name || "").trim();
  const match = raw.match(/^(.+?)\s*\/\s*(.+?)\s+-\s*(\d+)\s*$/);

  if (!match) {
    return {
      nickname: raw,
      username: raw,
      base: raw.replace(/\s+-\s*\d+\s*$/, "").trim(),
    };
  }

  return {
    nickname: match[1].trim(),
    username: match[2].trim(),
    base: `${match[1].trim()} / ${match[2].trim()}`,
  };
}

async function findPromoterCard(promoter) {
  const res = await trelloGet(`https://api.trello.com/1/boards/${BOARD_ID}/cards`, {
    fields: "id,name,closed,url",
  });

  const wanted = normalizeName(promoter);
  if (!wanted) return null;

  const openCards = (res.data || []).filter((card) => !card.closed);

  return (
    openCards.find((card) => {
      const parsed = parsePromoterCardName(card.name);
      return normalizeName(parsed.nickname) === wanted || normalizeName(parsed.username) === wanted;
    }) ||
    openCards.find((card) => normalizeName(card.name).includes(wanted)) ||
    null
  );
}

async function countComments(cardId) {
  const res = await trelloGet(`https://api.trello.com/1/cards/${cardId}/actions`, {
    filter: "commentCard",
    limit: 1000,
    fields: "id,type",
  });

  return Array.isArray(res.data) ? res.data.length : 0;
}

function buildPromoterCardName(oldName, count) {
  const parsed = parsePromoterCardName(oldName);
  const base = parsed.base || String(oldName || "").replace(/\s+-\s*\d+\s*$/, "").trim();
  return `${base} - ${count}`;
}

async function updatePromoterCard(promoter, username, rankName) {
  const promoterCard = await findPromoterCard(promoter);

  if (!promoterCard) {
    return `⚠️ Enrolled successfully, but I could not find a promoter count card for **${promoter}**.`;
  }

  const commentText = `${username} - ${rankName}`;
  await addCommentOnce(promoterCard.id, commentText);

  const newCount = await countComments(promoterCard.id);
  await trelloPut(`https://api.trello.com/1/cards/${promoterCard.id}`, {
    name: buildPromoterCardName(promoterCard.name, newCount),
  });

  return `✅ Updated promoter count card to **${newCount}**.`;
}

// =========================
// COMMAND
// =========================
module.exports = {
  data: new SlashCommandBuilder()
    .setName("enroll")
    .setDescription("Enroll a staff member into Staff Journey")
    .setDMPermission(false)
    .addStringOption((o) =>
      o.setName("username").setDescription("Username").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("promoter").setDescription("Promoter nickname or username from the count card").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("date").setDescription("MM/DD/YYYY").setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const username = interaction.options.getString("username", true).trim();
    const promoter = interaction.options.getString("promoter", true).trim();
    const date = interaction.options.getString("date", true).trim();

    if (!TRELLO_KEY || !TRELLO_TOKEN || !BOARD_ID) {
      await interaction.editReply("❌ Missing TRELLO_KEY, TRELLO_TOKEN, or STAFF_JOURNEY_BOARD_ID env.");
      return;
    }

    if (!LIST_ID || !LABEL_RANK || !LABEL_TEAM) {
      await interaction.editReply("❌ Missing env vars: LEADERSHIP_INTERN_LIST_ID, LABEL_LEADERSHIP_INTERN, LABEL_INTERN");
      return;
    }

    const dueDate = nextMonthSameDay(date);
    const prettyDate = formatPretty(date);

    if (!dueDate || !prettyDate) {
      await interaction.editReply("❌ Invalid date. Use the exact format MM/DD/YYYY.");
      return;
    }

    const cardName = `${username} - ${date}`;
    const descLine = `- **${prettyDate} - Leadership Intern**`;
    const staffComment = `Promoted to **Leadership Intern** by **${promoter}**`;

    try {
      const activeMatches = await getActiveStaffCardsByUsername(username);
      const existingCard = activeMatches[0] || null;
      const duplicateCards = activeMatches.slice(1);

      for (const duplicate of duplicateCards) {
        await trelloPut(`https://api.trello.com/1/cards/${duplicate.id}`, {
          closed: true,
        });
      }

      let card = existingCard;
      let createdNew = false;

      if (!card) {
        const res = await trelloPost("https://api.trello.com/1/cards", {
          idList: LIST_ID,
          name: cardName,
          due: dueDate,
          desc: descLine,
          pos: "bottom",
        });
        card = res.data;
        createdNew = true;
      } else if (card.idList === LIST_ID || !String(card.desc || "").trim()) {
        await trelloPut(`https://api.trello.com/1/cards/${card.id}`, {
          idList: LIST_ID,
          name: cardName,
          due: dueDate,
          desc: String(card.desc || "").trim() ? card.desc : descLine,
          pos: "bottom",
        });
      }

      await addLabelIfMissing(card, LABEL_RANK);
      await addLabelIfMissing(card, LABEL_TEAM);
      await addCommentOnce(card.id, staffComment);

      const promoterNote = await updatePromoterCard(promoter, username, "Leadership Intern");
      const duplicateNote = duplicateCards.length
        ? `\n🧹 Archived **${duplicateCards.length}** duplicate active Staff Journey card${duplicateCards.length === 1 ? "" : "s"}.`
        : "";

      await interaction.editReply(
        [
          createdNew
            ? `✅ Enrolled **${username}**.`
            : `✅ **${username}** already had an active Staff Journey card, so I did **not** create a duplicate.`,
          promoterNote,
          duplicateNote,
        ]
          .filter(Boolean)
          .join("\n")
      );
    } catch (err) {
      console.error("[ENROLL ERROR]", err.response?.data || err.message || err);
      await interaction.editReply("❌ Trello error while enrolling. Check Render logs for details.");
    }
  },
};
