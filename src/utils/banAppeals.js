// src/utils/banAppeals.js
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { resolveDataPath, atomicWriteJson } = require("./dataPaths");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} = require("discord.js");

const DATA_PATH = resolveDataPath("banAppeals.json", process.env.BAN_APPEALS_STORE_PATH);

const GLACE = "<:GlaceHotels:1489052500341297344>";
const ACCEPTED = "<:accepted:882053450643431434>";
// Use the Appeals server Approved emoji for Appeals-server panel/ticket messages.
// The old accepted emoji can show as plain :accepted: in GH | Appeals if that emoji is not available there.

const DEFAULTS = {
  appealsGuildId: "1503667501127438406",
  activeCategoryId: "1503669759621992448",
  startChannelId: "1503678471610699858",
  appealLogsChannelId: "1503678819247198228",
  mainReviewChannelId: "1503271992994824242",
  reviewerRoleIds: ["1412712646305779823", "1457201903808282634", "1412712767907037305"],
  // Main Glace server review emojis. These are used on the #Ban-Appeals review thread.
  approvedEmojiId: "1503676388492967936",
  deniedEmojiId: "1503676691145556038",
  issueEmojiId: "1503677274220789871",

  // GH Appeals server emojis. These are used inside the Appeals server/ticket side.
  appealApprovedEmojiId: "1503675344425586750",
  appealDeniedEmojiId: "1503675444036370604",
  appealIssueEmojiId: "1503677661866623117",
};

const COLORS = {
  glace: 0x6cb2eb,
  pending: 0xf1c40f,
  approved: 0x57f287,
  denied: 0xed4245,
  issue: 0xffcc4d,
  soft: 0x9cccf3,
};

const PRIVACY_WARNING =
  "Please do not include private Glace information in your appeal. Do not share reporter names, private channel names, screenshots, staff-only information, unreleased builds, systems, evidence details, or anything confidential. Keep your answers general and focus on accountability, understanding, and what you would do differently.";

const RULES = [
  ["1", "Rule 1 - Be respectful", "Be respectful", "Without naming or targeting anyone, please explain what happened and how you would handle the situation differently now."],
  ["2", "Rule 2 - Nickname requirement", "Nickname requirement", "Please explain what happened with your nickname and how you would make sure your nickname stays correct if allowed back."],
  ["3", "Rule 3 - No leaking", "No leaking", "Without repeating or sharing any private information, please explain what kind of situation led to your ban and how you will respect Glace confidentiality moving forward."],
  ["4", "Rule 4 - Use channels correctly", "Use channels correctly", "Please explain what happened in general terms and how you would use Glace channels correctly if allowed back."],
  ["5", "Rule 5 - Allowed languages", "Allowed languages", "Please explain what happened and how you will make sure you only use the allowed languages in Glace moving forward."],
  ["6", "Rule 6 - No swearing", "No swearing", "Please explain what happened in general terms and how you will control your language in Glace moving forward."],
  ["7", "Rule 7 - No inappropriate content", "No inappropriate content", "Without reposting or describing anything graphic in detail, please explain what happened in general terms and why it was not okay for Glace."],
  ["8", "Rule 8 - No personal information", "No personal information", "Without repeating any personal or private information, please explain what happened in general terms and how you will protect others’ privacy if allowed back."],
  ["9", "Rule 9 - No advertising", "No advertising", "Please explain what kind of promotion happened and how you will avoid advertising or self-promotion in Glace moving forward."],
  ["10", "Rule 10 - No spamming", "No spamming", "Please explain what happened in general terms and how you will avoid spam or disruptive behavior if allowed back."],
  ["11", "Rule 11 - Voice channel conduct", "Voice channel conduct", "Please explain what happened in voice chat and how you will behave respectfully in voice channels if allowed back."],
  ["12", "Rule 12 - No drama or arguments", "No drama or arguments", "Please explain what happened in general terms and how you would handle conflict differently if allowed back."],
  ["13", "Rule 13 - Restricted channel answers", "Restricted channel answers", "Please explain what happened and how you will respect rank boundaries in Glace channels moving forward."],
  ["14", "Rule 14 - State your issue clearly", "State your issue clearly", "Please explain what happened with your ticket and how you will state issues clearly if allowed back."],
  ["15", "Rule 15 - Do not ping staff in tickets", "Do not ping staff in tickets", "Please explain what happened with staff pings and how you will ask for help patiently if allowed back."],
  ["16", "Rule 16 - Ticket misuse", "Ticket misuse", "Please explain what happened with the ticket system and how you will use tickets properly if allowed back."],
  ["17", "Rule 17 - No video files", "No video files", "Please explain what happened in general terms and how you will share evidence correctly if allowed back."],
  ["18", "Rule 18 - No fake or edited evidence", "No fake or edited evidence", "Without reposting evidence or naming anyone involved, please explain what happened in general terms and why false evidence is harmful."],
  ["19", "Rule 19 - Reporter confidentiality", "Reporter confidentiality", "Without naming the reporter or sharing confidential details, please explain what happened and how you will respect private reports moving forward."],
  ["20", "Rule 20 - Discord Terms/Guidelines", "Discord Terms/Guidelines", "Please explain what happened in general terms and how you will follow Discord policies inside Glace moving forward."],
  ["21", "Rule 21 - Age requirement", "Age requirement", "Please explain why this ban should be reviewed and confirm that you understand Discord’s age requirement."],
].map(([id, label, title, customQuestion]) => ({ id, label, title, customQuestion }));

