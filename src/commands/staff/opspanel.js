'use strict';

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { getTierLabel, getOpsLabel, getTier, getOpsLevel } = require('../../utils/permissions');

function portalUrl() {
  const base = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return base ? `${base}/ops` : null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('opspanel')
    .setDescription('Post the Glace Staff Operations website panel.')
    .setDMPermission(false),

  async execute(interaction) {
    const url = portalUrl();
    if (!url) {
      return interaction.reply({
        content: '❌ Add `PUBLIC_BASE_URL` in Render first, then run `/opspanel` again.',
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('❄ Glace Staff Operations')
      .setDescription([
        'Use the private website for staff documentation, actions, approvals, schedules, updates, and LOA records.',
        '',
        '**Discord stays simple:** panels, live session posts, current LOAs, schedules, updates, and one operations log.',
        '',
        'Website access is read automatically from your Glace roles.',
      ].join('\n'))
      .setColor(0x8b5cf6)
      .setFooter({
        text: `${getOpsLabel(getOpsLevel(interaction.member))} • ${getTierLabel(getTier(interaction.member))}`,
      });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Open Staff Operations')
        .setURL(url),
    );

    await interaction.channel.send({ embeds: [embed], components: [row] });
    return interaction.reply({ content: '✅ Staff Operations panel posted.', ephemeral: true });
  },
};
