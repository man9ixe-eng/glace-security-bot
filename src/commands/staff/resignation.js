const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("add-resignation")
    .setDescription("Resign a staff member")
    .addStringOption(opt =>
      opt.setName("username").setDescription("User").setRequired(true)
    ),

  async execute(interaction) {
    await interaction.reply("Resignation command working 📉");
  },
};