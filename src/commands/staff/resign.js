'use strict';

const { SlashCommandBuilder } = require('discord.js');
const {
  beginConfirmation,
  parseMmDdYyyy,
  resolveTargetMember,
  findJourneyCardForMember,
  currentRankEntry,
} = require('../../utils/staffJourneySystem');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resign')
    .setDescription('Close a Staff Journey as a resignation.')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('member').setDescription('Discord member resigning').setRequired(true))
    .addStringOption((o) => o.setName('resignation_date').setDescription('Resignation date in MM/DD/YYYY').setRequired(true).setMaxLength(10))
    .addStringOption((o) => o.setName('custom_message').setDescription('Personal farewell message for the announcement').setRequired(true).setMaxLength(700)),

  async execute(interaction) {
    const member = await resolveTargetMember(interaction, 'member');
    if (!member) return interaction.reply({ content: '❌ I could not find that Discord member in this server.', ephemeral: true });
    const date = interaction.options.getString('resignation_date', true).trim();
    if (!parseMmDdYyyy(date)) return interaction.reply({ content: '❌ Invalid resignation date. Use MM/DD/YYYY.', ephemeral: true });
    const { card } = await findJourneyCardForMember(interaction.guild, member, { includeClosed: false });
    const current = card ? currentRankEntry(card.desc) : null;

    return beginConfirmation(
      interaction,
      {
        type: 'resign',
        processingMessage: `⏳ Closing ${member}’s Staff Journey as a resignation, this may take a bit...`,
        payload: {
          memberId: member.id,
          resignationDate: date,
          customMessage: interaction.options.getString('custom_message', true).trim(),
        },
      },
      `Are you sure you want to archive ${member} from the staff team as a resignation from **${current?.rank || 'their current rank'}**?\n\nTheir Discord/Bloxlink rank will **not** be changed by this command; Corporate+ can handle that separately.`,
      { canPost: true, destructiveLabel: 'Confirm Resignation' },
    );
  },
};
