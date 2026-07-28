const { SlashCommandBuilder } = require('discord.js');
const activityCommand = require('./activity');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('viewactivity')
    .setDescription("View another member's activity panel.")
    .setDMPermission(false)
    .addUserOption((option) =>
      option
        .setName('player')
        .setDescription('The member whose activity you want to view.')
        .setRequired(true),
    ),

  async execute(interaction) {
    const target = interaction.options.getMember('player');

    if (!target) {
      await interaction.reply({
        content: 'I could not find that member in this server.',
        ephemeral: true,
      });
      return;
    }

    const embed = await activityCommand.buildActivityEmbed(interaction, target);

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