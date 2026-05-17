const { SlashCommandBuilder } = require('discord.js');
const { startEditActivity } = require('../../utils/editActivityManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('editactivity')
    .setDescription('Edit a saved session activity log using a Trello card.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('card')
        .setDescription('Trello card link or short ID')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('log_message')
        .setDescription('Optional: session log message link for older logs')
        .setRequired(false),
    )
    .addUserOption((option) =>
      option
        .setName('current_user')
        .setDescription('Optional: the staff member that needs to be fixed')
        .setRequired(false),
    )
    .addUserOption((option) =>
      option
        .setName('correct_user')
        .setDescription('Optional: the correct staff member')
        .setRequired(false),
    )
    .addUserOption((option) =>
      option
        .setName('add_helper')
        .setDescription('Optional: add one helper to a training log')
        .setRequired(false),
    ),

  async execute(interaction) {
    await startEditActivity(interaction);
  },
};
