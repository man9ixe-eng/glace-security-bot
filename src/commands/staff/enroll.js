const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("enroll")
    .setDescription("Enroll a staff member into the system")
    .addStringOption(opt =>
      opt.setName("username").setDescription("User").setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName("promoter").setDescription("Promoter").setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName("date").setDescription("MM/DD/YYYY").setRequired(true)
    ),

  async execute(interaction) {
    await interaction.reply("Enroll command working ✅");
  },
};