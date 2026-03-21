const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("add-promotion")
    .setDescription("Promote a staff member")
    .addStringOption(opt =>
      opt.setName("username").setDescription("User").setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName("rank").setDescription("New rank").setRequired(true)
    ),

  async execute(interaction) {
    await interaction.reply("Promotion command working 📈");
  },
};