const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("add-resignation")
    .setDescription("Resign a staff member")
    .addStringOption(opt => opt.setName("username").setRequired(true)),

  async execute(interaction) {
    const username = interaction.options.getString("username");
    await interaction.reply(`📉 ${username} resigned`);
  }
};