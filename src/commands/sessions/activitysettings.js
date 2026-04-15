const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { setQuota, getQuota } = require('../../utils/quotaSettings');

const tiers = [
  'Intern',
  'Management',
  'Senior Management',
  'Corporate',
  'Corporate Board',
  'Presidentials',
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('activitysettings')
    .setDescription('Edit activity quota requirements for a tier.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option
        .setName('tier')
        .setDescription('The quota tier to edit.')
        .setRequired(true)
        .addChoices(...tiers.map((tier) => ({ name: tier, value: tier }))),
    )
    .addIntegerOption((option) =>
      option.setName('total').setDescription('Required total sessions.').setRequired(true).setMinValue(0),
    )
    .addIntegerOption((option) =>
      option.setName('interview').setDescription('Minimum interviews required.').setRequired(true).setMinValue(0),
    )
    .addIntegerOption((option) =>
      option.setName('training').setDescription('Minimum trainings required.').setRequired(true).setMinValue(0),
    )
    .addIntegerOption((option) =>
      option.setName('hosting').setDescription('Minimum hosted sessions required.').setRequired(false).setMinValue(0),
    ),

  async execute(interaction) {
    const tier = interaction.options.getString('tier', true);
    const total = interaction.options.getInteger('total', true);
    const interview = interaction.options.getInteger('interview', true);
    const training = interaction.options.getInteger('training', true);
    const previous = getQuota(tier);

    let hosting = interaction.options.getInteger('hosting');
    if (hosting == null) hosting = previous?.hosting || 0;

    const updated = setQuota(tier, { total, interview, training, hosting });

    const embed = new EmbedBuilder()
      .setColor(0xffb6f2)
      .setTitle('✨ Activity Settings Updated')
      .setDescription(`The quota for **${tier}** has been saved.`)
      .addFields(
        {
          name: '🌷 New Requirement',
          value:
            `Total: **${updated.total}**\n` +
            `Interviews: **${updated.interview}**\n` +
            `Trainings: **${updated.training}**\n` +
            `Hosting: **${updated.hosting}**`,
        },
        {
          name: '🫧 Previous Requirement',
          value: previous
            ? `Total: **${previous.total}**\nInterviews: **${previous.interview}**\nTrainings: **${previous.training}**\nHosting: **${previous.hosting}**`
            : 'No previous value was stored.',
        },
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
