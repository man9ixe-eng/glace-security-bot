const {
  SlashCommandBuilder,
  ChannelType,
  EmbedBuilder,
} = require("discord.js");
const axios = require("axios");

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const BOARD_ID = process.env.STAFF_JOURNEY_BOARD_ID;

const PROMOTIONS_LIST_ID = process.env.PROMOTIONS_LIST_ID;
const LABEL_RECENTLY_PROMOTED = process.env.LABEL_RECENTLY_PROMOTED;

const ANNOUNCE_CHANNEL_ID = process.env.STAFF_JOURNEY_ANNOUNCEMENTS_CHANNEL_ID;
const PROMOTION_PING_ROLE_ID = process.env.STAFF_JOURNEY_PROMOTION_PING_ROLE_ID;
const GH_LOGO_URL = process.env.GH_LOGO_URL;

// =========================
// RANK CONFIG
// =========================
const RANK_CONFIG = {
  "Leadership Intern": {
    listId: process.env.LEADERSHIP_INTERN_LIST_ID,
    rankLabel: process.env.LABEL_LEADERSHIP_INTERN,
    teamLabel: process.env.LABEL_INTERN,
  },
  "Supervisor": {
    listId: process.env.SUPERVISOR_LIST_ID,
    rankLabel: process.env.LABEL_SUPERVISOR,
    teamLabel: process.env.LABEL_MANAGEMENT,
  },
  "Assistant Manager": {
    listId: process.env.ASSISTANT_MANAGER_LIST_ID,
    rankLabel: process.env.LABEL_ASSISTANT_MANAGER,
    teamLabel: process.env.LABEL_MANAGEMENT,
  },
  "Hotel Manager": {
    listId: process.env.HOTEL_MANAGER_LIST_ID,
    rankLabel: process.env.LABEL_HOTEL_MANAGER,
    teamLabel: process.env.LABEL_MANAGEMENT,
  },
  "Executive Manager": {
    listId: process.env.EXECUTIVE_MANAGER_LIST_ID,
    rankLabel: process.env.LABEL_EXECUTIVE_MANAGER,
    teamLabel: process.env.LABEL_SENIOR_MANAGEMENT,
  },
  "Corporate Intern": {
    listId: process.env.CORPORATE_INTERN_LIST_ID,
    rankLabel: process.env.LABEL_CORPORATE_INTERN,
    teamLabel: process.env.LABEL_SENIOR_MANAGEMENT,
  },
  "Junior Corporate": {
    listId: process.env.JUNIOR_CORPORATE_LIST_ID,
    rankLabel: process.env.LABEL_JUNIOR_CORPORATE,
    teamLabel: process.env.LABEL_CORPORATE,
  },
  "Senior Corporate": {
    listId: process.env.SENIOR_CORPORATE_LIST_ID,
    rankLabel: process.env.LABEL_SENIOR_CORPORATE,
    teamLabel: process.env.LABEL_CORPORATE,
  },
  "Head Corporate": {
    listId: process.env.HEAD_CORPORATE_LIST_ID,
    rankLabel: process.env.LABEL_HEAD_CORPORATE,
    teamLabel: process.env.LABEL_CORPORATE,
  },
  "Board Of Directors": {
    listId: process.env.BOARD_OF_DIRECTORS_LIST_ID,
    rankLabel: process.env.LABEL_BOARD_OF_DIRECTORS,
    teamLabel: process.env.LABEL_CORPORATE_BOARD,
  },
  "Presidential Intern": {
    listId: process.env.PRESIDENTIAL_INTERN_LIST_ID,
    rankLabel: process.env.LABEL_PRESIDENTIAL_INTERN,
    teamLabel: process.env.LABEL_CORPORATE_BOARD,
  },
  "Chief Executive Officer": {
    listId: process.env.CHIEF_EXECUTIVE_OFFICER_LIST_ID,
    rankLabel: process.env.LABEL_CHIEF_EXECUTIVE_OFFICER,
    teamLabel: process.env.LABEL_PRESIDENTIAL,
  },
  "Vice President": {
    listId: process.env.VICE_PRESIDENT_LIST_ID,
    rankLabel: process.env.LABEL_VICE_PRESIDENT,
    teamLabel: process.env.LABEL_PRESIDENTIAL,
  },
  "President": {
    listId: process.env.PRESIDENT_LIST_ID,
    rankLabel: process.env.LABEL_PRESIDENT,
    teamLabel: process.env.LABEL_PRESIDENTIAL,
  },
};

