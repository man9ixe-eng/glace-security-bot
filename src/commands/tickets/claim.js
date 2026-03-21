"use strict";
const { SlashCommandBuilder } = require("discord.js");
const { claimTicket } = require("../../utils/ticketSystem");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Claim the current ticket (enables you to reply).")
    .setDMPermission(false),

  async execute(interaction) {
    return claimTicket(interaction);
  },
};