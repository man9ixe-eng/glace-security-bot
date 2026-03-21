const { SlashCommandBuilder } = require("discord.js");
const axios = require("axios");

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;

const LIST_ID = process.env.LEADERSHIP_INTERN_LIST_ID;
const LABEL_RANK = process.env.LABEL_LEADERSHIP_INTERN;
const LABEL_RECENT = process.env.LABEL_RECENTLY_PROMOTED;

function nextMonth(dateStr) {
  const [m, d, y] = dateStr.split("/");
  const date = new Date(`${y}-${m}-${d}`);
  date.setMonth(date.getMonth() + 1);
  return date.toISOString();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("enroll")
    .setDescription("Enroll a staff member")
    .addStringOption(o =>
      o.setName("username").setDescription("User").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("promoter").setDescription("Promoter").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("date").setDescription("MM/DD/YYYY").setRequired(true)
    ),

  async execute(interaction) {
    const username = interaction.options.getString("username");
    const promoter = interaction.options.getString("promoter");
    const date = interaction.options.getString("date");

    const name = `${username} - ${date}`;
    const due = nextMonth(date);

    try {
      const res = await axios.post(
        "https://api.trello.com/1/cards",
        {
          name,
          idList: LIST_ID,
          due,
          key: TRELLO_KEY,
          token: TRELLO_TOKEN,
        }
      );

      const cardId = res.data.id;

      // add labels
      await axios.post(
        `https://api.trello.com/1/cards/${cardId}/idLabels`,
        { value: LABEL_RANK, key: TRELLO_KEY, token: TRELLO_TOKEN }
      );

      await axios.post(
        `https://api.trello.com/1/cards/${cardId}/idLabels`,
        { value: LABEL_RECENT, key: TRELLO_KEY, token: TRELLO_TOKEN }
      );

      // comment
      await axios.post(
        `https://api.trello.com/1/cards/${cardId}/actions/comments`,
        {
          text: `Promoted to Leadership Intern by ${promoter}`,
          key: TRELLO_KEY,
          token: TRELLO_TOKEN,
        }
      );

      await interaction.reply(`✅ Enrolled ${username}`);
    } catch (err) {
      console.error(err.response?.data || err);
      await interaction.reply("❌ Trello error");
    }
  },
};