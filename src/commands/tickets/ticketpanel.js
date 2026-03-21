"use strict";
const { SlashCommandBuilder } = require("discord.js");
const { postPanel } = require("../../utils/ticketSystem");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription("Post a ticket panel for a specific type.")
    .addStringOption((opt) =>
      opt
        .setName("type")
        .setDescription("corporate | ingame | kick | ban | pban")
        .setRequired(true)
    )
    .setDMPermission(false),

  async execute(interaction) {
    const type = interaction.options.getString("type", true);
    return postPanel(interaction, type);
  },
};