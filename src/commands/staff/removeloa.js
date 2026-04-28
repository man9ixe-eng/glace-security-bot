// src/commands/staff/removeloa.js

const { SlashCommandBuilder } = require('discord.js');
const { removeLoa } = require('../../utils/loaManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removeloa')
    .setDescription('Remove LOA from a staff member and log the duration.')
    .setDMPermission(false)
    .addUserOption((option) =>
      option
        .setName('username')
        .setDescription('Staff member to remove from LOA')
        .setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const target = interaction.options.getMember('username');
    if (!target) {
      await interaction.editReply('❌ I could not find that member in this server.');
      return;
    }

    const result = await removeLoa(interaction, target);
    await interaction.editReply(result.message || (result.ok ? '✅ LOA removed.' : '❌ Could not remove LOA.'));
  },
};
