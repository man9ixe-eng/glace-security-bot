const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const {
  getQuotaSettings,
  updateQuotaSettings,
  getQuotaEntry,
} = require('../../utils/quotaSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('activitysettings')
    .setDescription('Edit activity quota settings for a tier.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option
        .setName('tier')
        .setDescription('Which tier to edit')
        .setRequired(true)
        .addChoices(
          { name: 'Intern', value: 'Intern' },
          { name: 'Management', value: 'Management' },
          { name: 'Senior Management', value: 'Senior Management' },
          { name: 'Corporate', value: 'Corporate' },
          { name: 'Corporate Board', value: 'Corporate Board' },
          { name: 'Presidential', value: 'Presidential' },
        ),
    )
    .addIntegerOption((option) =>
      option
        .setName('total')
        .setDescription('Total required sessions')
        .setRequired(false)
        .setMinValue(0),
    )
    .addIntegerOption((option) =>
      option
        .setName('training')
        .setDescription('Minimum required training sessions')
        .setRequired(false)
        .setMinValue(0),
    )
    .addIntegerOption((option) =>
      option
        .setName('interview')
        .setDescription('Minimum required interview sessions')
        .setRequired(false)
        .setMinValue(0),
    )
    .addIntegerOption((option) =>
      option
        .setName('hosting')
        .setDescription('Minimum required hosted sessions (Corporate+ only)')
        .setRequired(false)
        .setMinValue(0),
    )
    .addBooleanOption((option) =>
      option
        .setName('show')
        .setDescription('Show current settings for this tier instead of editing')
        .setRequired(false),
    ),

  async execute(interaction) {
    const tier = interaction.options.getString('tier', true);
    const showOnly = interaction.options.getBoolean('show') ?? false;

    const total = interaction.options.getInteger('total');
    const training = interaction.options.getInteger('training');
    const interview = interaction.options.getInteger('interview');
    const hosting = interaction.options.getInteger('hosting');

    const current = getQuotaEntry(tier);

    if (!current) {
      return interaction.reply({
        content: `No quota settings exist for **${tier}**.`,
        ephemeral: true,
      });
    }

    if (
      showOnly ||
      [total, training, interview, hosting].every((value) => value === null)
    ) {
      const embed = new EmbedBuilder()
        .setColor(0x8fd3ff)
        .setTitle('✨ Activity Settings')
        .setDescription(`Viewing quota settings for **${tier}**`)
        .addFields(
          { name: '📊 Total Required', value: String(current.total ?? 0), inline: true },
          { name: '🎓 Min Trainings', value: String(current.training ?? 0), inline: true },
          { name: '🗣️ Min Interviews', value: String(current.interview ?? 0), inline: true },
          { name: '🏨 Min Hosted', value: String(current.hosting ?? 0), inline: true },
        );

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const next = {
      ...current,
      ...(total !== null ? { total } : {}),
      ...(training !== null ? { training } : {}),
      ...(interview !== null ? { interview } : {}),
      ...(hosting !== null ? { hosting } : {}),
    };

    if ((next.training ?? 0) + (next.interview ?? 0) > (next.total ?? 0)) {
      return interaction.reply({
        content:
          'The sum of minimum trainings and minimum interviews cannot be greater than the total required sessions.',
        ephemeral: true,
      });
    }

    updateQuotaSettings(tier, next);

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('✅ Activity Settings Updated')
      .setDescription(`Updated quota settings for **${tier}**`)
      .addFields(
        { name: '📊 Total Required', value: String(next.total ?? 0), inline: true },
        { name: '🎓 Min Trainings', value: String(next.training ?? 0), inline: true },
        { name: '🗣️ Min Interviews', value: String(next.interview ?? 0), inline: true },
        { name: '🏨 Min Hosted', value: String(next.hosting ?? 0), inline: true },
      );

    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};