const SECOND_QUESTION =
  "Why should we consider unbanning you? Please write at least 4 full sentences explaining what you learned, how you would act differently, and why you believe you are ready to return to Glace Hotels.";

const activePanelRefreshes = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function env(name, fallback = "") {
  const value = process.env[name];
  return value && String(value).trim().length ? String(value).trim() : fallback;
}

function getAppealsGuildId() {
  return env("BAN_APPEALS_GUILD_ID", DEFAULTS.appealsGuildId);
}

function getActiveCategoryId() {
  return env("BAN_APPEALS_ACTIVE_CATEGORY_ID", DEFAULTS.activeCategoryId);
}

function getStartChannelId() {
  return env("BAN_APPEALS_START_CHANNEL_ID", DEFAULTS.startChannelId);
}

function getAppealLogsChannelId() {
  return env("BAN_APPEALS_LOG_CHANNEL_ID", DEFAULTS.appealLogsChannelId);
}

function getMainReviewChannelId() {
  return env("BAN_APPEAL_REVIEW_CHANNEL_ID", DEFAULTS.mainReviewChannelId);
}

function getReviewerRoleIds() {
  return env("BAN_APPEAL_REVIEWER_ROLE_IDS", DEFAULTS.reviewerRoleIds.join(","))
    .split(/[ ,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function getAppealServerInvite() {
  return env("BAN_APPEAL_SERVER_INVITE", "");
}

function getEmoji(name) {
  if (name === "approved") return `<:Approved:${env("BAN_APPEAL_APPROVED_EMOJI_ID", DEFAULTS.approvedEmojiId)}>`;
  if (name === "denied") return `<:Denied:${env("BAN_APPEAL_DENIED_EMOJI_ID", DEFAULTS.deniedEmojiId)}>`;
  if (name === "issue") return `<:Issue:${env("BAN_APPEAL_ISSUE_EMOJI_ID", DEFAULTS.issueEmojiId)}>`;
  return "";
}

function getEmojiId(name) {
  if (name === "approved") return env("BAN_APPEAL_APPROVED_EMOJI_ID", DEFAULTS.approvedEmojiId);
  if (name === "denied") return env("BAN_APPEAL_DENIED_EMOJI_ID", DEFAULTS.deniedEmojiId);
  if (name === "issue") return env("BAN_APPEAL_ISSUE_EMOJI_ID", DEFAULTS.issueEmojiId);
  return "";
}

function getAppealsServerEmoji(name) {
  if (name === "approved") return `<:Approved:${env("BAN_APPEAL_SERVER_APPROVED_EMOJI_ID", DEFAULTS.appealApprovedEmojiId)}>`;
  if (name === "denied") return `<:Denied:${env("BAN_APPEAL_SERVER_DENIED_EMOJI_ID", DEFAULTS.appealDeniedEmojiId)}>`;
  if (name === "issue") return `<:Issue:${env("BAN_APPEAL_SERVER_ISSUE_EMOJI_ID", DEFAULTS.appealIssueEmojiId)}>`;
  return "";
}

function getAppealsServerEmojiId(name) {
  if (name === "approved") return env("BAN_APPEAL_SERVER_APPROVED_EMOJI_ID", DEFAULTS.appealApprovedEmojiId);
  if (name === "denied") return env("BAN_APPEAL_SERVER_DENIED_EMOJI_ID", DEFAULTS.appealDeniedEmojiId);
  if (name === "issue") return env("BAN_APPEAL_SERVER_ISSUE_EMOJI_ID", DEFAULTS.appealIssueEmojiId);
  return "";
}

function getRuleById(id) {
  return RULES.find((rule) => rule.id === String(id)) || null;
}

function getRuleChoices() {
  return RULES.map((rule) => ({ name: rule.label.slice(0, 100), value: rule.id }));
}

function ensureStore() {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_PATH)) fs.writeFileSync(DATA_PATH, JSON.stringify({ appeals: [] }, null, 2));
}

function loadStore() {
  ensureStore();
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw || "{}");
    if (!Array.isArray(parsed.appeals)) parsed.appeals = [];
    return parsed;
  } catch (err) {
    console.error("[BAN APPEALS] Failed to load store:", err);
    return { appeals: [] };
  }
}

function saveStore(store) {
  ensureStore();
  atomicWriteJson(DATA_PATH, store);
}

function updateRecord(recordId, updater) {
  const store = loadStore();
  const i = store.appeals.findIndex((r) => r.id === recordId);
  if (i === -1) return null;
  const copy = { ...store.appeals[i] };
  updater(copy);
  store.appeals[i] = copy;
  saveStore(store);
  return copy;
}

function getRecordById(id) {
  return loadStore().appeals.find((r) => r.id === id) || null;
}

function latestCaseForUser(userId) {
  const records = loadStore().appeals
    .filter((r) => r.userId === userId && r.status !== "replaced" && r.status !== "ban_failed")
    .sort((a, b) => (b.bannedAt || 0) - (a.bannedAt || 0));
  return records[0] || null;
}

function findRecordByAppealChannel(channelId) {
  return loadStore().appeals.find((r) => r.activeAppealChannelId === channelId && ["ticket_open", "pending_confirmation"].includes(r.status)) || null;
}

function findRecordByReviewMessage(messageId) {
  return loadStore().appeals.find((r) => r.reviewMessageId === messageId || r.reviewStarterMessageId === messageId) || null;
}

