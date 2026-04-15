
const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getQuota, setQuota } = require('../../utils/quotaSettings');

const TIER_CHOICES = [
  ['Interns', 'intern'],
  ['Management', 'management'],
  ['Senior Management', 'senior_management'],
  ['Corporate', 'corporate'],
  ['Corporate Board', 'corporate_board'],
  ['Presidentials', 'presidential'],
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('activitysettings')
    .setDescription('Edit quota settings for a tracked tier.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option
        .setName('tier')
        .setDescription('Which tier to edit.')
        .setRequired(true)
        .addChoices(...TIER_CHOICES),
    )
    .addStringOption((option) =>
      option
        .setName('mode')
        .setDescription('Quota type for this tier.')
        .setRequired(true)
        .addChoices(
          { name: 'Regular Sessions', value: 'regular' },
          { name: 'Hosted Sessions', value: 'hosted' },
        ),
    )
    .addIntegerOption((option) =>
      option.setName('total').setDescription('Required total sessions.').setRequired(true).setMinValue(0),
    )
    .addIntegerOption((option) =>
      option.setName('interview').setDescription('Minimum interview sessions.').setRequired(true).setMinValue(0),
    )
    .addIntegerOption((option) =>
      option.setName('training').setDescription('Minimum training sessions.').setRequired(true).setMinValue(0),
    ),

  async execute(interaction) {
    const tier = interaction.options.getString('tier', true);
    const mode = interaction.options.getString('mode', true);
    const total = interaction.options.getInteger('total', true);
    const minInterview = interaction.options.getInteger('interview', true);
    const minTraining = interaction.options.getInteger('training', true);

    const current = getQuota(tier);
    if (!current) {
      await interaction.reply({
        content: 'That quota tier could not be found.',
        ephemeral: true,
      });
      return;
    }

    const updated = setQuota(tier, {
      mode,
      total,
      minInterview,
      minTraining,
    });

    const embed = new EmbedBuilder()
      .setColor(0xf7b2ff)
      .setTitle('✨ Activity Settings Updated')
      .setDescription(`Updated **${updated.label}** quota settings.`)
      .addFields(
        { name: 'Mode', value: updated.mode === 'hosted' ? 'Hosted Sessions' : 'Regular Sessions', inline: true },
        { name: 'Total', value: String(updated.total), inline: true },
        { name: 'Minimum Interviews', value: String(updated.minInterview), inline: true },
        { name: 'Minimum Trainings', value: String(updated.minTraining), inline: true },
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
