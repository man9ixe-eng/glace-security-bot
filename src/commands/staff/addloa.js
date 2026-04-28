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
    )
    .addStringOption((option) =>
      option
        .setName('start_date')
        .setDescription('LOA start date. Must be a Monday. Format: YYYY-MM-DD')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('end_date')
        .setDescription('Official LOA end date. Format: YYYY-MM-DD')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reviewer_username')
        .setDescription('Reviewer username for this LOA')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Reason for the LOA')
        .setRequired(true)
        .addChoices(
          { name: 'Personal', value: 'Personal' },
          { name: 'School/Work', value: 'School/Work' },
          { name: 'Sick', value: 'Sick' },
          { name: 'Mental Health', value: 'Mental Health' },
          { name: 'Vacation', value: 'Vacation' },
          { name: 'Other', value: 'Other' },
        ),
    )
    .addStringOption((option) =>
      option
        .setName('other_reason')
        .setDescription('Required if reason is Other')
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const target = interaction.options.getMember('username');
    const startDate = interaction.options.getString('start_date', true);
    const endDate = interaction.options.getString('end_date', true);
    const reviewerUsername = interaction.options.getString('reviewer_username', true);
    const reason = interaction.options.getString('reason', true);
    const otherReason = interaction.options.getString('other_reason') || '';

    if (!target) {
      await interaction.editReply('❌ I could not find that member in this server.');
      return;
    }

    const result = await addLoa(interaction, target, {
      startDate,
      endDate,
      reviewerUsername,
      reason,
      otherReason,
    });

    await interaction.editReply(result.message || (result.ok ? '✅ LOA added.' : '❌ Could not add LOA.'));
  },
};
