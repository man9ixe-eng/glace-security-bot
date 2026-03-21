const { SlashCommandBuilder } = require("discord.js");
const axios = require("axios");

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const BOARD_ID = process.env.STAFF_JOURNEY_BOARD_ID;
const PROMOTIONS_LIST_ID = process.env.PROMOTIONS_LIST_ID;
const RESIGNITIONS_LIST_ID = process.env.RESIGNITIONS_LIST_ID;

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

async function trelloPut(url, params = {}) {
  return axios.put(url, null, {
    params: {
      key: TRELLO_KEY,
      token: TRELLO_TOKEN,
      ...params,
    },
  });
}

async function findBestActiveStaffCard(username) {
  const res = await trelloGet(`https://api.trello.com/1/boards/${BOARD_ID}/cards`, {
    fields: "id,name,closed,idList,pos",
  });

  const lower = username.toLowerCase();

  const matches = res.data.filter((card) => {
    const name = (card.name || "").toLowerCase();
    return name.startsWith(`${lower} - `);
  });

  if (matches.length === 0) return null;

  // Prefer open cards that are NOT in promotions/resignations
  const activePrimary = matches
    .filter((card) => !card.closed)
    .filter((card) => card.idList !== PROMOTIONS_LIST_ID)
    .filter((card) => card.idList !== RESIGNITIONS_LIST_ID)
    .sort((a, b) => (a.pos || 0) - (b.pos || 0));

  if (activePrimary.length > 0) {
    return activePrimary[0];
  }

  // Fallback: any open match
  const openAny = matches
    .filter((card) => !card.closed)
    .sort((a, b) => (a.pos || 0) - (b.pos || 0));

  if (openAny.length > 0) {
    return openAny[0];
  }

  // Last fallback: first match
  return matches[0];
}

// =========================
// COMMAND
// =========================
module.exports = {
  data: new SlashCommandBuilder()
    .setName("unenroll")
    .setDescription("Archive a staff member from Staff Journey")
    .addStringOption((o) =>
      o.setName("username").setDescription("Username").setRequired(true)
    ),

  async execute(interaction) {
    const username = interaction.options.getString("username");

    if (!BOARD_ID) {
      return interaction.reply({
        content: "❌ Missing STAFF_JOURNEY_BOARD_ID env.",
        ephemeral: true,
      });
    }

    try {
      const card = await findBestActiveStaffCard(username);

      if (!card) {
        return interaction.reply({
          content: "❌ User not found.",
          ephemeral: true,
        });
      }

      if (card.closed) {
        return interaction.reply({
          content: "⚠️ This user is already archived.",
          ephemeral: true,
        });
      }

      await trelloPut(`https://api.trello.com/1/cards/${card.id}`, {
        closed: true,
      });

      // verify it actually archived
      const verify = await trelloGet(`https://api.trello.com/1/cards/${card.id}`, {
        fields: "id,name,closed",
      });

      if (!verify.data.closed) {
        return interaction.reply({
          content: "❌ Archive request sent, but Trello did not mark the card archived.",
          ephemeral: true,
        });
      }

      await interaction.reply(`🗃️ Archived ${verify.data.name}`);
    } catch (err) {
      console.error("[UNENROLL ERROR]", err.response?.data || err.message || err);
      await interaction.reply("❌ Trello error while archiving");
    }
  },
};