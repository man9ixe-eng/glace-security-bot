// src/commands/staff/removeloa.js

const { SlashCommandBuilder } = require('discord.js');
const { removeLoa } = require('../../utils/loaManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removeloa')
    .setDescription('Remove LOA from a staff member and update the LOA log.')
    .setDMPermission(false)
    .addUserOption((option) =>
      option
        .setName('username')
        .setDescription('Staff member to remove from LOA')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('end_date')
        .setDescription('Official LOA end date to show on the log. Format: YYYY-MM-DD')
        .setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const target = interaction.options.getMember('username');
    const endDate = interaction.options.getString('end_date', true);

    if (!target) {
      await interaction.editReply('❌ I could not find that member in this server.');
      return;
    }

    const result = await removeLoa(interaction, target, { endDate });
    await interaction.editReply(result.message || (result.ok ? '✅ LOA removed.' : '❌ Could not remove LOA.'));
  },
};