function makeCaseId() {
  return `BA-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function formatDateTime(ms) {
  if (!ms) return "Unknown";
  return `<t:${Math.floor(Number(ms) / 1000)}:F>`;
}

function formatDateShort(ms) {
  if (!ms) return "Unknown";
  return `<t:${Math.floor(Number(ms) / 1000)}:f>`;
}

function formatRelative(ms) {
  if (!ms) return "Unknown";
  return `<t:${Math.floor(Number(ms) / 1000)}:R>`;
}

function createBanAppealRecord({ guild, user, moderator, rule, appealable, cooldownDays }) {
  const store = loadStore();
  const now = Date.now();
  const cooldownMs = Math.max(0, Number(cooldownDays || 0)) * 24 * 60 * 60 * 1000;

  for (const old of store.appeals) {
    if (old.userId === user.id && ["banned", "ready", "ticket_open", "pending_confirmation"].includes(old.status)) {
      old.status = "replaced";
      old.replacedAt = now;
    }
  }

  const userAppealCount = store.appeals.filter((r) => r.userId === user.id).length + 1;

  const record = {
    id: makeCaseId(),
    guildId: guild?.id || null,
    guildName: guild?.name || "Glace Hotels",
    userId: user.id,
    userTag: user.tag || user.username || user.id,
    username: user.username || user.id,
    moderatorId: moderator?.id || null,
    moderatorTag: moderator?.tag || moderator?.username || null,
    ruleId: rule.id,
    ruleLabel: rule.label,
    ruleTitle: rule.title,
    customQuestion: rule.customQuestion,
    appealable: Boolean(appealable),
    cooldownDays: Math.max(0, Number(cooldownDays || 0)),
    bannedAt: now,
    availableAt: now + cooldownMs,
    status: appealable ? "banned" : "not_appealable",
    dmStatus: "not_sent",
    appealNumber: userAppealCount,
    createdAt: now,
  };

  store.appeals.push(record);
  saveStore(store);
  return record;
}

function markBanFailed(recordId, errorMessage) {
  return updateRecord(recordId, (r) => {
    r.status = "ban_failed";
    r.banFailedAt = Date.now();
    r.banFailedReason = errorMessage || "Unknown error";
  });
}

function markDmStatus(recordId, ok, error = "") {
  return updateRecord(recordId, (r) => {
    r.dmStatus = ok ? "sent" : "failed";
    r.dmError = ok ? null : String(error || "Discord blocked the DM").slice(0, 300);
    r.dmAttemptedAt = Date.now();
  });
}

function buildBanNoticeEmbed(record) {
  const invite = getAppealServerInvite();
  const appealLine = !record.appealable
    ? "Not appealable"
    : record.cooldownDays === 0
      ? "Open now"
      : `${formatDateTime(record.availableAt)} (${formatRelative(record.availableAt)})`;

  const desc = [
    "Hi there,",
    "",
    "You have been banned from the Glace Hotels Discord server.",
    "",
    `**Rule Broken:** ${record.ruleLabel}`,
    `**Appealable:** ${record.appealable ? "Yes" : "No"}`,
    `**Appeal Opens:** ${appealLine}`,
    "",
    record.appealable
      ? "If you would like to appeal, please join the Glace Ban Appeal Server and press the appeal button in **#start** once your cooldown is over."
      : "This ban is currently marked as not appealable.",
    invite || "The appeal server invite is not configured yet. Please use the public Glace appeal link/server if one is provided.",
    "",
    "Please be honest and respectful if you submit an appeal. Our Corporate Team will review everything carefully.",
  ].join("\n");

  return new EmbedBuilder()
    .setColor(record.appealable ? COLORS.glace : COLORS.denied)
    .setTitle(`${GLACE} Glace Hotels | Ban Notice`)
    .setDescription(desc)
    .setFooter({ text: `Appeal Case ${record.id}` })
    .setTimestamp(new Date());
}

async function sendBanNotice(user, record) {
  try {
    await user.send({ embeds: [buildBanNoticeEmbed(record)] });
    markDmStatus(record.id, true);
    return { ok: true };
  } catch (err) {
    markDmStatus(record.id, false, err?.message || String(err));
    return { ok: false, error: err?.message || "Discord blocked the DM" };
  }
}

async function sendAppealNoticeById(client, userId) {
  const record = latestCaseForUser(userId);
  if (!record) return { ok: false, message: "I could not find a saved ban appeal case for that Discord ID." };
  const user = await client.users.fetch(userId).catch(() => null);
  if (!user) return { ok: false, message: "I could not fetch that Discord user." };
  const result = await sendBanNotice(user, record);
  if (!result.ok) return { ok: false, message: `DM failed: ${result.error || "Discord blocked the DM"}` };
  return { ok: true, message: `Appeal notice sent to ${user.tag || user.username || user.id}.` };
}

async function fetchChannel(client, channelId) {
  if (!channelId) return null;
  return client.channels.cache.get(channelId) || (await client.channels.fetch(channelId).catch(() => null));
}

async function fetchGuild(client, guildId) {
  if (!guildId) return null;
  return client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
}

function trimEmbedValue(value, limit = 1024) {
  const str = String(value || "None");
  return str.length > limit ? `${str.slice(0, limit - 3)}...` : str;
}

function appealPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("banappeal:start")
      .setLabel("Start Ban Appeal")
      .setStyle(ButtonStyle.Primary)
  );
}

function buildAppealPanelEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.glace)
    .setTitle(`${GLACE} Start A Ban Appeal`)
    .setDescription(
      [
        "Need to appeal a ban from Glace Hotels?",
        "",
        "Press the button below to begin.",
        "",
        "The bot will check your Discord account automatically. If you have an eligible ban appeal, a private appeal channel will be created for you.",
        "",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "",
        `${getAppealsServerEmoji("approved")} **Before You Start**`,
        "",
        "Please do **not** include:",
        "",
        "- Reporter names",
        "- Private channel names",
        "- Screenshots of private content",
        "- Staff-only information",
        "- Unreleased builds or systems",
        "- Evidence details that could expose someone",
        "- Any leaked or confidential information",
        "",
        "Your answers should focus on what happened in general terms, what you learned, and how you will improve.",
      ].join("\n")
    )
    .setFooter({ text: "Glace Hotels • Ban Appeals" })
    .setTimestamp(new Date());
}

async function postAppealPanel(client, channelId = getStartChannelId()) {
  const lockKey = String(channelId || "default");
  if (activePanelRefreshes.has(lockKey)) {
    // If Mani clicks/runs the setup twice quickly, wait for the first refresh to finish
    // and then reuse the same panel instead of making another post.
    await sleep(1500);
  }

  activePanelRefreshes.add(lockKey);
  try {
    const channel = await fetchChannel(client, channelId);
    if (!channel?.send) throw new Error("I could not find the #start channel or I cannot send messages there.");

    const embed = buildAppealPanelEmbed();
    const components = [appealPanelRow()];

    // Make /appealpanel safe to run more than once.
    // It now edits the first existing panel and removes any extras instead of stacking duplicate posts.
    const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    const panels = [];

    if (recent) {
      for (const msg of recent.values()) {
        const hasPanel =
          msg.author?.id === client.user.id &&
          msg.components?.some((row) => row.components?.some((c) => c.customId === "banappeal:start"));

        const looksLikePanel =
          msg.author?.id === client.user.id &&
          msg.embeds?.some((e) => String(e.title || "").toLowerCase().includes("start a ban appeal"));

        if (hasPanel || looksLikePanel) panels.push(msg);
      }
    }

    if (panels.length) {
      panels.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      const keeper = panels[0];

      await keeper.edit({ embeds: [embed], components }).catch(async () => {
        await keeper.delete().catch(() => null);
      });

      for (const extra of panels.slice(1)) {
        await extra.delete().catch(() => null);
      }

      const refreshed = await channel.messages.fetch(keeper.id).catch(() => null);
      if (refreshed) return refreshed;
    }

    return channel.send({ embeds: [embed], components });
  } finally {
    activePanelRefreshes.delete(lockKey);
  }
}

function sanitizeChannelName(username, appealNumber) {
  const base = String(username || "user")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "user";
  return `${base}-appeal-${appealNumber || 1}`.slice(0, 90);
}

function countSentences(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return 0;
  const punctuation = cleaned.match(/[.!?]+(\s|$)/g) || [];
  const lineSentences = cleaned.split(/\n+/).map((x) => x.trim()).filter((x) => x.length >= 25).length;
  return Math.max(punctuation.length, lineSentences);
}

function isEnoughAppealText(text) {
  const content = String(text || "").trim();
  if (content.length < 180) return false;
  return countSentences(content) >= 4;
}

function buildAppealQuestionsEmbed(record) {
  return new EmbedBuilder()
    .setColor(COLORS.glace)
    .setTitle(`${GLACE} Ban Appeal Form`)
    .setDescription(
      [
        "Hi there,",
        "",
        "This private channel was created for your ban appeal. Please read everything carefully before answering.",
        "",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "",
        "## Your Ban Information",
        "",
        `**Rule Broken:** ${record.ruleLabel}`,
        `**Appeal Opened:** ${formatDateShort(record.availableAt || Date.now())}`,
        "",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "",
        "## Privacy Reminder",
        "",
        PRIVACY_WARNING,
        "",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "",
        "## Appeal Questions",
        "",
        "Please answer both questions in **one message**.",
        "",
        `**1. ${record.customQuestion || "Please explain what happened in general terms and what you understand about the rule you broke."}**`,
        "",
        `**2. ${SECOND_QUESTION}**`,
        "",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "",
        "Once you send your answers, I’ll ask you to confirm before your appeal is submitted.",
      ].join("\n")
    )
    .setFooter({ text: `Appeal Case ${record.id}` })
    .setTimestamp(new Date());
}

function buildTooShortEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.issue)
    .setTitle(`${getAppealsServerEmoji("issue")} Appeal Response Too Short`)
    .setDescription(
      [
        "Please make sure your response includes a clear answer and at least **4 full sentences** for why you should be unbanned.",
        "",
        "Your appeal should explain what you learned, why you want to return, and how you will avoid this happening again.",
      ].join("\n")
    );
}

function buildConfirmEmbed(record, answer) {
  return new EmbedBuilder()
    .setColor(COLORS.pending)
    .setTitle(`${GLACE} Ready To Submit?`)
    .setDescription(
      [
        "Please review your answers before submitting.",
        "",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "",
        "## Before You Submit",
        "",
        "Please stay in this appeal server until your result comes out.",
        "",
        "Please also make sure your DMs are open, and send the bot a quick DM if you can. This helps the bot notify you once your appeal is reviewed.",
        "",
        "If Discord blocks the DM, your appeal will still be reviewed here. DMs are only for result notifications.",
        "",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "",
        "Once you submit your appeal:",
        "",
        "- This channel will close.",
        "- Your appeal will be sent to the Glace Hotels Corporate Team.",
        "- A private review thread will be created in the main Glace server.",
        "",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "",
        "**Your Response:**",
        trimEmbedValue(answer, 3500),
        "",
        "Are you ready to submit your ban appeal?",
      ].join("\n")
    )
    .setFooter({ text: `Appeal Case ${record.id}` });
}

function confirmRow(recordId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`banappeal:submit:${recordId}`).setLabel("Submit Appeal").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`banappeal:edit:${recordId}`).setLabel("Edit Answers").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`banappeal:cancel:${recordId}`).setLabel("Cancel Appeal").setStyle(ButtonStyle.Danger)
  );
}

async function startAppealTicket(interaction) {
  if (interaction.guildId !== getAppealsGuildId()) {
    await interaction.reply({ content: "This appeal panel can only be used inside the Glace Ban Appeal Server.", ephemeral: true });
    return true;
  }

  const record = latestCaseForUser(interaction.user.id);
  if (!record) {
    await interaction.reply({ content: "Sorry, I could not find an available ban for your Discord account.", ephemeral: true });
    return true;
  }

  if (!record.appealable || record.status === "not_appealable") {
    await interaction.reply({ content: "Sorry, this ban is currently marked as **non appealable**. You may contact an Reviewer or Admin if you think this is a mistake.", ephemeral: true });
    return true;
  }

  if (record.status === "ban_failed") {
    await interaction.reply({ content: "This ban case was saved, but the ban itself did not complete. Staff will need to review it manually.", ephemeral: true });
    return true;
  }

  if (["submitted", "approved", "denied"].includes(record.status)) {
    await interaction.reply({ content: "You already submitted an appeal for this ban case.", ephemeral: true });
    return true;
  }

  if (record.availableAt && record.availableAt > Date.now()) {
    await interaction.reply({ content: `Your appeal is not open yet. It opens ${formatDateTime(record.availableAt)} (${formatRelative(record.availableAt)}).`, ephemeral: true });
    return true;
  }

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "I could not read this server.", ephemeral: true });
    return true;
  }

  if (record.activeAppealChannelId) {
    const existing = await guild.channels.fetch(record.activeAppealChannelId).catch(() => null);
    if (existing) {
      await interaction.reply({ content: `You already have an open appeal channel: ${existing}`, ephemeral: true });
      return true;
    }
  }

  await interaction.deferReply({ ephemeral: true }).catch(() => null);

  const categoryId = getActiveCategoryId();
  const everyoneId = guild.roles.everyone.id;
  const overwrites = [
    { id: everyoneId, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      deny: [PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.MentionEveryone],
    },
    {
      id: interaction.client.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages],
    },
  ];

  // Optional: allow matching reviewer roles in the appeals server too, only if those role IDs exist there.
  for (const roleId of getReviewerRoleIds()) {
    if (guild.roles.cache.has(roleId)) {
      overwrites.push({
        id: roleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        deny: [PermissionFlagsBits.SendMessages],
      });
    }
  }

  const channel = await guild.channels.create({
    name: sanitizeChannelName(interaction.user.username, record.appealNumber),
    type: ChannelType.GuildText,
    parent: categoryId || null,
    topic: `${interaction.user.tag || interaction.user.username} - Appeal #${record.appealNumber} - ${record.id}`,
    permissionOverwrites: overwrites,
    reason: `Ban appeal opened by ${interaction.user.tag || interaction.user.id}`,
  });

  updateRecord(record.id, (r) => {
    r.status = "ticket_open";
    r.activeAppealChannelId = channel.id;
    r.appealGuildId = guild.id;
    r.ticketOpenedAt = Date.now();
  });

  await channel.send({ content: `${interaction.user}`, embeds: [buildAppealQuestionsEmbed(record)] });
  await interaction.editReply({ content: `Your private appeal channel has been created: ${channel}` }).catch(() => null);
  return true;
}

