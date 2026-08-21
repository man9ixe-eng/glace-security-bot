'use strict';

const { SlashCommandBuilder } = require('discord.js');
const cfg = require('../../config/staffJourney');
const {
  beginConfirmation,
  parseMmDdYyyy,
  resolveTargetMember,
  findJourneyCardForMember,
  currentRankEntry,
  rankByKey,
} = require('../../utils/staffJourneySystem');

module.exports = {
  data: (() => {
    const builder = new SlashCommandBuilder()
      .setName('demote')
      .setDescription('Move an enrolled Staff Journey member down to a lower rank.')
      .setDMPermission(false)
      .addUserOption((o) => o.setName('member').setDescription('Discord member being demoted').setRequired(true))
      .addStringOption((o) => {
        o.setName('new_rank').setDescription('New lower Glace rank').setRequired(true);
        for (const rank of cfg.RANKS) o.addChoices({ name: rank.display, value: rank.key });
        return o;
      })
      .addStringOption((o) => o.setName('date').setDescription('Demotion date in MM/DD/YYYY').setRequired(true).setMaxLength(10));
    return builder;
  })(),

  async execute(interaction) {
    const member = await resolveTargetMember(interaction, 'member');
    if (!member) return interaction.reply({ content: '❌ I could not find that Discord member in this server.', ephemeral: true });
    const date = interaction.options.getString('date', true).trim();
    if (!parseMmDdYyyy(date)) return interaction.reply({ content: '❌ Invalid demotion date. Use MM/DD/YYYY.', ephemeral: true });
    const newRank = rankByKey(interaction.options.getString('new_rank', true));
    const { card } = await findJourneyCardForMember(interaction.guild, member, { includeClosed: false });
    const current = card ? currentRankEntry(card.desc) : null;
    return beginConfirmation(
      interaction,
      {
        type: 'demote',
        processingMessage: `⏳ Updating ${member}’s Staff Journey demotion, this may take a bit...`,
        payload: { memberId: member.id, rankKey: newRank?.key, date },
      },
      `Are you sure you want to demote ${member} from **${current?.rank || 'their current rank'}** to **${newRank?.display || 'Unknown Rank'}**?\n\nNo public announcement will be posted.`,
      { destructiveLabel: 'Confirm Demotion' },
    );
  },
};
