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
        .setDescription('Official LOA end date to show on the log. Format: MM/DD/YYYY')
        .setRequired(true),
    ),

  async execute(interaction) {
    try {
      await interaction.deferReply();

      const targetUser = interaction.options.getUser('username', true);
      const target = interaction.options.getMember('username')
        || await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      const endDate = interaction.options.getString('end_date', true);

      if (!target) {
        await interaction.editReply('❌ I could not find that member in this server.');
        return;
      }

      const result = await removeLoa(interaction, target, { endDate });
      await interaction.editReply(result.message || (result.ok ? '✅ LOA removed.' : '❌ Could not remove LOA.'));
    } catch (err) {
      console.error('[REMOVELOA COMMAND ERROR]', err);
      const message = '❌ Something went wrong while running `/removeloa`. I stopped the command so it does not stay processing. Check the console log for the exact error.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message).catch(() => null);
      } else {
        await interaction.reply({ content: message, ephemeral: false }).catch(() => null);
      }
    }
  },
};