async function handleAppealTicketMessage(message) {
  if (!message.guild || message.author?.bot) return false;
  if (message.guild.id !== getAppealsGuildId()) return false;

  const record = findRecordByAppealChannel(message.channel.id);
  if (!record) return false;
  if (record.userId !== message.author.id) return true;

  if (record.status !== "ticket_open") {
    await message.reply({ content: "Please use the buttons on the confirmation message to continue." }).catch(() => null);
    return true;
  }

  const content = String(message.content || "").trim();
  if (!isEnoughAppealText(content)) {
    await message.reply({ embeds: [buildTooShortEmbed()] }).catch(() => null);
    return true;
  }

  const updated = updateRecord(record.id, (r) => {
    r.status = "pending_confirmation";
    r.pendingAnswer = content;
    r.pendingAnswerMessageId = message.id;
    r.pendingAt = Date.now();
  }) || record;

  await message.channel.send({ embeds: [buildConfirmEmbed(updated, content)], components: [confirmRow(record.id)] }).catch(() => null);
  return true;
}

async function logAppealSubmission(client, record) {
  const channel = await fetchChannel(client, getAppealLogsChannelId());
  if (!channel?.send) return false;

  const embed = new EmbedBuilder()
    .setColor(COLORS.soft)
    .setTitle(`${GLACE} Appeal Submitted`)
    .setDescription("A ban appeal was submitted and sent to the main Glace server for Corporate review.")
    .addFields(
      { name: "User", value: `${record.userTag || "Unknown"}\n${record.userId}`, inline: true },
      { name: "Rule Broken", value: record.ruleLabel || "Unknown", inline: true },
      { name: "Appeal Channel", value: record.activeAppealChannelName || record.activeAppealChannelId || "Unknown", inline: true },
      { name: "Submitted", value: formatDateTime(record.submittedAt || Date.now()), inline: true },
      { name: "Review Thread", value: record.reviewThreadId ? `<#${record.reviewThreadId}>` : "Created in main server", inline: true }
    )
    .setFooter({ text: `Appeal Case ${record.id}` })
    .setTimestamp(new Date());

  await channel.send({ embeds: [embed] }).catch(() => null);
  return true;
}

