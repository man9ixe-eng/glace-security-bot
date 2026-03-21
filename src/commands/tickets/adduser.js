"use strict";
const { SlashCommandBuilder } = require("discord.js");
const { addUserToTicket } = require("../../utils/ticketSystem");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("adduser")
    .setDescription("Add a user to this ticket.")
    .addUserOption((opt) => opt.setName("user").setDescription("User to add").setRequired(true))
    .addStringOption((opt) => opt.setName("reason").setDescription("Why?").setRequired(false))
    .setDMPermission(false),

  async execute(interaction) {
    const user = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason") || "No reason provided";
    return addUserToTicket(interaction, user, reason);
  },
};