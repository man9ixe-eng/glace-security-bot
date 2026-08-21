'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { beginConfirmation } = require('../../utils/staffJourneySystem');

function validRobloxUsername(value) {
  return /^[A-Za-z0-9_]{3,20}$/.test(String(value || '').trim());
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('updateuser')
    .setDescription('Update a Staff Journey Roblox username without changing their history.')
    .setDMPermission(false)
    .addStringOption((o) => o
      .setName('current_roblox_username')
      .setDescription('Current FULL Roblox username exactly as shown at the start of the Staff Journey card title')
      .setRequired(true)
      .setMaxLength(20))
    .addStringOption((o) => o
      .setName('new_roblox_username')
      .setDescription('New full Roblox username')
      .setRequired(true)
      .setMaxLength(20)),

  async execute(interaction) {
    const oldUsername = interaction.options.getString('current_roblox_username', true).trim();
    const newUsername = interaction.options.getString('new_roblox_username', true).trim();

    if (!validRobloxUsername(oldUsername)) {
      return interaction.reply({ content: '❌ That current Roblox username does not look valid.', ephemeral: true });
    }
    if (!validRobloxUsername(newUsername)) {
      return interaction.reply({ content: '❌ That new Roblox username does not look valid.', ephemeral: true });
    }
    if (oldUsername.toLowerCase() === newUsername.toLowerCase()) {
      return interaction.reply({ content: '❌ The new Roblox username is the same as the current username.', ephemeral: true });
    }

    return beginConfirmation(
      interaction,
      {
        type: 'updateuser',
        processingMessage: `⏳ Updating **${oldUsername}** to **${newUsername}** in Staff Journey, this may take a bit...`,
        payload: { oldUsername, newUsername },
      },
      `Are you sure you want to update the Staff Journey card for **${oldUsername}** to **${newUsername}**?\n\nThe bot will look for a card whose username matches **${oldUsername}** exactly. The original Staff Journey date and rank history will stay untouched.`,
      { destructiveLabel: 'Confirm Username Update' },
    );
  },
};