function buildReviewEmbed(record) {
  const approved = getEmoji("approved");
  const denied = getEmoji("denied");

  return new EmbedBuilder()
    .setColor(COLORS.soft)
    .setTitle(`${GLACE} Ban Appeal Review`)
    .setDescription(
      [
        "A new ban appeal has been submitted.",
        "",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "",
        "## User Information",
        "",
        `**User:** ${record.userTag || "Unknown"}`,
        `**User ID:** ${record.userId}`,
        `**Rule Broken:** ${record.ruleLabel || "Unknown"}`,
        `**Ban Date:** ${formatDateShort(record.bannedAt)}`,
        `**Appeal Opened:** ${formatDateShort(record.availableAt || record.bannedAt)}`,
        `**Appeal Submitted:** ${formatDateShort(record.submittedAt || Date.now())}`,
        "",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "",
        "## Appeal Response",
        "",
        `**Rule Question:**\n${record.customQuestion || "General appeal question"}`,
        "",
        `**User Response:**\n${trimEmbedValue(record.finalAnswer || record.pendingAnswer || "No answer saved.", 2600)}`,
        "",
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "",
        `React with ${approved} to approve and unban.`,
        `React with ${denied} to deny the appeal.`,
        "",
        "Only the Check and X reactions will count as a final decision!",
      ].join("\n")
    )
    .setFooter({ text: `Appeal Case ${record.id}` })
    .setTimestamp(new Date());
}

