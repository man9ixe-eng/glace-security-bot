// src/commands/staff/addloa.js

const { SlashCommandBuilder } = require('discord.js');
const { addLoa } = require('../../utils/loaManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('addloa')
    .setDescription('Place a staff member on LOA.')
    .setDMPermission(false)
    .addUserOption((option) =>
      option
        .setName('username')
        .setDescription('Staff member to place on LOA')
        .setRequired(true),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const target = interaction.options.getMember('username');
    if (!target) {
      await interaction.editReply('❌ I could not find that member in this server.');
      return;
    }

    const result = await addLoa(interaction, target);
    await interaction.editReply(result.message || (result.ok ? '✅ LOA added.' : '❌ Could not add LOA.'));
  },
};
