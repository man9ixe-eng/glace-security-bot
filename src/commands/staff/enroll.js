'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { beginConfirmation, parseMmDdYyyy, resolveTargetMember } = require('../../utils/staffJourneySystem');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('enroll')
    .setDescription('Enroll a new Leadership Intern into Staff Journey.')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('member').setDescription('Discord member being promoted to Leadership Intern').setRequired(true))
    .addStringOption((o) => o.setName('roblox_username').setDescription('Their full Roblox username').setRequired(true).setMaxLength(20))
    .addUserOption((o) => o.setName('promoter').setDescription('Who promoted them').setRequired(true))
    .addStringOption((o) => o.setName('promotion_date').setDescription('Promotion date in MM/DD/YYYY').setRequired(true).setMaxLength(10))
    .addStringOption((o) => o.setName('custom_message').setDescription('Personal promotion message for the announcement').setRequired(true).setMaxLength(700))
    .addUserOption((o) => o.setName('promoter_2').setDescription('Optional second promoter').setRequired(false)),

  async execute(interaction) {
    const member = await resolveTargetMember(interaction, 'member');
    if (!member) return interaction.reply({ content: '\u274C I could not find that Discord member in this server.', ephemeral: true });

    const promotionDate = interaction.options.getString('promotion_date', true).trim();
    if (!parseMmDdYyyy(promotionDate)) {
      return interaction.reply({ content: '\u274C Invalid promotion date. Use the exact format MM/DD/YYYY.', ephemeral: true });
    }

    const promoter = interaction.options.getUser('promoter', true);
    const promoter2 = interaction.options.getUser('promoter_2');
    const robloxUsername = interaction.options.getString('roblox_username', true).trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(robloxUsername)) {
      return interaction.reply({ content: '\u274C That does not look like a valid Roblox username.', ephemeral: true });
    }

    return beginConfirmation(
      interaction,
      {
        type: 'enroll',
        processingMessage: `\u23F3 Enrolling ${member} into the AMAZING Staff Journey system, this may take a bit...`,
        payload: {
          memberId: member.id,
          robloxUsername,
          promoterIds: [promoter.id, promoter2?.id].filter(Boolean),
          promotionDate,
          customMessage: interaction.options.getString('custom_message', true).trim(),
        },
      },
      `Are you sure you want to enroll ${member} into Staff Journey as **Leadership Intern** on **${promotionDate}**?`,
      { canPost: true, destructiveLabel: 'Confirm Enrollment' },
    );
  },
};