async function createMainReviewThread(client, record) {
  const reviewChannel = await fetchChannel(client, getMainReviewChannelId());
  if (!reviewChannel?.send) throw new Error("I could not find the main #Ban-Appeals review channel.");

  const starter = await reviewChannel.send({
    content: `${GLACE} New ban appeal submitted for **${record.userTag || record.userId}** — ${record.ruleLabel}`,
  });

  const threadName = `Appeal - ${(record.username || "User").slice(0, 30)} - Rule ${record.ruleId}`.slice(0, 90);
  const thread = await starter.startThread({ name: threadName, reason: `Ban appeal review for ${record.userTag || record.userId}` });

  const reviewMessage = await thread.send({ embeds: [buildReviewEmbed(record)] });

  await reviewMessage.react(getEmoji("approved")).catch(() => null);
  await reviewMessage.react(getEmoji("denied")).catch(() => null);

  await starter.edit({ content: `${GLACE} New ban appeal submitted: ${thread}` }).catch(() => null);

  return updateRecord(record.id, (r) => {
    r.reviewChannelId = reviewChannel.id;
    r.reviewStarterMessageId = starter.id;
    r.reviewThreadId = thread.id;
    r.reviewMessageId = reviewMessage.id;
    r.reviewThreadName = thread.name;
  }) || record;
}

async function submitAppeal(interaction, recordId) {
  const record = getRecordById(recordId);
  if (!record || record.activeAppealChannelId !== interaction.channelId) {
    await interaction.reply({ content: "I could not find this appeal case anymore.", ephemeral: true }).catch(() => null);
    return true;
  }

  if (interaction.user.id !== record.userId) {
    await interaction.reply({ content: "Only the person who opened this appeal can submit it.", ephemeral: true }).catch(() => null);
    return true;
  }

  if (record.status !== "pending_confirmation" || !record.pendingAnswer) {
    await interaction.reply({ content: "Please send your appeal answers before submitting.", ephemeral: true }).catch(() => null);
    return true;
  }

  await interaction.deferReply({ ephemeral: false }).catch(() => null);

  const channelName = interaction.channel?.name || record.activeAppealChannelId;
  let updated = updateRecord(record.id, (r) => {
    r.status = "submitted";
    r.finalAnswer = r.pendingAnswer;
    r.submittedAt = Date.now();
    r.activeAppealChannelName = channelName;
  }) || record;

  try {
    updated = await createMainReviewThread(interaction.client, updated);
  } catch (err) {
    console.error("[BAN APPEALS] Failed to create review thread:", err);
    updateRecord(record.id, (r) => {
      r.status = "pending_confirmation";
      r.submitError = err?.message || String(err);
    });
    await interaction.editReply({ content: "I could not send this appeal to the main Glace server yet. Please contact staff so they can check the bot permissions." }).catch(() => null);
    return true;
  }

  await logAppealSubmission(interaction.client, updated);

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.approved)
        .setTitle(`${getAppealsServerEmoji("approved")} Appeal Submitted`)
        .setDescription(
          [
            "Thank you for submitting your ban appeal.",
            "",
            "Your appeal has been sent to the Glace Hotels Corporate Team for review.",
            "",
            "Please stay in this server until your result comes out, and make sure you DM the bot or turn on your DMs so the bot can try to notify you when your appeal is reviewed.",
            "",
            "This channel will now close.",
          ].join("\n")
        ),
    ],
    components: [],
  }).catch(() => null);

  setTimeout(() => {
    interaction.channel?.delete("Ban appeal submitted and moved to review.").catch(() => null);
  }, 10_000);

  return true;
}

