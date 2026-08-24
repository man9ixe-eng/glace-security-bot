"use strict";
const { SlashCommandBuilder } = require("discord.js");
const { forceCloseTicket } = require("../../utils/ticketSystem");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("forceclose") // \u2705 MUST BE forceclose (yours was accidentally close)
    .setDescription("Force close this ticket now (claimer/admin/reviewer only).")
    .addStringOption((opt) =>
      opt.setName("reason").setDescription("Reason for closing").setRequired(false)
    )
    .setDMPermission(false),

  async execute(interaction) {
    // ACK instantly
    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }
    } catch {}

    const reason = interaction.options.getString("reason") || "No reason provided";
    return forceCloseTicket(interaction, reason);
  },
};