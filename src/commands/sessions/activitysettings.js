const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
  updateQuotaSettings,
  getQuotaEntry,
} = require('../../utils/quotaSettings');

function addQuotaFields(embed, entry) {
  const raw = entry.raw || {};
  const displayTotal =
    raw.mode === 'regular_and_cohost'
      ? Number(raw.total || 0) + Number(raw.cohostTotal || 0)
      : Number(raw.total || 0) + Number(raw.hostedTotal || 0) + Number(raw.cohostTotal || 0) + Number(raw.minOverseer || 0);

  return embed.addFields(
    { name: '\uD83D\uDCCA Req Total/Regular', value: String(entry.total ?? 0), inline: true },
    { name: '\u2728 Display Total', value: String(displayTotal || 0), inline: true },
    { name: '\uD83C\uDFE8 Req Hosted', value: String(entry.hosting ?? 0), inline: true },
    { name: '\uD83E\uDD1D Req Co-Host', value: String(entry.cohost ?? 0), inline: true },
    { name: '\uD83D\uDC40 Req Overseer', value: String(entry.overseer ?? 0), inline: true },
    { name: '\uD83D\uDFE3 Req Shift Minutes', value: String(entry.shiftMinutes ?? 0), inline: true },
    {
      name: '\uD83D\uDFE1 / \uD83D\uDD34 Split',
      value: [
        `Interview Min: ${raw.minInterview ?? raw.hostedInterview ?? raw.cohostInterview ?? raw.overseerInterview ?? 0}`,
        `Training Min: ${raw.minTraining ?? raw.hostedTraining ?? raw.cohostTraining ?? raw.overseerTraining ?? 0}`,
      ].join('\n'),
      inline: true,
    },
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('activitysettings')
    .setDescription('Edit activity quota settings for a tier.')
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName('tier')
        .setDescription('Which tier to edit')
        .setRequired(true)
        .addChoices(
          { name: 'Intern', value: 'Intern' },
          { name: 'Management', value: 'Management' },
          { name: 'Senior Management', value: 'Senior Management' },
          { name: 'Corporate Intern', value: 'Corporate Intern' },
          { name: 'Corporate', value: 'Corporate' },
          { name: 'Head Corporate', value: 'Head Corporate' },
          { name: 'Corporate Board', value: 'Corporate Board' },
          { name: 'Presidential', value: 'Presidential' },
        ),
    )
    .addIntegerOption((option) =>
      option
        .setName('total')
        .setDescription('Required regular/non-cohost support sessions')
        .setRequired(false)
        .setMinValue(0),
    )
    .addIntegerOption((option) =>
      option
        .setName('hosting')
        .setDescription('Required hosted sessions')
        .setRequired(false)
        .setMinValue(0),
    )
    .addIntegerOption((option) =>
      option
        .setName('cohost')
        .setDescription('Required co-host sessions')
        .setRequired(false)
        .setMinValue(0),
    )
    .addIntegerOption((option) =>
      option
        .setName('overseer')
        .setDescription('Required overseer sessions')
        .setRequired(false)
        .setMinValue(0),
    )
    .addIntegerOption((option) =>
      option
        .setName('shift_minutes')
        .setDescription('Required shift minutes')
        .setRequired(false)
        .setMinValue(0),
    )
    .addIntegerOption((option) =>
      option
        .setName('interview')
        .setDescription('Minimum interview requirement for the edited quota type')
        .setRequired(false)
        .setMinValue(0),
    )
    .addIntegerOption((option) =>
      option
        .setName('training')
        .setDescription('Minimum training requirement for the edited quota type')
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
    const hosting = interaction.options.getInteger('hosting');
    const cohost = interaction.options.getInteger('cohost');
    const overseer = interaction.options.getInteger('overseer');
    const shiftMinutes = interaction.options.getInteger('shift_minutes');
    const interview = interaction.options.getInteger('interview');
    const training = interaction.options.getInteger('training');

    const current = getQuotaEntry(tier);

    if (!current) {
      return interaction.reply({
        content: `No quota settings exist for **${tier}**.`,
        ephemeral: true,
      });
    }

    const noChanges = [total, hosting, cohost, overseer, shiftMinutes, interview, training]
      .every((value) => value === null);

    if (showOnly || noChanges) {
      const embed = addQuotaFields(
        new EmbedBuilder()
          .setColor(0x8fd3ff)
          .setTitle('\u2728 Activity Settings')
          .setDescription(`Viewing quota settings for **${tier}**`),
        current,
      );

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const updated = updateQuotaSettings(tier, {
      ...(total !== null ? { total } : {}),
      ...(hosting !== null ? { hosting } : {}),
      ...(cohost !== null ? { cohost } : {}),
      ...(overseer !== null ? { overseer } : {}),
      ...(shiftMinutes !== null ? { shiftMinutes } : {}),
      ...(interview !== null ? { interview } : {}),
      ...(training !== null ? { training } : {}),
    });

    const next = getQuotaEntry(tier) || { raw: updated };

    const embed = addQuotaFields(
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('\u2705 Activity Settings Updated')
        .setDescription(`Updated quota settings for **${tier}**`),
      next,
    );

    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
