const { SlashCommandBuilder } = require("discord.js");
const axios = require("axios");

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;

const LIST_ID = process.env.LEADERSHIP_INTERN_LIST_ID;
const LABEL_RANK = process.env.LABEL_LEADERSHIP_INTERN;
const LABEL_TEAM = process.env.LABEL_INTERN;

// =========================
// DATE HELPERS
// =========================

function parseDate(dateStr) {
  const [mm, dd, yyyy] = dateStr.split("/").map(Number);
  return new Date(yyyy, mm - 1, dd, 12, 0, 0); // noon = prevents timezone shift
}

function nextMonthSameDay(dateStr) {
  const d = parseDate(dateStr);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

function formatPretty(dateStr) {
  const d = parseDate(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// =========================
// COMMAND
// =========================

module.exports = {
  data: new SlashCommandBuilder()
    .setName("enroll")
    .setDescription("Enroll a staff member into Staff Journey")
    .addStringOption((o) =>
      o.setName("username").setDescription("Username").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("promoter").setDescription("Promoter").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("date").setDescription("MM/DD/YYYY").setRequired(true)
    ),

  async execute(interaction) {
    const username = interaction.options.getString("username");
    const promoter = interaction.options.getString("promoter");
    const date = interaction.options.getString("date");

    // =========================
    // ENV CHECK
    // =========================
    if (!LIST_ID || !LABEL_RANK || !LABEL_TEAM) {
      return interaction.reply({
        content:
          "❌ Missing env vars: LEADERSHIP_INTERN_LIST_ID, LABEL_LEADERSHIP_INTERN, LABEL_INTERN",
        ephemeral: true,
      });
    }

    const cardName = `${username} - ${date}`;
    const dueDate = nextMonthSameDay(date);
    const prettyDate = formatPretty(date);

    try {
      // =========================
      // CREATE CARD (BOTTOM)
      // =========================
      const res = await axios.post("https://api.trello.com/1/cards", null, {
        params: {
          key: TRELLO_KEY,
          token: TRELLO_TOKEN,
          idList: LIST_ID,
          name: cardName,
          due: dueDate,
          pos: "bottom", // 🔥 ensures newest is always at bottom
        },
      });

      const cardId = res.data.id;

      // =========================
      // SET DESCRIPTION
      // =========================
      await axios.put(`https://api.trello.com/1/cards/${cardId}`, null, {
        params: {
          key: TRELLO_KEY,
          token: TRELLO_TOKEN,
          desc: `- **${prettyDate} - Leadership Intern**`,
        },
      });

      // =========================
      // ADD RANK LABEL
      // =========================
      await axios.post(
        `https://api.trello.com/1/cards/${cardId}/idLabels`,
        null,
        {
          params: {
            key: TRELLO_KEY,
            token: TRELLO_TOKEN,
            value: LABEL_RANK,
          },
        }
      );

      // =========================
      // ADD TEAM LABEL (NOT OLDEST RANK)
      // =========================
      await axios.post(
        `https://api.trello.com/1/cards/${cardId}/idLabels`,
        null,
        {
          params: {
            key: TRELLO_KEY,
            token: TRELLO_TOKEN,
            value: LABEL_TEAM,
          },
        }
      );

      // =========================
      // ADD COMMENT (BOLD)
      // =========================
      await axios.post(
        `https://api.trello.com/1/cards/${cardId}/actions/comments`,
        null,
        {
          params: {
            key: TRELLO_KEY,
            token: TRELLO_TOKEN,
            text: `Promoted to **Leadership Intern** by **${promoter}**`,
          },
        }
      );

      await interaction.reply(`✅ Enrolled ${username}`);
    } catch (err) {
      console.error("[ENROLL ERROR]", err.response?.data || err.message || err);
      await interaction.reply("❌ Trello error");
    }
  },
};