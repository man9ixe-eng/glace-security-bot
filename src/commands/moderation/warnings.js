// src/commands/moderation/warnings.js

const { SlashCommandBuilder } = require("discord.js");
const { getWarnings } = require("../../utils/warningsStore");

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
    .setName("warnings")
    .setDescription("View your warnings.")
    .setDMPermission(false),

  async execute(interaction) {
    const targetUser = interaction.user;
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
      output +=
        `#${index + 1} - ${formatTimestamp(warn.timestamp)}\n` +
        `> ${warn.reason}\n` +
        `---------------------------------\n`;
    });

    if (output.length > 1900) {
      output = output.slice(0, 1900) + "\n(Output truncated)";
    }

    return interaction.reply({
      content: output,
      ephemeral: true,
    });
  },
};
