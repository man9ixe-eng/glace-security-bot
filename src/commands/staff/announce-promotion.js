const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require("discord.js");

const ANNOUNCE_CHANNEL_ID = process.env.STAFF_JOURNEY_ANNOUNCEMENTS_CHANNEL_ID;
const PROMOTION_PING_ROLE_ID = process.env.STAFF_JOURNEY_PROMOTION_PING_ROLE_ID;

// You can customize these to your actual rank emojis
const RANK_EMOJIS = {
  "Leadership Intern": "<:intern_team:1476916258036514800>",
  "Supervisor": "<:management_team:1476916258036514810>",
  "Assistant Manager": "<:manager_team:1476916258036514837>",
  "Hotel Manager": "<:manager_team:1476916258036514837>",
  "Executive Manager": "<:senior_management_team:1476916258036514845>",
  "Corporate Intern": "<:senior_management_team:1476916258036514845>",
  "Junior Corporate": "<:corporate_team:1476916258036514855>",
  "Senior Corporate": "<:corporate_team:1476916258036514855>",
  "Head Corporate": "<:corporate_team:1476916258036514855>",
  "Board Of Directors": "<:corporate_board_team:1476916258036514865>",
  "Presidential Intern": "<:corporate_board_team:1476916258036514865>",
  "Chief Executive Officer": "<:presidential_team:1476916258036514875>",
  "Vice President": "<:presidential_team:1476916258036514875>",
  "President": "<:presidential_team:1476916258036514875>",
};

function clean(text) {
  return (text || "").trim();
}

function rankDisplay(rank) {
  const emoji = RANK_EMOJIS[rank];
  return emoji ? `${emoji} **${rank}**` : `**${rank}**`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("announce-promotion")
    .setDescription("Post a promotion announcement in the Staff Journey announcements channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) =>
      o.setName("username")
        .setDescription("Promoted username")
        .setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("rank")
        .setDescription("New rank")
        .setRequired(true)
    )
    .addUserOption((o) =>
      o.setName("promoter")
        .setDescription("Promoter to mention")
        .setRequired(true)
    )
    .addUserOption((o) =>
      o.setName("member")
        .setDescription("Member to mention in the announcement")
        .setRequired(false)
    )
    .addStringOption((o) =>
      o.setName("message")
        .setDescription("Personal message / blurb")
        .setRequired(false)
    )
    .addStringOption((o) =>
      o.setName("trello_link")
        .setDescription("Trello card link")
        .setRequired(false)
    ),

  async execute(interaction) {
    try {
      if (!ANNOUNCE_CHANNEL_ID) {
        return interaction.reply({
          content: "❌ Missing STAFF_JOURNEY_ANNOUNCEMENTS_CHANNEL_ID env.",
          ephemeral: true,
        });
      }

      const targetChannel = await interaction.client.channels.fetch(ANNOUNCE_CHANNEL_ID).catch(() => null);

      if (!targetChannel) {
        return interaction.reply({
          content: "❌ Announcement channel could not be found.",
          ephemeral: true,
        });
      }

      if (
        targetChannel.type !== ChannelType.GuildText &&
        targetChannel.type !== ChannelType.GuildAnnouncement
      ) {
        return interaction.reply({
          content: "❌ Announcement channel is not a valid text channel.",
          ephemeral: true,
        });
      }

      const username = clean(interaction.options.getString("username"));
      const rank = clean(interaction.options.getString("rank"));
      const promoter = interaction.options.getUser("promoter");
      const member = interaction.options.getUser("member");
      const message = clean(interaction.options.getString("message"));
      const trelloLink = clean(interaction.options.getString("trello_link"));

      const mentionLine = member ? `Mentions: ${member}\n` : "";
      const trelloLine = trelloLink ? `[${username}](${trelloLink})\n` : "";
      const pingLine = PROMOTION_PING_ROLE_ID ? `|| <@&${PROMOTION_PING_ROLE_ID}> ||` : "";

      const blurbBlock = message
        ? `> ${message}\n> \n> Promoter - ${promoter}`
        : `> Promoter - ${promoter}`;

      const content =
`# 🎉 **PROMOTION** 🎉
-# -

Please congratulate **${username}** on their promotion to ${rankDisplay(rank)}!

${blurbBlock}

${mentionLine}${trelloLine}${pingLine}`.trim();

      await targetChannel.send({ content });

      await interaction.reply({
        content: `✅ Promotion announcement posted in ${targetChannel}.`,
        ephemeral: true,
      });
    } catch (err) {
      console.error("[ANNOUNCE PROMOTION ERROR]", err);
      await interaction.reply({
        content: "❌ Failed to post promotion announcement.",
        ephemeral: true,
      });
    }
  },
};