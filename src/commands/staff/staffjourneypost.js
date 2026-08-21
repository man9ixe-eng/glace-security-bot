'use strict';

const { SlashCommandBuilder } = require('discord.js');
const cfg = require('../../config/staffJourney');
const { beginConfirmation, resolveTargetMember } = require('../../utils/staffJourneySystem');

module.exports = {
  data: (() => {
    const builder = new SlashCommandBuilder()
      .setName('staffjourneypost')
      .setDescription('Post or repost a Staff Journey promotion/resignation announcement.')
      .setDMPermission(false)
      .addStringOption((o) => o.setName('announcement_type').setDescription('What kind of Staff Journey announcement').setRequired(true)
        .addChoices(
          { name: 'Enrollment / Leadership Intern Promotion', value: 'enrollment' },
          { name: 'Promotion', value: 'promotion' },
          { name: 'Resignation', value: 'resignation' },
        ))
      .addUserOption((o) => o.setName('member').setDescription('Staff member').setRequired(true))
      .addStringOption((o) => o.setName('custom_message').setDescription('Personal message to include').setRequired(true).setMaxLength(700))
      .addStringOption((o) => {
        o.setName('rank').setDescription('Optional promotion rank if reposting an older promotion').setRequired(false);
        for (const rank of cfg.RANKS) o.addChoices({ name: rank.display, value: rank.key });
        return o;
      });
    return builder;
  })(),

  async execute(interaction) {
    const member = await resolveTargetMember(interaction, 'member');
    if (!member) return interaction.reply({ content: '\u274C I could not find that Discord member in this server.', ephemeral: true });
    const announcementType = interaction.options.getString('announcement_type', true);
    return beginConfirmation(
      interaction,
      {
        type: 'staffjourneypost',
        processingMessage: `\u23F3 Preparing ${member}\u2019s Staff Journey announcement...`,
        payload: {
          announcementType,
          memberId: member.id,
          customMessage: interaction.options.getString('custom_message', true).trim(),
          rankKey: interaction.options.getString('rank') || null,
        },
      },
      `Are you sure you want to post a **${announcementType}** Staff Journey announcement for ${member}?`,
      { destructiveLabel: 'Confirm Post' },
    );
  },
};
