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
      .setName('promote')
      .setDescription('Promote an enrolled Staff Journey member.')
      .setDMPermission(false)
      .addUserOption((o) => o.setName('member').setDescription('Discord member being promoted').setRequired(true))
      .addStringOption((o) => {
        o.setName('new_rank').setDescription('New Glace rank').setRequired(true);
        for (const rank of cfg.RANKS) o.addChoices({ name: rank.display, value: rank.key });
        return o;
      })
      .addUserOption((o) => o.setName('promoter').setDescription('Who promoted them').setRequired(true))
      .addStringOption((o) => o.setName('promotion_date').setDescription('Promotion date in MM/DD/YYYY').setRequired(true).setMaxLength(10))
      .addStringOption((o) => o.setName('custom_message').setDescription('Personal promotion message for the announcement').setRequired(true).setMaxLength(700))
      .addUserOption((o) => o.setName('promoter_2').setDescription('Optional second promoter').setRequired(false));
    return builder;
  })(),

  async execute(interaction) {
    const member = await resolveTargetMember(interaction, 'member');
    if (!member) return interaction.reply({ content: '❌ I could not find that Discord member in this server.', ephemeral: true });
    const date = interaction.options.getString('promotion_date', true).trim();
    if (!parseMmDdYyyy(date)) return interaction.reply({ content: '❌ Invalid promotion date. Use MM/DD/YYYY.', ephemeral: true });
    const rankKey = interaction.options.getString('new_rank', true);
    const newRank = rankByKey(rankKey);
    const { card } = await findJourneyCardForMember(interaction.guild, member, { includeClosed: false });
    const current = card ? currentRankEntry(card.desc) : null;
    const oldRank = current?.rank || 'Unknown Rank';
    const promoter = interaction.options.getUser('promoter', true);
    const promoter2 = interaction.options.getUser('promoter_2');

    return beginConfirmation(
      interaction,
      {
        type: 'promote',
        processingMessage: `⏳ Updating ${member}’s Staff Journey promotion, this may take a bit...`,
        payload: {
          memberId: member.id,
          rankKey,
          promoterIds: [promoter.id, promoter2?.id].filter(Boolean),
          promotionDate: date,
          customMessage: interaction.options.getString('custom_message', true).trim(),
        },
      },
      `Are you sure you want to promote ${member} from **${oldRank}** to **${newRank?.display || 'Unknown Rank'}**?`,
      { canPost: true, destructiveLabel: 'Confirm Promotion' },
    );
  },
};
