// src/commands/moderation/ban.js
"use strict";

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { atLeastTier } = require("../../utils/permissions");
const { logModerationAction } = require("../../utils/modlog");
const {
  getRuleById,
  getRuleChoices,
  createBanAppealRecord,
  sendBanNotice,
  markBanFailed,
  formatDateTime,
  formatRelative,
} = require("../../utils/banAppeals");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member and set their appeal status.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The member to ban.")
        .setRequired(true)
    )
    .addStringOption((option) => {
      option
        .setName("rule_violation")
        .setDescription("The server rule they broke.")
        .setRequired(true);

      for (const choice of getRuleChoices()) option.addChoices(choice);
      return option;
    })
    .addStringOption((option) =>
      option
        .setName("appealable")
        .setDescription("Can this ban be appealed?")
        .setRequired(true)
        .addChoices({ name: "Yes", value: "yes" }, { name: "No", value: "no" })
    )
    .addIntegerOption((option) =>
      option
        .setName("appeal_cooldown_days")
        .setDescription("Days before they can appeal. Use 0 for immediate appeals.")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(365)
    ),

  async execute(interaction) {
    if (!atLeastTier(interaction.member, 5)) {
      return interaction.reply({
        content: "You must be at least **Tier 5 (Senior Management)** to use `/ban`.",
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: false }).catch(() => null);

    const user = interaction.options.getUser("user", true);
    const ruleId = interaction.options.getString("rule_violation", true);
    const appealable = interaction.options.getString("appealable", true) === "yes";
    const cooldownDays = interaction.options.getInteger("appeal_cooldown_days", true);
    const rule = getRuleById(ruleId);

    if (!rule) {
      return interaction.editReply({ content: "I could not find that rule. Please redeploy the command and try again." });
    }

    if (user.id === interaction.user.id) {
      return interaction.editReply({ content: "You cannot ban yourself." });
    }

    if (user.id === interaction.client.user.id) {
      return interaction.editReply({ content: "I cannot ban myself." });
    }

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (member && !member.bannable) {
      return interaction.editReply({
        content: "I cannot ban this member. They might have a higher role than me.",
      });
    }

    const reason = `${rule.label} | Appealable: ${appealable ? "Yes" : "No"} | Cooldown: ${cooldownDays} day(s)`;

    // Important: send/save the appeal notice BEFORE banning.
    // After a ban, Discord may block the DM because the user no longer shares the server with the bot.
    const record = createBanAppealRecord({
      guild: interaction.guild,
      user,
      moderator: interaction.user,
      rule,
      appealable,
      cooldownDays,
    });

    const dmResult = await sendBanNotice(user, record);

    try {
      await interaction.guild.members.ban(user.id, { reason });

      const appealLine = !appealable
        ? "Not appealable"
        : cooldownDays === 0
          ? "Open now"
          : `${formatDateTime(record.availableAt)} (${formatRelative(record.availableAt)})`;

      const dmText = dmResult.ok ? "Sent" : `Failed / ${dmResult.error || "DMs may be closed"}`;

      await interaction.editReply({
        content:
          `✅ Banned **${user.tag || user.username}**.\n` +
          `**Rule:** ${rule.label}\n` +
          `**Appeal:** ${appealable ? "Yes" : "No"}\n` +
          `**Appeal Opens:** ${appealLine}\n` +
          `**DM:** ${dmText}` +
          `${dmResult.ok ? "" : "\nUse `/sendappeal` after they open DMs if you need to retry."}`,
      });

      await logModerationAction(interaction, {
        action: "Ban",
        targetUser: user,
        reason: rule.label,
        details:
          `Appealable: ${appealable ? "Yes" : "No"}\n` +
          `Appeal Cooldown: ${cooldownDays} day(s)\n` +
          `Appeal Opens: ${appealable ? formatDateTime(record.availableAt) : "Not available"}\n` +
          `DM Status: ${dmText}\n` +
          `Appeal Case: ${record.id}`,
      });
    } catch (error) {
      console.error("[BAN] Failed to ban member:", error);
      markBanFailed(record.id, error?.message || String(error));
      await interaction.editReply({
        content:
          "I could not ban that member. Check my permissions and role position.\n" +
          `The saved appeal case was marked as failed: ${record.id}`,
      });
    }
  },
};
