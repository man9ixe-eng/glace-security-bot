'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { beginConfirmation, resolveTargetMember, findJourneyCardForMember } = require('../../utils/staffJourneySystem');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('updateuser')
    .setDescription('Update a Staff Journey Roblox username without changing their history.')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('member').setDescription('Discord member whose Roblox username changed').setRequired(true))
    .addStringOption((o) => o.setName('new_roblox_username').setDescription('New full Roblox username').setRequired(true).setMaxLength(20)),

  async execute(interaction) {
    const member = await resolveTargetMember(interaction, 'member');
    if (!member) return interaction.reply({ content: '❌ I could not find that Discord member in this server.', ephemeral: true });
    const newUsername = interaction.options.getString('new_roblox_username', true).trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(newUsername)) return interaction.reply({ content: '❌ That does not look like a valid Roblox username.', ephemeral: true });
    const { card, profile } = await findJourneyCardForMember(interaction.guild, member, { includeClosed: true });
    const oldUsername = profile?.robloxUsername || (card?.name ? card.name.split(' - ')[0] : 'Unknown');
    return beginConfirmation(
      interaction,
      {
        type: 'updateuser',
        processingMessage: `⏳ Updating ${member}’s Staff Journey username, this may take a bit...`,
        payload: { memberId: member.id, newUsername },
      },
      `Are you sure you want to update ${member} from **${oldUsername}** to **${newUsername}**?\n\nThe original Staff Journey date and rank history will stay untouched.`,
      { destructiveLabel: 'Confirm Username Update' },
    );
  },
};