const ALL_RANK_LABELS = [
  process.env.LABEL_LEADERSHIP_INTERN,
  process.env.LABEL_SUPERVISOR,
  process.env.LABEL_ASSISTANT_MANAGER,
  process.env.LABEL_HOTEL_MANAGER,
  process.env.LABEL_EXECUTIVE_MANAGER,
  process.env.LABEL_CORPORATE_INTERN,
  process.env.LABEL_JUNIOR_CORPORATE,
  process.env.LABEL_SENIOR_CORPORATE,
  process.env.LABEL_HEAD_CORPORATE,
  process.env.LABEL_BOARD_OF_DIRECTORS,
  process.env.LABEL_PRESIDENTIAL_INTERN,
  process.env.LABEL_CHIEF_EXECUTIVE_OFFICER,
  process.env.LABEL_VICE_PRESIDENT,
  process.env.LABEL_PRESIDENT,
].filter(Boolean);

const ALL_TEAM_LABELS = [
  process.env.LABEL_INTERN,
  process.env.LABEL_MANAGEMENT,
  process.env.LABEL_SENIOR_MANAGEMENT,
  process.env.LABEL_CORPORATE,
  process.env.LABEL_CORPORATE_BOARD,
  process.env.LABEL_PRESIDENTIAL,
].filter(Boolean);

// =========================
// DATE HELPERS
// =========================
function getTodayMmDdYyyy() {
  return new Date().toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
}

function parseMmDdYyyy(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const parts = dateStr.split("/");
  if (parts.length !== 3) return null;

  const [mm, dd, yyyy] = parts.map(Number);
  if (!mm || !dd || !yyyy) return null;

  return { mm, dd, yyyy };
}

function localNoonFromMmDdYyyy(dateStr) {
  const parsed = parseMmDdYyyy(dateStr);
  if (!parsed) return null;
  return new Date(parsed.yyyy, parsed.mm - 1, parsed.dd, 12, 0, 0, 0);
}

