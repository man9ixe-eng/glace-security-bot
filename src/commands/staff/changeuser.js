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

async function trelloPost(url, params = {}) {
  return axios.post(url, null, {
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

  const activePrimary = matches
    .filter((card) => !card.closed)
    .filter((card) => card.idList !== PROMOTIONS_LIST_ID)
    .filter((card) => card.idList !== RESIGNITIONS_LIST_ID)
    .sort((a, b) => (a.pos || 0) - (b.pos || 0));

  if (activePrimary.length > 0) return activePrimary[0];

  const openAny = matches
    .filter((card) => !card.closed)
    .sort((a, b) => (a.pos || 0) - (b.pos || 0));

  if (openAny.length > 0) return openAny[0];

  return matches[0];
}

function replaceUsernameOnly(cardName, oldUsername, newUsername) {
  const prefix = `${oldUsername} - `;
  if (cardName.startsWith(prefix)) {
    return `${newUsername} - ${cardName.slice(prefix.length)}`;
  }

  const firstDash = cardName.indexOf(" - ");
  if (firstDash === -1) return newUsername;

  return `${newUsername}${cardName.slice(firstDash)}`;
}

// =========================
// COMMAND
// =========================
module.exports = {
  data: new SlashCommandBuilder()
    .setName("changeuser")
    .setDescription("Change a staff member username on their Staff Journey card")
    .setDMPermission(false)
    .addStringOption((o) =>
      o.setName("old_username").setDescription("Current username").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("new_username").setDescription("New username").setRequired(true)
    ),

  async execute(interaction) {
    const oldUsername = interaction.options.getString("old_username");
    const newUsername = interaction.options.getString("new_username");

    if (!BOARD_ID) {
      return interaction.reply({
        content: "❌ Missing STAFF_JOURNEY_BOARD_ID env.",
        ephemeral: true,
      });
    }

    try {
      const card = await findBestActiveStaffCard(oldUsername);

      if (!card) {
        return interaction.reply({
          content: "❌ User not found.",
          ephemeral: true,
        });
      }

      const newCardName = replaceUsernameOnly(card.name, oldUsername, newUsername);

      await trelloPut(`https://api.trello.com/1/cards/${card.id}`, {
        name: newCardName,
      });

      await trelloPost(`https://api.trello.com/1/cards/${card.id}/actions/comments`, {
        text: `**Old Username:** ${oldUsername}\n\n**New Username:** ${newUsername}`,
      });

      await interaction.reply(`✅ Updated username from ${oldUsername} to ${newUsername}`);
    } catch (err) {
      console.error("[CHANGEUSER ERROR]", err.response?.data || err.message || err);
      await interaction.reply("❌ Trello error while changing username");
    }
  },
};