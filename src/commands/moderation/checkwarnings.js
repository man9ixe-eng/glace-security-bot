// src/commands/moderation/checkwarnings.js

const { SlashCommandBuilder } = require("discord.js");
const { getWarnings } = require("../../utils/warningsStore");
const { atLeastTier } = require("../../utils/permissions");

function formatTimestamp(ts) {
  const date = new Date(ts);

  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yyyy = date.getFullYear();

  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;

  return `${mm}/${dd}/${yyyy} - ${hours}:${minutes} ${ampm}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("checkwarnings")
    .setDescription("View warnings for another user (Tier 4+).")
    .setDMPermission(false)
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User to view warnings for")
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!atLeastTier(interaction.member, 4)) {
      return interaction.reply({
        content: "You must be at least **Tier 4 (Management)** to use `/checkwarnings`.",
        ephemeral: true,
      });
    }

    const targetUser = interaction.options.getUser("user", true);
    const guildId = interaction.guild.id;

    const warnings = getWarnings(guildId, targetUser.id);

    if (!warnings || warnings.length === 0) {
      return interaction.reply({
        content: `Warnings for ${targetUser.username}:\n\nNo warnings found.`,
        ephemeral: true,
      });
    }

    let output = `Warnings for ${targetUser.username}:\n\n`;

    warnings.forEach((warn, index) => {
      const modTag = warn.moderatorTag || "Unknown Moderator";

      output +=
        `#${index + 1} - ${formatTimestamp(warn.timestamp)} - (${modTag})\n` +
        `> ${warn.reason}\n` +
        `---------------------------------\n`;
    });

    if (output.length > 1900) {
      output = output.slice(0, 1900) + "\n(Output truncated)";
    }

    return interaction.reply({
      content: output,
      ephemeral: false,
    });
  },
};