function formatPrettyDate(dateStr) {
  const d = localNoonFromMmDdYyyy(dateStr);
  if (!d) return null;

  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDueNextMonth(dateStr) {
  const d = localNoonFromMmDdYyyy(dateStr);
  if (!d) return null;

  const originalDay = d.getDate();
  d.setMonth(d.getMonth() + 1);

  if (d.getDate() !== originalDay) {
    d.setDate(0);
    d.setHours(12, 0, 0, 0);
  }

  return d.toISOString();
}

function durationBetweenPrettyAndInput(prettyStartDate, newDateStr) {
  const start = new Date(prettyStartDate);
  const end = localNoonFromMmDdYyyy(newDateStr);

  if (Number.isNaN(start.getTime()) || !end) return null;

  let months =
    (end.getFullYear() - start.getFullYear()) * 12 +
    (end.getMonth() - start.getMonth());

  if (end.getDate() < start.getDate()) {
    months -= 1;
  }

  if (months >= 1) {
    return months === 1 ? "1 month" : `${months} months`;
  }

  let days = Math.floor((end - start) / (1000 * 60 * 60 * 24));
  if (days < 1) days = 1;

  return days === 1 ? "1 day" : `${days} days`;
}

// =========================
// DESCRIPTION HELPERS
// =========================
function normalizeLines(desc) {
  if (!desc || typeof desc !== "string") return [];
  return desc
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseJourneyLine(line) {
  const match = line.match(/^- \*\*(.+?) - (.+?)(?: - (.+?))?\*\*$/);
  if (!match) return null;

  return {
    startDate: match[1],
    rank: match[2],
    duration: match[3] || null,
  };
}

function finalizePreviousRankLine(desc, newDateStr) {
  const lines = normalizeLines(desc);
  if (lines.length === 0) return "";

  const lastIndex = lines.length - 1;
  const parsed = parseJourneyLine(lines[lastIndex]);

  if (!parsed) return lines.join("\n");
  if (parsed.duration) return lines.join("\n");

  const duration = durationBetweenPrettyAndInput(parsed.startDate, newDateStr);
  if (!duration) return lines.join("\n");

  lines[lastIndex] = `- **${parsed.startDate} - ${parsed.rank} - ${duration}**`;
  return lines.join("\n");
}

function appendNewRankLine(desc, prettyDate, rank) {
  const lines = normalizeLines(desc);
  lines.push(`- **${prettyDate} - ${rank}**`);
  return lines.join("\n");
}

// =========================
// TRELLO HELPERS
// =========================
async function trelloGet(url, params = {}) {
  return axios.get(url, {
    params: {
      key: TRELLO_KEY,
      token: TRELLO_TOKEN,
      ...params,
    },
  });
}

async function trelloPut(url, params = {}) {
  return axios.put(url, null, {
    params: {
      key: TRELLO_KEY,
      token: TRELLO_TOKEN,
      ...params,
    },
  });
}

async function trelloPost(url, params = {}) {
  return axios.post(url, null, {
    params: {
      key: TRELLO_KEY,
      token: TRELLO_TOKEN,
      ...params,
    },
  });
}

async function trelloDelete(url, params = {}) {
  return axios.delete(url, {
    params: {
      key: TRELLO_KEY,
      token: TRELLO_TOKEN,
      ...params,
    },
  });
}

async function findStaffCardByUsername(username) {
  const res = await trelloGet(`https://api.trello.com/1/boards/${BOARD_ID}/cards`, {
    fields: "id,name,desc,idLabels,idList,closed,pos,shortUrl",
  });

  const lower = username.toLowerCase();

  return (
    res.data.find((card) => {
      if (card.closed) return false;
      return card.name.toLowerCase().startsWith(`${lower} - `);
    }) || null
  );
}

async function findPromotionCard(username, rank, date) {
  const res = await trelloGet(`https://api.trello.com/1/lists/${PROMOTIONS_LIST_ID}/cards`, {
    fields: "id,name,desc,due,closed,pos,idLabels",
  });

  const expectedName = `${username} - ${rank} - ${date}`.toLowerCase();

  return (
    (res.data || []).find((card) => {
      return !card.closed && (card.name || "").toLowerCase() === expectedName;
    }) || null
  );
}

async function ensureLabelOnCard(cardId, labelId) {
  if (!labelId) return;
  await trelloPost(`https://api.trello.com/1/cards/${cardId}/idLabels`, {
    value: labelId,
  });
}

// =========================
// ANNOUNCEMENT HELPERS
// =========================
function getTeamFromRank(rank) {
  switch (rank) {
    case "Leadership Intern":
      return "intern";
    case "Supervisor":
    case "Assistant Manager":
    case "Hotel Manager":
      return "management";
    case "Executive Manager":
    case "Corporate Intern":
      return "senior_management";
    case "Junior Corporate":
    case "Senior Corporate":
    case "Head Corporate":
      return "corporate";
    case "Board Of Directors":
    case "Presidential Intern":
      return "corporate_board";
    case "Chief Executive Officer":
    case "Vice President":
    case "President":
      return "presidential";
    default:
      return "default";
  }
}

function getTeamColor(team) {
  switch (team) {
    case "intern":
      return 0xe76bf3;
    case "management":
      return 0x6a00ff;
    case "senior_management":
      return 0x22c55e;
    case "corporate":
      return 0xdc2626;
    case "corporate_board":
      return 0xf97316;
    case "presidential":
      return 0xfacc15;
    default:
      return 0x8f63d2;
  }
}

async function sendPromotionAnnouncement(client, {
  username,
  rank,
  promoterUser,
  memberUser,
  message,
  trelloLink,
}) {
  if (!ANNOUNCE_CHANNEL_ID) return false;

  const channel = await client.channels.fetch(ANNOUNCE_CHANNEL_ID).catch(() => null);
  if (!channel) return false;
  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
    return false;
  }

  const team = getTeamFromRank(rank);
  const color = getTeamColor(team);

  const embed = new EmbedBuilder()
    .setTitle("🎉 PROMOTION")
    .setColor(color)
    .setDescription(`Please congratulate **${username}** on their promotion to **${rank}**!`)
    .addFields({
      name: "━━━━━━━━━━━━━━━━━━━━",
      value: message
        ? `> ${message}\n> \n> **Promoter:** ${promoterUser}`
        : `> **Promoter:** ${promoterUser}`,
      inline: false,
    })
    .setFooter({ text: "Glace Hotels • Staff Journey" })
    .setTimestamp();

  if (GH_LOGO_URL) {
    embed.setThumbnail(GH_LOGO_URL);
  }

  if (trelloLink) {
    embed.addFields({
      name: "🔗 Trello Card",
      value: `[View Promotion Card](${trelloLink})`,
      inline: false,
    });
  }

  const bottom = [];
  if (memberUser) bottom.push(`${memberUser}`);
  if (PROMOTION_PING_ROLE_ID) bottom.push(`||<@&${PROMOTION_PING_ROLE_ID}>||`);

  await channel.send({
    embeds: [embed],
    content: bottom.join("\n") || undefined,
    allowedMentions: {
      users: memberUser ? [memberUser.id, promoterUser.id] : [promoterUser.id],
      roles: PROMOTION_PING_ROLE_ID ? [PROMOTION_PING_ROLE_ID] : [],
    },
  });

  return true;
}

// =========================
// COMMAND
// =========================
module.exports = {
  data: new SlashCommandBuilder()
    .setName("add-promotion")
    .setDescription("Promote a staff member, reuse/create promo card, and auto-post announcement")
    .addStringOption((o) =>
      o.setName("username").setDescription("Username").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("rank").setDescription("New rank").setRequired(true)
    )
    .addUserOption((o) =>
      o.setName("promoter").setDescription("Promoter").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("date").setDescription("MM/DD/YYYY").setRequired(false)
    )
    .addUserOption((o) =>
      o.setName("member").setDescription("Member mention in announcement").setRequired(false)
    )
    .addStringOption((o) =>
      o.setName("message").setDescription("Announcement message").setRequired(false)
    ),

  async execute(interaction) {
    const username = interaction.options.getString("username");
    const newRank = interaction.options.getString("rank");
    const promoterUser = interaction.options.getUser("promoter");
    const date = interaction.options.getString("date") || getTodayMmDdYyyy();
    const memberUser = interaction.options.getUser("member");
    const announceMessage = interaction.options.getString("message")?.trim() || "";

    const rankConfig = RANK_CONFIG[newRank];

    if (!BOARD_ID) {
      return interaction.reply({
        content: "❌ Missing STAFF_JOURNEY_BOARD_ID env.",
        ephemeral: true,
      });
    }

    if (!PROMOTIONS_LIST_ID || !LABEL_RECENTLY_PROMOTED) {
      return interaction.reply({
        content: "❌ Missing PROMOTIONS_LIST_ID or LABEL_RECENTLY_PROMOTED env.",
        ephemeral: true,
      });
    }

    if (!rankConfig) {
      return interaction.reply({
        content: `❌ Rank "${newRank}" is not configured.`,
        ephemeral: true,
      });
    }

    if (!rankConfig.listId || !rankConfig.rankLabel || !rankConfig.teamLabel) {
      return interaction.reply({
        content: `❌ Missing env vars for "${newRank}".`,
        ephemeral: true,
      });
    }

    const prettyDate = formatPrettyDate(date);
    const dueDate = formatDueNextMonth(date);

    if (!prettyDate || !dueDate) {
      return interaction.reply({
        content: "❌ Invalid date. Use MM/DD/YYYY.",
        ephemeral: true,
      });
    }

    const stepStatus = {
      mainCard: false,
      mainLabels: false,
      promoCard: false,
      announcement: false,
    };

    try {
      const card = await findStaffCardByUsername(username);

      if (!card) {
        return interaction.reply({
          content: "❌ Oops, it seems you have not used the /enroll command.",
          ephemeral: true,
        });
      }

      // main staff card
      const finalizedDesc = finalizePreviousRankLine(card.desc || "", date);
      const updatedDesc = appendNewRankLine(finalizedDesc, prettyDate, newRank);

      await trelloPut(`https://api.trello.com/1/cards/${card.id}`, {
        idList: rankConfig.listId,
        due: dueDate,
        desc: updatedDesc,
        pos: "bottom",
      });
      stepStatus.mainCard = true;

      const labelsToRemove = (card.idLabels || []).filter(
        (id) => ALL_RANK_LABELS.includes(id) || ALL_TEAM_LABELS.includes(id)
      );

      for (const labelId of labelsToRemove) {
        await trelloDelete(`https://api.trello.com/1/cards/${card.id}/idLabels/${labelId}`);
      }

      await trelloPost(`https://api.trello.com/1/cards/${card.id}/idLabels`, {
        value: rankConfig.rankLabel,
      });

      await trelloPost(`https://api.trello.com/1/cards/${card.id}/idLabels`, {
        value: rankConfig.teamLabel,
      });

      await trelloPost(`https://api.trello.com/1/cards/${card.id}/actions/comments`, {
        text: `Promoted to **${newRank}** by **${promoterUser.username}**`,
      });

      stepStatus.mainLabels = true;

      // promo card: reuse existing if same username/rank/date
      const promoCardName = `${username} - ${newRank} - ${date}`;

      let promoCard = await findPromotionCard(username, newRank, date);

      if (promoCard) {
        await trelloPut(`https://api.trello.com/1/cards/${promoCard.id}`, {
          name: promoCardName,
          desc: updatedDesc,
          due: dueDate,
          pos: "bottom",
          closed: false,
        });

        await ensureLabelOnCard(promoCard.id, LABEL_RECENTLY_PROMOTED);
      } else {
        const createdPromoCard = await trelloPost("https://api.trello.com/1/cards", {
          idList: PROMOTIONS_LIST_ID,
          name: promoCardName,
          desc: updatedDesc,
          due: dueDate,
          pos: "bottom",
        });

        promoCard = createdPromoCard.data;
        await ensureLabelOnCard(promoCard.id, LABEL_RECENTLY_PROMOTED);
      }

      stepStatus.promoCard = true;

      // announce
      const refreshedCard = await trelloGet(`https://api.trello.com/1/cards/${card.id}`, {
        fields: "shortUrl,name",
      });

      const announced = await sendPromotionAnnouncement(interaction.client, {
        username,
        rank: newRank,
        promoterUser,
        memberUser,
        message: announceMessage,
        trelloLink: refreshedCard.data?.shortUrl || card.shortUrl || "",
      });

      stepStatus.announcement = announced;

      let summary = `✅ Promoted ${username} to ${newRank}.\n\n`;
      summary += `Main staff card updated: ${stepStatus.mainCard ? "✅" : "❌"}\n`;
      summary += `Main labels applied: ${stepStatus.mainLabels ? "✅" : "❌"}\n`;
      summary += `Promotion card updated/created: ${stepStatus.promoCard ? "✅" : "❌"}\n`;
      summary += `Announcement posted: ${stepStatus.announcement ? "✅" : "❌"}`;

      await interaction.reply({ content: summary, ephemeral: true });
    } catch (err) {
      console.error("[PROMOTION ERROR]", err.response?.data || err.message || err);

      let summary = `❌ Promotion finished with an error.\n\n`;
      summary += `Main staff card updated: ${stepStatus.mainCard ? "✅" : "❌"}\n`;
      summary += `Main labels applied: ${stepStatus.mainLabels ? "✅" : "❌"}\n`;
      summary += `Promotion card updated/created: ${stepStatus.promoCard ? "✅" : "❌"}\n`;
      summary += `Announcement posted: ${stepStatus.announcement ? "✅" : "❌"}`;

      await interaction.reply({ content: summary, ephemeral: true });
    }
  },
};