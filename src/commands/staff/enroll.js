const { SlashCommandBuilder } = require("discord.js");
const { createCard } = require("../../services/staffJourneyService");
const config = require("../../config/staffJourney");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("enroll")
    .setDescription("Enroll a staff member")
    .addStringOption(opt => opt.setName("username").setRequired(true))
    .addStringOption(opt => opt.setName("promoter").setRequired(true))
    .addStringOption(opt => opt.setName("date").setRequired(true)),

  async execute(interaction) {
    const username = interaction.options.getString("username");
    const promoter = interaction.options.getString("promoter");
    const date = interaction.options.getString("date");

    const cardName = `${username} - ${date}`;
    await createCard(config.lists.leadershipIntern, cardName, `Promoted by ${promoter}`);

    await interaction.reply(`✅ Enrolled ${username}`);
  }
};