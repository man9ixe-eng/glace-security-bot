"use strict";
const { SlashCommandBuilder } = require("discord.js");
const { promptClose } = require("../../utils/ticketSystem");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("close")
    .setDescription("Ask the opener to confirm closing the ticket.")
    .setDMPermission(false),

  async execute(interaction) {
    // \u2705 fast ack
    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }
    } catch {}

    // promptClose handles perms + dedupe
    await promptClose(interaction);
    // promptClose already replies ephemeral via respondEphemeral,
    // but since we deferred in this command, ensure we end the defer cleanly:
    try {
      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({ content: "\u2705 Close prompt sent." });
      }
    } catch {}
  },
};