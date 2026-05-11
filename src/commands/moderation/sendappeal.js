// src/commands/moderation/sendappeal.js
"use strict";

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { atLeastTier } = require("../../utils/permissions");
const {
  getLatestAppealForUser,
  sendBanNotice,
  sendAppealInvite,
  formatDateTime,
  formatRelative,
} = require("../../utils/banAppeals");

function cleanDiscordId(value) {
  return String(value || "").replace(/[^0-9]/g, "").trim();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("sendappeal")
    .setDescription("Resend a saved ban appeal notice/button by Discord ID.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
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

    const userId = cleanDiscordId(interaction.options.getString("discord_id", true));
    if (!/^\d{16,25}$/.test(userId)) {
      return interaction.editReply({ content: "Please provide a valid Discord ID." });
    }

    const record = getLatestAppealForUser(interaction.guild.id, userId);
    if (!record) {
      return interaction.editReply({
        content: "I could not find a saved ban appeal case for that Discord ID.",
      });
    }

    if (record.status === "ban_failed") {
      return interaction.editReply({
        content: "That appeal case was marked as failed because the ban did not complete.",
      });
    }

    if (!record.appealable) {
      return interaction.editReply({
        content: "That ban was marked as not appealable.",
      });
    }

    const user = await interaction.client.users.fetch(userId).catch(() => null);
    if (!user) {
      return interaction.editReply({
        content: "I could not fetch that Discord user. Please double-check the ID.",
      });
    }

    const ready = record.availableAt && record.availableAt <= Date.now();
    const result = ready
      ? await sendAppealInvite(interaction.client, record)
      : await sendBanNotice(user, record);

    if (result.ok) {
      return interaction.editReply({
        content:
          `✅ Appeal ${ready ? "button" : "notice"} sent to **${record.userTag}**.\n` +
          `Appeal Opens: ${ready ? "Open now" : `${formatDateTime(record.availableAt)} (${formatRelative(record.availableAt)})`}`,
      });
    }

    return interaction.editReply({
      content:
        `I still could not DM **${record.userTag}**.\n` +
        `Reason: ${result.error || "Discord blocked the DM."}\n\n` +
        "Ask them to open DMs, have at least one mutual server with the bot, or message the bot first if possible, then run `/sendappeal` again.",
    });
  },
};