async function editAppeal(interaction, recordId) {
  const record = getRecordById(recordId);
  if (!record || record.activeAppealChannelId !== interaction.channelId) {
    await interaction.reply({ content: "I could not find this appeal case anymore.", ephemeral: true }).catch(() => null);
    return true;
  }
  if (interaction.user.id !== record.userId) {
    await interaction.reply({ content: "Only the person who opened this appeal can edit it.", ephemeral: true }).catch(() => null);
    return true;
  }

  updateRecord(record.id, (r) => {
    r.status = "ticket_open";
    r.pendingAnswer = null;
    r.pendingAnswerMessageId = null;
  });

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.glace)
        .setTitle(`${GLACE} Edit Your Appeal`)
        .setDescription("No problem. Please send your updated full appeal response in this channel. I’ll ask you to confirm again once it is ready."),
    ],
    components: [],
  }).catch(async () => {
    await interaction.reply({ content: "Please send your updated full appeal response in this channel.", ephemeral: true }).catch(() => null);
  });
  return true;
}

async function cancelAppeal(interaction, recordId) {
  const record = getRecordById(recordId);
  if (!record || record.activeAppealChannelId !== interaction.channelId) {
    await interaction.reply({ content: "I could not find this appeal case anymore.", ephemeral: true }).catch(() => null);
    return true;
  }
  if (interaction.user.id !== record.userId) {
    await interaction.reply({ content: "Only the person who opened this appeal can cancel it.", ephemeral: true }).catch(() => null);
    return true;
  }

  updateRecord(record.id, (r) => {
    r.status = "banned";
    r.pendingAnswer = null;
    r.activeAppealChannelId = null;
    r.cancelledAt = Date.now();
  });

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.denied)
        .setTitle(`${GLACE} Appeal Cancelled`)
        .setDescription("Your appeal was cancelled. This channel will now close."),
    ],
    components: [],
  }).catch(() => null);

  setTimeout(() => interaction.channel?.delete("Ban appeal cancelled by user.").catch(() => null), 5_000);
  return true;
}

async function handleBanAppealInteraction(interaction) {
  if (!interaction.isButton()) return false;
  const id = interaction.customId || "";
  if (!id.startsWith("banappeal:")) return false;

  const [, action, recordId] = id.split(":");
  if (action === "start") return startAppealTicket(interaction);
  if (action === "submit") return submitAppeal(interaction, recordId);
  if (action === "edit") return editAppeal(interaction, recordId);
  if (action === "cancel") return cancelAppeal(interaction, recordId);
  return false;
}

async function findMainGuildForRecord(client, record) {
  return (record.guildId && await fetchGuild(client, record.guildId)) ||
    (await fetchChannel(client, getMainReviewChannelId()))?.guild ||
    null;
}

async function memberCanReview(guild, userId) {
  if (!guild || !userId) return false;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return false;
  const allowed = getReviewerRoleIds();
  return allowed.some((roleId) => member.roles.cache.has(roleId));
}

async function findCorpAuditChannel(guild) {
  const envId = process.env.CORP_AUDIT_LOG_CHANNEL_ID;
  if (envId) {
    const ch = await guild.channels.fetch(envId).catch(() => null);
    if (ch?.send) return ch;
  }
  const channels = guild.channels.cache;
  return channels.find((ch) => ch?.name === "corp-audit-log" && ch?.send) || null;
}

async function dmDecision(client, record, approved) {
  const user = await client.users.fetch(record.userId).catch(() => null);
  if (!user) return false;
  const invite = process.env.BAN_APPEAL_APPROVED_INVITE || process.env.DISCORD_INVITE || "";
  const embed = new EmbedBuilder()
    .setColor(approved ? COLORS.approved : COLORS.denied)
    .setTitle(approved ? `${getEmoji("approved")} Glace Hotels | Appeal Approved` : `${GLACE} Glace Hotels | Appeal Denied`)
    .setDescription(
      approved
        ? [
            "Hi there,",
            "",
            "Your ban appeal has been reviewed and approved. You have been unbanned from the Glace Hotels Discord server.",
            "",
            "Please make sure to follow our rules moving forward. We’re giving you another chance, and we truly hope you use it respectfully.",
            invite ? `\n${invite}` : "",
          ].join("\n")
        : [
            "Hi there,",
            "",
            "Your ban appeal has been reviewed, but it has been denied at this time.",
            "",
            "Your ban will remain active. Please do not submit extra appeals unless you are told you may appeal again.",
          ].join("\n")
    )
    .setFooter({ text: `Appeal Case ${record.id}` })
    .setTimestamp(new Date());
  await user.send({ embeds: [embed] });
  return true;
}

