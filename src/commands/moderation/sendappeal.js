// src/commands/moderation/sendappeal.js
"use strict";

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { atLeastTier } = require("../../utils/permissions");
const { sendAppealNoticeById } = require("../../utils/banAppeals");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("sendappeal")
    .setDescription("Retry sending a user's ban appeal notice through DM.")
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName("discord_id")
        .setDescription("The banned user's Discord ID.")
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!atLeastTier(interaction.member, 5)) {
      return interaction.reply({
        content: "You must be at least **Tier 5 (Senior Management)** to use `/sendappeal`.",
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true }).catch(() => null);
    const discordId = interaction.options.getString("discord_id", true).replace(/\D/g, "");

    if (!discordId) {
      return interaction.editReply({ content: "Please provide a valid Discord ID." });
    }

    const result = await sendAppealNoticeById(interaction.client, discordId);
    return interaction.editReply({ content: result.message || (result.ok ? "Appeal notice sent." : "I could not send the appeal notice.") });
  },
};
