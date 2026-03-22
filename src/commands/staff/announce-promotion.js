const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
} = require("discord.js");

const ANNOUNCE_CHANNEL_ID = process.env.STAFF_JOURNEY_ANNOUNCEMENTS_CHANNEL_ID;
const PROMOTION_PING_ROLE_ID = process.env.STAFF_JOURNEY_PROMOTION_PING_ROLE_ID;

// Put your REAL custom emoji mentions here if you want them.
// If you do not know them yet, leave as empty strings.
const RANK_EMOJIS = {
  "Leadership Intern": "",
  "Supervisor": "",
  "Assistant Manager": "<:manager_team:1476916258036514837>",
  "Hotel Manager": "",
  "Executive Manager": "",
  "Corporate Intern": "",
  "Junior Corporate": "",
  "Senior Corporate": "",
  "Head Corporate": "",
  "Board Of Directors": "",
  "Presidential Intern": "",
  "Chief Executive Officer": "",
  "Vice President": "",
  "President": "",
};

function clean(text) {
  return (text || "").trim();
}

function rankDisplay(rank) {
  const emoji = RANK_EMOJIS[rank];
  return emoji ? `${emoji} ${rank}` : rank;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("announce-promotion")
    .setDescription("Post a clean promotion announcement")
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
        .setDescription("Member to mention")
        .setRequired(false)
    )
    .addStringOption((o) =>
      o.setName("message")
        .setDescription("Personal message")
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

      const channel = await interaction.client.channels.fetch(ANNOUNCE_CHANNEL_ID).catch(() => null);

      if (!channel) {
        return interaction.reply({
          content: "❌ Announcement channel not found.",
          ephemeral: true,
        });
      }

      if (
        channel.type !== ChannelType.GuildText &&
        channel.type !== ChannelType.GuildAnnouncement
      ) {
        return interaction.reply({
          content: "❌ Announcement channel is not a text channel.",
          ephemeral: true,
        });
      }

      const username = clean(interaction.options.getString("username"));
      const rank = clean(interaction.options.getString("rank"));
      const promoter = interaction.options.getUser("promoter");
      const member = interaction.options.getUser("member");
      const message = clean(interaction.options.getString("message"));
      const trelloLink = clean(interaction.options.getString("trello_link"));

      const embed = new EmbedBuilder()
        .setTitle("🎉 Promotion")
        .setDescription(
          `Please congratulate **${username}** on their promotion to **${rankDisplay(rank)}**!`
        )
        .addFields(
          {
            name: "Promoter",
            value: `${promoter}`,
            inline: true,
          }
        )
        .setColor(0x8f63d2)
        .setFooter({
          text: "Glace Hotels • Staff Journey",
        })
        .setTimestamp();

      if (message) {
        embed.addFields({
          name: "Message",
          value: message,
          inline: false,
        });
      }

      if (trelloLink) {
        embed.addFields({
          name: "Card",
          value: `[View Trello Card](${trelloLink})`,
          inline: false,
        });
      }

      const lines = [];

      if (member) {
        lines.push(`${member}`);
      }

      if (PROMOTION_PING_ROLE_ID) {
        lines.push(`||<@&${PROMOTION_PING_ROLE_ID}>||`);
      }

      await channel.send({
        content: lines.join("\n") || undefined,
        embeds: [embed],
        allowedMentions: {
          users: member ? [member.id, promoter.id] : [promoter.id],
          roles: PROMOTION_PING_ROLE_ID ? [PROMOTION_PING_ROLE_ID] : [],
        },
      });

      await interaction.reply({
        content: `✅ Promotion announcement posted in ${channel}.`,
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