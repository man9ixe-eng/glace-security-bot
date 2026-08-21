// src/commands/staff/extendloa.js

const { SlashCommandBuilder } = require('discord.js');
const { extendLoa } = require('../../utils/loaManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('extendloa')
    .setDescription('Extend a staff member\'s active LOA and update the existing LOA log.')
    .setDMPermission(false)
    .addUserOption((option) =>
      option
        .setName('username')
        .setDescription('Staff member whose LOA is being extended')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('new_end_date')
        .setDescription('New planned LOA end date. Format: MM/DD/YYYY')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Reason for the LOA extension')
        .setRequired(true),
    ),

  async execute(interaction) {
    try {
      await interaction.deferReply();

      const targetUser = interaction.options.getUser('username', true);
      const target = interaction.options.getMember('username')
        || await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      const newEndDate = interaction.options.getString('new_end_date', true);
      const reason = interaction.options.getString('reason', true);

      if (!target) {
        await interaction.editReply('\u274C I could not find that member in this server.');
        return;
      }

      const result = await extendLoa(interaction, target, {
        newEndDate,
        reason,
      });

      await interaction.editReply(result.message || (result.ok ? '\u2705 LOA extended.' : '\u274C Could not extend LOA.'));
    } catch (err) {
      console.error('[EXTENDLOA COMMAND ERROR]', err);
      const message = '\u274C Something went wrong while running `/extendloa`. I stopped the command so it does not stay processing. Check the console log for the exact error.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message).catch(() => null);
      } else {
        await interaction.reply({ content: message, ephemeral: false }).catch(() => null);
      }
    }
  },
};
