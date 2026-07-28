// src/commands/moderation/appealpanel.js
"use strict";

const { SlashCommandBuilder } = require("discord.js");
const { postAppealPanel } = require("../../utils/banAppeals");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("appealpanel")
    .setDescription("Post or refresh the Glace ban appeal panel in #start.")
    .setDMPermission(false),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true }).catch(() => null);

    try {
      const msg = await postAppealPanel(interaction.client);
      await interaction.editReply({ content: `Ban appeal panel posted: ${msg.url}` });
    } catch (err) {
      console.error("[BAN APPEALS] Failed to post appeal panel:", err);
      await interaction.editReply({ content: `I could not post the appeal panel: ${err?.message || "Unknown error"}` });
    }
  },
};
