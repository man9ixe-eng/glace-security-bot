const { SlashCommandBuilder } = require('discord.js');
const { startEditActivity } = require('../../utils/editActivityManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('editactivity')
    .setDescription('Open an activity editor for an attendee post or logged session using a Trello card.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('card')
        .setDescription('Trello card link or short ID')
        .setRequired(true),
    )
    .addUserOption((option) =>
      option
        .setName('current_user')
        .setDescription('Optional: the wrong user currently in the log')
        .setRequired(false),
    )
    .addUserOption((option) =>
      option
        .setName('correct_user')
        .setDescription('Optional: the correct user to replace them with')
        .setRequired(false),
    ),

  async execute(interaction) {
    await startEditActivity(interaction);
  },
};