async function logDecision(client, guild, record, reviewer, approved, unbanText = "") {
  const channel = await findCorpAuditChannel(guild);
  if (!channel?.send) return false;
  const embed = new EmbedBuilder()
    .setColor(approved ? COLORS.approved : COLORS.denied)
    .setTitle(approved ? `${getEmoji("approved")} Ban Appeal Approved` : `${GLACE} Ban Appeal Denied`)
    .setDescription(approved ? "A ban appeal has been approved." : "A ban appeal has been denied.")
    .addFields(
      { name: "User", value: `${record.userTag || "Unknown"}\n${record.userId}`, inline: true },
      { name: "Rule Broken", value: record.ruleLabel || "Unknown", inline: true },
      { name: "Reviewed By", value: `${reviewer.tag || reviewer.username}\n${reviewer.id}`, inline: true },
      { name: "Decision", value: approved ? `Approved & Unbanned\n${unbanText || "Unban attempted."}` : "Denied\nThe ban will remain active.", inline: false }
    )
    .setFooter({ text: `Appeal Case ${record.id}` })
    .setTimestamp(new Date());
  await channel.send({ embeds: [embed] }).catch(() => null);
  return true;
}

async function reactToReviewStarter(client, record, decision) {
  const emoji = decision === "approved" ? getEmoji("approved") : getEmoji("denied");
  if (!record?.reviewChannelId || !record?.reviewStarterMessageId || !emoji) return false;

  const channel = await fetchChannel(client, record.reviewChannelId);
  if (!channel?.messages?.fetch) return false;

  const starter = await channel.messages.fetch(record.reviewStarterMessageId).catch(() => null);
  if (!starter) return false;

  await starter.react(emoji).catch(() => null);
  return true;
}

async function handleDecisionReaction(reaction, user, decision) {
  if (user?.bot) return true;

  const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
  if (!message) return true;

  const record = findRecordByReviewMessage(message.id);
  if (!record) return false;

  const guild = await findMainGuildForRecord(message.client, record);
  if (!guild) return true;

  const allowed = await memberCanReview(guild, user.id);
  if (!allowed) {
    await reaction.users.remove(user.id).catch(() => null);
    return true;
  }

  if (["approved", "denied"].includes(record.status)) {
    await reaction.users.remove(user.id).catch(() => null);
    return true;
  }

  let unbanText = "";
  const approved = decision === "approved";
  if (approved) {
    try {
      await guild.bans.remove(record.userId, `Ban appeal approved by ${user.tag || user.username || user.id}`);
      unbanText = "User was unbanned.";
    } catch (err) {
      console.error("[BAN APPEALS] Failed to unban after approval:", err);
      unbanText = `Unban failed: ${err?.message || "Unknown error"}`;
    }
  }

  const updated = updateRecord(record.id, (r) => {
    r.status = approved ? "approved" : "denied";
    r.reviewedAt = Date.now();
    r.reviewedById = user.id;
    r.reviewedByTag = user.tag || user.username || user.id;
    r.decision = approved ? "approved" : "denied";
    r.unbanResult = unbanText || null;
  }) || record;

  let dmOk = true;
  try { await dmDecision(message.client, updated, approved); }
  catch { dmOk = false; }

  const resultEmbed = new EmbedBuilder()
    .setColor(approved ? COLORS.approved : COLORS.denied)
    .setTitle(approved ? `${getEmoji("approved")} Appeal Approved` : `${GLACE} Appeal Denied`)
    .setDescription(
      [
        approved ? "This appeal has been approved." : "This appeal has been denied.",
        "",
        `**Reviewed By:** ${user.tag || user.username}`,
        approved ? `**Unban:** ${unbanText || "Attempted"}` : "**Decision:** Denied",
        `**DM Notification:** ${dmOk ? "Sent" : "Failed / DMs may be closed"}`,
      ].join("\n")
    )
    .setTimestamp(new Date());

  await message.channel.send({ embeds: [resultEmbed] }).catch(() => null);
  await logDecision(message.client, guild, updated, user, approved, unbanText);
  await reactToReviewStarter(message.client, updated, approved ? "approved" : "denied").catch(() => null);

  // Lock/archive the thread after a short moment so staff can see the result message first.
  setTimeout(() => {
    if (message.channel?.isThread?.()) {
      message.channel.setLocked(true, "Ban appeal decided.").catch(() => null);
      message.channel.setArchived(true, "Ban appeal decided.").catch(() => null);
    }
  }, 5_000);

  return true;
}

async function handleBanAppealReaction(reaction, user) {
  if (!reaction || !user || user.bot) return false;

  if (reaction.partial) {
    reaction = await reaction.fetch().catch(() => null);
    if (!reaction) return false;
  }

  const emojiId = reaction.emoji?.id || null;
  const emojiName = reaction.emoji?.name || "";

  if (emojiId === getEmojiId("approved") || emojiName === "Approved") return handleDecisionReaction(reaction, user, "approved");
  if (emojiId === getEmojiId("denied") || emojiName === "Denied") return handleDecisionReaction(reaction, user, "denied");
  if (emojiId === getEmojiId("issue") || emojiName === "Issue") return true; // Halt/review visual only. Nothing happens.

  return false;
}

// Keeps older website-patched index.js files from crashing. This ticket system does not use web routes.
async function handleAppealWebRequest(req, res) {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Glace Ban Appeals are handled in the Glace Appeals Discord server.\n");
}

module.exports = {
  getRuleById,
  getRuleChoices,
  createBanAppealRecord,
  markBanFailed,
  sendBanNotice,
  sendAppealNoticeById,
  formatDateTime,
  formatRelative,
  getAppealServerInvite,
  postAppealPanel,
  handleAppealTicketMessage,
  handleBanAppealInteraction,
  handleBanAppealReaction,
  handleAppealWebRequest,
};
