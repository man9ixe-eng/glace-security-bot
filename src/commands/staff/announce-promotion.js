const {
  SlashCommandBuilder,
  ChannelType,
  EmbedBuilder,
} = require("discord.js");

const ANNOUNCE_CHANNEL_ID = process.env.STAFF_UPDATES_CHANNEL_ID || process.env.STAFF_POSTS_CHANNEL_ID || process.env.STAFF_JOURNEY_ANNOUNCEMENTS_CHANNEL_ID;
const PROMOTION_PING_ROLE_ID = process.env.STAFF_JOURNEY_PROMOTION_PING_ROLE_ID;

const RANK_EMOJIS = {
  "Assistant Manager": "<:manager_team:1476916258036514837>",
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
    .setDescription("Post a clean promotion announcement")
    .setDMPermission(false)
    .addStringOption((o) =>
      o.setName("username").setDescription("Promoted username").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("rank").setDescription("New rank").setRequired(true)
    )
    .addUserOption((o) =>
      o.setName("promoter").setDescription("Promoter").setRequired(true)
    )
    .addUserOption((o) =>
      o.setName("member").setDescription("Member mention").setRequired(false)
    )
    .addStringOption((o) =>
      o.setName("message").setDescription("Personal message").setRequired(false)
    )
    .addStringOption((o) =>
      o.setName("trello_link").setDescription("Trello card").setRequired(false)
    ),

  async execute(interaction) {
    try {
      if (!ANNOUNCE_CHANNEL_ID) {
        return interaction.reply({
          content: "❌ Add STAFF_UPDATES_CHANNEL_ID (or STAFF_POSTS_CHANNEL_ID) in Render.",
          ephemeral: true,
        });
      }

      const channel = await interaction.client.channels.fetch(ANNOUNCE_CHANNEL_ID).catch(() => null);

      if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
        return interaction.reply({
          content: "❌ Invalid announcement channel.",
          ephemeral: true,
        });
      }

      const username = clean(interaction.options.getString("username"));
      const rank = clean(interaction.options.getString("rank"));
      const promoter = interaction.options.getUser("promoter");
      const member = interaction.options.getUser("member");
      const message = clean(interaction.options.getString("message"));
      const trelloLink = clean(interaction.options.getString("trello_link"));

      // =========================
      // BIGGER / CLEANER EMBED
      // =========================
      const embed = new EmbedBuilder()
        .setTitle("🎉 PROMOTION")
        .setColor(0x8f63d2)
        .setDescription(
          `Please congratulate **${username}** on their promotion to ${rankDisplay(rank)}!`
        )
        .addFields(
          {
            name: "━━━━━━━━━━━━━━━━━━━━",
            value: message
              ? `> ${message}\n> \n> **Promoter:** ${promoter}`
              : `> **Promoter:** ${promoter}`,
            inline: false,
          }
        )
        .setFooter({
          text: "Glace Hotels • Staff Journey",
        })
        .setTimestamp();

      if (trelloLink) {
        embed.addFields({
          name: "🔗 Trello Card",
          value: `[Click to View](${trelloLink})`,
          inline: false,
        });
      }

      // =========================
      // MESSAGE STRUCTURE
      // =========================
      const bottomPings = [];

      if (member) {
        bottomPings.push(`${member}`);
      }

      if (PROMOTION_PING_ROLE_ID) {
        bottomPings.push(`||<@&${PROMOTION_PING_ROLE_ID}>||`);
      }

      await channel.send({
        embeds: [embed],
        content: bottomPings.join("\n") || undefined,
        allowedMentions: {
          users: member ? [member.id, promoter.id] : [promoter.id],
          roles: PROMOTION_PING_ROLE_ID ? [PROMOTION_PING_ROLE_ID] : [],
        },
      });

      await interaction.reply({
        content: `✅ Promotion posted in ${channel}.`,
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