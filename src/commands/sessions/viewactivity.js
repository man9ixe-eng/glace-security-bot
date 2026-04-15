const { SlashCommandBuilder } = require('discord.js');
const activityCommand = require('./activity');
const { ensureActivityDataFresh } = require('../../utils/activityTracker');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('viewactivity')
    .setDescription('View another member\'s activity panel.')
    .addUserOption((option) =>
      option
        .setName('player')
        .setDescription('The member whose activity you want to view.')
        .setRequired(true),
    ),

  async execute(interaction) {
    await ensureActivityDataFresh(interaction.client, interaction.guild);

    const target = interaction.options.getMember('player');
    if (!target) {
      await interaction.reply({
        content: 'I could not find that member in this server.',
        ephemeral: true,
      });
      return;
    }

    const embed = activityCommand.buildActivityEmbed(target, target, interaction.guild);
    if (!embed) {
      await interaction.reply({
        content: 'That user does not have a quota-tracked Team role on this server.',
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
