'use strict';

const { SlashCommandBuilder } = require('discord.js');
const cfg = require('../../config/staffJourney');
const { runStaffJourneyTest, resolveTargetMember } = require('../../utils/staffJourneySystem');

module.exports = {
  data: (() => {
    const builder = new SlashCommandBuilder()
      .setName('staffjourneytest')
      .setDescription('Preview Staff Journey commands/announcements in the private test channel. NO real changes.')
      .setDMPermission(false)
      .addStringOption((o) => o.setName('command').setDescription('Which Staff Journey workflow to preview').setRequired(true)
        .addChoices(
          { name: 'ALL Staff Journey previews', value: 'all' },
          { name: '/enroll', value: 'enroll' },
          { name: '/promote', value: 'promote' },
          { name: '/resign', value: 'resign' },
          { name: '/updateuser', value: 'updateuser' },
          { name: '/demote', value: 'demote' },
          { name: '/staffjourneypost', value: 'staffjourneypost' },
          { name: 'Automatic Monthly Milestone', value: 'monthly_milestone' },
        ))
      .addUserOption((o) => o.setName('member').setDescription('Member to use in the preview').setRequired(true))
      .addStringOption((o) => {
        o.setName('rank').setDescription('Optional rank to use in promotion/demotion previews').setRequired(false);
        for (const rank of cfg.RANKS) o.addChoices({ name: rank.display, value: rank.key });
        return o;
      })
      .addStringOption((o) => o.setName('announcement_type').setDescription('For /staffjourneypost preview').setRequired(false)
        .addChoices(
          { name: 'Enrollment', value: 'enrollment' },
          { name: 'Promotion', value: 'promotion' },
          { name: 'Resignation', value: 'resignation' },
        ))
      .addUserOption((o) => o.setName('promoter').setDescription('Optional promoter used in test preview').setRequired(false))
      .addUserOption((o) => o.setName('promoter_2').setDescription('Optional second promoter used in test preview').setRequired(false))
      .addStringOption((o) => o.setName('custom_message').setDescription('Optional custom test announcement message').setRequired(false).setMaxLength(700))
      .addStringOption((o) => o.setName('new_username').setDescription('Optional new username for /updateuser preview').setRequired(false).setMaxLength(20))
      .addIntegerOption((o) => o.setName('months').setDescription('Months for milestone preview').setRequired(false).setMinValue(1).setMaxValue(120));
    return builder;
  })(),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const member = await resolveTargetMember(interaction, 'member');
    if (!member) return interaction.editReply('\u274C I could not find that Discord member in this server.');
    const promoter = interaction.options.getUser('promoter');
    const promoter2 = interaction.options.getUser('promoter_2');
    try {
      const result = await runStaffJourneyTest(interaction, {
        command: interaction.options.getString('command', true),
        memberId: member.id,
        rankKey: interaction.options.getString('rank') || null,
        announcementType: interaction.options.getString('announcement_type') || 'promotion',
        promoterIds: [promoter?.id, promoter2?.id].filter(Boolean),
        customMessage: interaction.options.getString('custom_message') || null,
        newUsername: interaction.options.getString('new_username') || null,
        months: interaction.options.getInteger('months') || 1,
      });
      return interaction.editReply(`\u2705 Posted **${result.posted.length}** Staff Journey test preview${result.posted.length === 1 ? '' : 's'} in ${result.channel}. Nothing real was changed and no one was pinged.`);
    } catch (error) {
      console.error('[STAFF JOURNEY TEST]', error);
      return interaction.editReply(`\u274C Staff Journey test failed: ${error.message || error}`);
    }
  },
};
