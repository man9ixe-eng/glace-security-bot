const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("add-promotion")
    .setDescription("Promote a staff member")
    .addStringOption(opt => opt.setName("username").setRequired(true))
    .addStringOption(opt => opt.setName("rank").setRequired(true)),

  async execute(interaction) {
    const username = interaction.options.getString("username");
    const rank = interaction.options.getString("rank");

    await interaction.reply(`📈 ${username} promoted to ${rank}`);
  }
};