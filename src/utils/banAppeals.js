// src/utils/banAppeals.js
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const { atLeastTier } = require("./permissions");
const { logModerationAction } = require("./modlog");

const DATA_PATH =
  process.env.BAN_APPEALS_STORE_PATH || path.join(__dirname, "..", "data", "banAppeals.json");

const GLACE = "<:GlaceHotels:1489052500341297344>";
const ACCEPTED = "<:accepted:882053450643431434>";

const COLOR_GLACE = 0x6cb2eb;
const COLOR_PENDING = 0xf1c40f;
const COLOR_APPROVED = 0x57f287;
const COLOR_DENIED = 0xed4245;
const COLOR_SOFT = 0x9cccf3;

const DM_RETRY_AFTER_MS = 6 * 60 * 60 * 1000;

const RULES = [
  {
    id: "1",
    label: "Rule 1 - Be respectful",
    title: "Be respectful",
    text: "Treat everyone with respect. Harassment, discrimination, or targeted hostility of any kind is not allowed.",
    questionLabel: "Respect going forward",
    question: "How will you show respect to others if you return to Glace?",
  },
  {
    id: "2",
    label: "Rule 2 - Nickname requirement",
    title: "Nickname requirement",
    text: "Your server nickname must match your Roblox username at all times after verifying. Do not change it. Refusal after being told will result in a warning.",
    questionLabel: "Roblox username",
    question: "What Roblox username should your nickname match if you return?",
  },
  {
    id: "3",
    label: "Rule 3 - No leaking",
    title: "No leaking",
    text: "Do not share non-public information. This includes builds, systems, staff information, channels, operations, or future plans. Leaking will result in an immediate ban.",
    questionLabel: "Trust after leaking",
    question: "Why should Glace trust that private information will stay private if you return?",
  },
  {
    id: "4",
    label: "Rule 4 - Use channels correctly",
    title: "Use channels correctly",
    text: "Only use channels for their intended purpose. Off-topic or misplaced messages may be removed.",
    questionLabel: "Channel use",
    question: "How will you make sure you use channels correctly if you return?",
  },
  {
    id: "5",
    label: "Rule 5 - Allowed languages",
    title: "Allowed languages",
    text: "Only English, Spanish, Portuguese, Italian, and French are permitted.",
    questionLabel: "Allowed language",
    question: "Which allowed language will you use in the server if you return?",
  },
  {
    id: "6",
    label: "Rule 6 - No swearing",
    title: "No swearing",
    text: "Swearing or offensive language is not allowed anywhere in the server. Minor cursing is only allowed in Frostbite VC.",
    questionLabel: "Language choices",
    question: "How will you avoid swearing or offensive language if you return?",
  },
  {
    id: "7",
    label: "Rule 7 - No inappropriate content",
    title: "No inappropriate content",
    text: "Sexual, violent, discriminatory, or otherwise inappropriate content is strictly prohibited.",
    questionLabel: "Content understanding",
    question: "Why was the content not okay for Glace, and what will change?",
  },
  {
    id: "8",
    label: "Rule 8 - No personal information",
    title: "No personal information",
    text: "Do not share personal or private information, including real names, addresses, phone numbers, emails, or social media accounts.",
    questionLabel: "Privacy understanding",
    question: "How will you protect personal/private information if you return?",
  },
  {
    id: "9",
    label: "Rule 9 - No advertising",
    title: "No advertising",
    text: "Advertising, self-promotion, or promoting other servers, groups, or services is not allowed.",
    questionLabel: "Advertising rule",
    question: "How will you avoid advertising or self-promotion if you return?",
  },
  {
    id: "10",
    label: "Rule 10 - No spamming",
    title: "No spamming",
    text: "Spam of any kind is prohibited. This includes message spam, emoji spam, link spam, or disruptive behavior.",
    questionLabel: "Spam/disruption",
    question: "How will you avoid spam or disruptive behavior if you return?",
  },
  {
    id: "11",
    label: "Rule 11 - Voice channel conduct",
    title: "Voice channel conduct",
    text: "Do not disrupt voice channels. Loud audio, mic abuse, soundboards, or disruptive voice changers are not allowed.",
    questionLabel: "Voice conduct",
    question: "How will you behave in voice channels if you return?",
  },
  {
    id: "12",
    label: "Rule 12 - No drama or arguments",
    title: "No drama or arguments",
    text: "Do not start or continue drama in public channels. If there is an issue, open a ticket or DM Corporate+ respectfully.",
    questionLabel: "Handling issues",
    question: "How will you handle issues respectfully if you return?",
  },
  {
    id: "13",
    label: "Rule 13 - Restricted channel answers",
    title: "No answering in restricted channels",
    text: "Only Assistant Managers+ may answer questions in the questions channel. Leadership Interns+ may respond to photo submission requests only.",
    questionLabel: "Rank boundaries",
    question: "How will you make sure you only answer where your rank is allowed?",
  },
  {
    id: "14",
    label: "Rule 14 - State your issue clearly",
    title: "State your issue clearly",
    text: "You must state your issue within 10 minutes of opening a ticket. Failure to do so may result in the ticket being closed and a warning.",
    questionLabel: "Ticket clarity",
    question: "What will you do differently when opening tickets?",
  },
  {
    id: "15",
    label: "Rule 15 - Do not ping staff",
    title: "Do not ping staff in tickets",
    text: "Do not ping staff members inside tickets. Our system already alerts the appropriate team.",
    questionLabel: "Ticket pings",
    question: "How will you avoid pinging staff in tickets if you return?",
  },
  {
    id: "16",
    label: "Rule 16 - Ticket misuse",
    title: "Ticket misuse",
    text: "Misusing the ticket system or opening unnecessary tickets may result in a warning.",
    questionLabel: "Ticket use",
    question: "How will you use tickets properly if you return?",
  },
  {
    id: "17",
    label: "Rule 17 - No video files",
    title: "No video files",
    text: "Do not upload video files. Use links only, such as Gyazo, Medal, or YouTube.",
    questionLabel: "Evidence sharing",
    question: "How will you share evidence correctly if you return?",
  },
  {
    id: "18",
    label: "Rule 18 - No fake evidence",
    title: "No fake or edited evidence",
    text: "Edited, fabricated, or misleading evidence will result in severe punishment.",
    questionLabel: "Evidence trust",
    question: "Why should Glace trust any evidence you provide in the future?",
  },
  {
    id: "19",
    label: "Rule 19 - Reporter confidentiality",
    title: "Reporter Confidentiality",
    text: "Do not leak, expose, or confront reporters. Report channels are confidential.",
    questionLabel: "Reporter privacy",
    question: "How will you respect reporter privacy if you return?",
  },
  {
    id: "20",
    label: "Rule 20 - Discord Terms/Guidelines",
    title: "Discord Terms of Service",
    text: "All users must follow Discord's Terms of Service and Community Guidelines.",
    questionLabel: "Discord policies",
    question: "How will you make sure you follow Discord policies if you return?",
  },
  {
    id: "21",
    label: "Rule 21 - Age requirement",
    title: "Age requirement",
    text: "You must be 13 years or older to remain in this server. Anyone claiming to be under 13, including jokes, will be removed immediately.",
    questionLabel: "Age requirement",
    question: "Please confirm you meet Discord's age requirement and understand this rule.",
  },
];

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

function readStore() {
  ensureStore();
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw || "{}");
    if (!Array.isArray(parsed.appeals)) parsed.appeals = [];
    return parsed;
  } catch (err) {
    console.error("[BAN APPEALS] Failed to read store:", err);
    return { appeals: [] };
  }
}

function writeStore(store) {
  ensureStore();
  const tmp = `${DATA_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, DATA_PATH);
}

function makeRecordId() {
  return `ba_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatDateTime(ms) {
  if (!ms) return "Unknown";
  return `<t:${Math.floor(Number(ms) / 1000)}:F>`;
}

function formatRelative(ms) {
  if (!ms) return "Unknown";
  return `<t:${Math.floor(Number(ms) / 1000)}:R>`;
}

function clampCooldownDays(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(365, Math.floor(n)));
}

function getReviewerMinTier() {
  const n = Number(process.env.BAN_APPEAL_REVIEW_MIN_TIER || 6);
  if (!Number.isFinite(n)) return 6;
  return Math.max(1, Math.min(7, Math.floor(n)));
}

function safeText(value, limit = 1024) {
  const text = String(value || "").trim();
  if (!text) return "None provided.";
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function buildAppealButton(record) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`banappeal:start:${record.id}`)
      .setLabel("Submit Ban Appeal")
      .setEmoji({ id: "1489052500341297344", name: "GlaceHotels" })
      .setStyle(ButtonStyle.Primary)
  );
}

function buildReviewButtons(record, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`banappeal:approve:${record.id}`)
      .setLabel("Approve & Unban")
      .setEmoji({ id: "882053450643431434", name: "accepted" })
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`banappeal:deny:${record.id}`)
      .setLabel("Deny Appeal")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`banappeal:close:${record.id}`)
      .setLabel("Close Thread")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(false)
  );
}

function updateAppealRecord(recordId, updater) {
  const store = readStore();
  const index = store.appeals.findIndex((record) => record.id === recordId);
  if (index === -1) return null;

  const current = store.appeals[index];
  const updated = updater({ ...current }) || current;
  updated.updatedAt = Date.now();
  store.appeals[index] = updated;
  writeStore(store);
  return updated;
}

function getAppealRecord(recordId) {
  const store = readStore();
  return store.appeals.find((record) => record.id === recordId) || null;
}

function getLatestAppealForUser(guildId, userId) {
  const store = readStore();
  return [...store.appeals]
    .reverse()
    .find((record) => record.guildId === guildId && record.userId === userId) || null;
}

function createBanAppealRecord({ guild, user, moderator, rule, appealable, cooldownDays }) {
  const now = Date.now();
  const safeCooldown = clampCooldownDays(cooldownDays);
  const availableAt = appealable ? now + safeCooldown * 24 * 60 * 60 * 1000 : null;

  const store = readStore();

  // If the user had an older open case, keep it for history but stop it from staying active.
  for (const record of store.appeals) {
    if (
      record.guildId === guild.id &&
      record.userId === user.id &&
      ["banned", "ready", "submitted"].includes(record.status)
    ) {
      record.status = "replaced";
      record.replacedAt = now;
      record.updatedAt = now;
    }
  }

  const record = {
    id: makeRecordId(),
    guildId: guild.id,
    guildName: guild.name,
    userId: user.id,
    userTag: user.tag || user.username || user.id,
    moderatorId: moderator.id,
    moderatorTag: moderator.tag || moderator.username || moderator.id,
    ruleId: rule.id,
    ruleLabel: rule.label,
    ruleTitle: rule.title,
    ruleText: rule.text,
    appealable: Boolean(appealable),
    cooldownDays: safeCooldown,
    bannedAt: now,
    availableAt,
    status: appealable ? "banned" : "not_appealable",
    dmNoticeStatus: "not_sent",
    dmAppealStatus: "not_sent",
    dmChannelId: null,
    lastDmAttemptAt: null,
    nextDmAttemptAt: null,
    appealSubmittedAt: null,
    answers: null,
    reviewChannelId: null,
    reviewThreadId: null,
    reviewMessageId: null,
    reviewedAt: null,
    reviewedById: null,
    reviewedByTag: null,
    createdAt: now,
    updatedAt: now,
  };

  store.appeals.push(record);
  writeStore(store);
  return record;
}

function buildBanNoticeEmbed(record) {
  const appealLine = !record.appealable
    ? "This ban is **not appealable** at this time."
    : record.availableAt <= Date.now()
      ? "Your appeal is open. Please take your time and be honest in your answers."
      : `Your appeal opens ${formatRelative(record.availableAt)}.`;

  const embed = new EmbedBuilder()
    .setColor(record.appealable ? COLOR_PENDING : COLOR_DENIED)
    .setTitle(`${GLACE} Glace Hotels | Ban Notice`)
    .setDescription(
      `Hi there. You have been banned from **Glace Hotels**.\n\n${appealLine}`
    )
    .addFields(
      { name: "Rule Broken", value: `${record.ruleLabel}\n${record.ruleText}`.slice(0, 1024), inline: false },
      { name: "Appealable", value: record.appealable ? "Yes" : "No", inline: true },
      {
        name: "Appeal Opens",
        value: record.appealable ? formatDateTime(record.availableAt) : "Not available",
        inline: true,
      }
    )
    .setFooter({ text: "Please be honest, calm, and respectful if you submit an appeal." })
    .setTimestamp(new Date(record.bannedAt));

  return embed;
}

function buildAppealReadyEmbed(record) {
  return new EmbedBuilder()
    .setColor(COLOR_GLACE)
    .setTitle(`${GLACE} Ban Appeal Open`)
    .setDescription(
      "Your appeal cooldown is over. If you feel ready to explain what happened, you can submit your appeal below."
    )
    .addFields(
      { name: "Rule Broken", value: record.ruleLabel, inline: false },
      { name: "Appeal Note", value: "Please answer with honesty and care. The review team will read everything before making a decision.", inline: false }
    )
    .setTimestamp(new Date());
}

async function sendUserDm(user, payload, preferredChannel = null) {
  try {
    const channel = preferredChannel || (await user.createDM());
    const message = await channel.send(payload);
    return { ok: true, channelId: channel.id, messageId: message.id };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

async function sendBanNotice(user, record, preferredChannel = null) {
  const components = [];
  if (record.appealable && record.availableAt <= Date.now()) components.push(buildAppealButton(record));

  const result = await sendUserDm(user, { embeds: [buildBanNoticeEmbed(record)], components }, preferredChannel);
  updateAppealRecord(record.id, (current) => {
    current.dmNoticeStatus = result.ok ? "sent" : "failed";
    current.dmAppealStatus = components.length ? (result.ok ? "sent" : "failed") : current.dmAppealStatus;
    current.dmChannelId = result.channelId || current.dmChannelId || null;
    current.lastDmAttemptAt = Date.now();
    current.nextDmAttemptAt = result.ok ? null : Date.now() + DM_RETRY_AFTER_MS;
    current.lastDmError = result.ok ? null : result.error;
    if (components.length && result.ok) current.appealButtonSentAt = Date.now();
    return current;
  });
  return result;
}

async function sendAppealInvite(client, record) {
  if (!record.appealable || record.availableAt > Date.now()) return { ok: false, error: "Appeal is not ready." };

  const user = await client.users.fetch(record.userId).catch(() => null);
  if (!user) return { ok: false, error: "User could not be fetched." };

  let preferredChannel = null;
  if (record.dmChannelId) {
    preferredChannel = await client.channels.fetch(record.dmChannelId).catch(() => null);
  }

  const result = await sendUserDm(
    user,
    { embeds: [buildAppealReadyEmbed(record)], components: [buildAppealButton(record)] },
    preferredChannel
  );

  updateAppealRecord(record.id, (current) => {
    current.dmAppealStatus = result.ok ? "sent" : "failed";
    current.dmChannelId = result.channelId || current.dmChannelId || null;
    current.appealButtonSentAt = result.ok ? Date.now() : current.appealButtonSentAt || null;
    current.lastDmAttemptAt = Date.now();
    current.nextDmAttemptAt = result.ok ? null : Date.now() + DM_RETRY_AFTER_MS;
    current.lastDmError = result.ok ? null : result.error;
    if (current.status === "banned" && result.ok) current.status = "ready";
    return current;
  });

  return result;
}

async function runBanAppealReminderTick(client) {
  const store = readStore();
  const now = Date.now();
  const readyRecords = store.appeals.filter(
    (record) =>
      record.appealable &&
      ["banned", "ready"].includes(record.status) &&
      record.availableAt &&
      record.availableAt <= now &&
      !record.appealSubmittedAt &&
      !record.appealButtonSentAt &&
      (!record.nextDmAttemptAt || record.nextDmAttemptAt <= now)
  );

  for (const record of readyRecords) {
    try {
      await sendAppealInvite(client, record);
    } catch (err) {
      console.error("[BAN APPEALS] Appeal invite tick failed:", err);
    }
  }
}

function makeAppealModal(record) {
  const rule = getRuleById(record.ruleId) || {
    questionLabel: "Rule understanding",
    question: "What did you learn from this rule?",
  };

  const modal = new ModalBuilder()
    .setCustomId(`banappeal:submit:${record.id}`)
    .setTitle("Glace Ban Appeal");

  const q1 = new TextInputBuilder()
    .setCustomId("happened")
    .setLabel("What happened?")
    .setPlaceholder("Explain the situation in your own words.")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(900);

  const q2 = new TextInputBuilder()
    .setCustomId("rule")
    .setLabel(rule.questionLabel.slice(0, 45))
    .setPlaceholder(rule.question.slice(0, 100))
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(900);

  const q3 = new TextInputBuilder()
    .setCustomId("ready")
    .setLabel("Why are you ready to return?")
    .setPlaceholder("Tell us why you believe you are ready to be unbanned.")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(900);

  const q4 = new TextInputBuilder()
    .setCustomId("different")
    .setLabel("What will be different?")
    .setPlaceholder("Share what you will do differently if you return.")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(900);

  const q5 = new TextInputBuilder()
    .setCustomId("extra")
    .setLabel("Anything else?")
    .setPlaceholder("Optional: add anything you want reviewers to know.")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(700);

  modal.addComponents(
    new ActionRowBuilder().addComponents(q1),
    new ActionRowBuilder().addComponents(q2),
    new ActionRowBuilder().addComponents(q3),
    new ActionRowBuilder().addComponents(q4),
    new ActionRowBuilder().addComponents(q5)
  );

  return modal;
}

async function findReviewChannel(guild) {
  const envId = process.env.BAN_APPEAL_REVIEW_CHANNEL_ID;
  if (envId) {
    const channel = await guild.channels.fetch(envId).catch(() => null);
    if (channel && channel.isTextBased()) return channel;
  }

  const names = ["ban-appeals", "ban-appeal", "appeals", "corp-audit-log", "audit-log"];
  const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
  return (
    channels.find(
      (channel) =>
        channel &&
        channel.isTextBased?.() &&
        names.includes(String(channel.name || "").toLowerCase())
    ) || null
  );
}

function buildSubmittedAppealEmbed(record) {
  const answers = record.answers || {};
  return new EmbedBuilder()
    .setColor(COLOR_PENDING)
    .setTitle(`${GLACE} Ban Appeal | ${record.ruleLabel}`)
    .setDescription("A ban appeal was submitted. Please review it with fairness and care.")
    .addFields(
      { name: "User", value: `${record.userTag}\n${record.userId}`, inline: true },
      { name: "Banned By", value: `${record.moderatorTag}\n${record.moderatorId}`, inline: true },
      { name: "Ban Date", value: formatDateTime(record.bannedAt), inline: true },
      { name: "Rule Broken", value: `${record.ruleLabel}\n${record.ruleText}`.slice(0, 1024), inline: false },
      { name: "What happened?", value: safeText(answers.happened), inline: false },
      { name: "Rule understanding", value: safeText(answers.rule), inline: false },
      { name: "Why ready to return?", value: safeText(answers.ready), inline: false },
      { name: "What will be different?", value: safeText(answers.different), inline: false },
      { name: "Anything else?", value: safeText(answers.extra), inline: false }
    )
    .setFooter({ text: `Appeal Case: ${record.id}` })
    .setTimestamp(new Date(record.appealSubmittedAt || Date.now()));
}

function cleanThreadName(text) {
  return String(text || "user")
    .replace(/[^a-zA-Z0-9 _.-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70) || "user";
}

async function createReviewThread(guild, record) {
  const channel = await findReviewChannel(guild);
  if (!channel) throw new Error("Could not find a ban appeal review channel.");

  const threadName = `Appeal - ${cleanThreadName(record.userTag)} - Rule ${record.ruleId}`.slice(0, 95);
  const embed = buildSubmittedAppealEmbed(record);
  const components = [buildReviewButtons(record)];

  let thread = null;
  let reviewMessage = null;

  if (channel.type === ChannelType.GuildForum || channel.type === ChannelType.GuildMedia) {
    thread = await channel.threads.create({
      name: threadName,
      autoArchiveDuration: 10080,
      reason: `Ban appeal submitted by ${record.userTag}`,
      message: {
        content: `${GLACE} **New ban appeal submitted.**`,
        embeds: [embed],
        components,
      },
    });
    reviewMessage = thread.lastMessage || null;
  } else {
    const starter = await channel.send({
      content: `${GLACE} **New ban appeal submitted for ${record.userTag}.**`,
      allowedMentions: { parse: [] },
    });

    thread = await starter.startThread({
      name: threadName,
      autoArchiveDuration: 10080,
      reason: `Ban appeal submitted by ${record.userTag}`,
    });

    reviewMessage = await thread.send({
      embeds: [embed],
      components,
      allowedMentions: { parse: [] },
    });
  }

  updateAppealRecord(record.id, (current) => {
    current.reviewChannelId = channel.id;
    current.reviewThreadId = thread?.id || null;
    current.reviewMessageId = reviewMessage?.id || null;
    return current;
  });

  return { channel, thread, reviewMessage };
}

async function fetchGuild(client, guildId) {
  return client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
}

async function safeReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) return await interaction.editReply(payload);
    return await interaction.reply(payload);
  } catch (err) {
    return null;
  }
}

async function handleAppealStart(interaction, recordId) {
  const record = getAppealRecord(recordId);
  if (!record) {
    await safeReply(interaction, { content: "Sorry, I could not find that ban appeal case.", ephemeral: true });
    return true;
  }

  if (!record.appealable) {
    await safeReply(interaction, { content: "This ban is not appealable at this time.", ephemeral: true });
    return true;
  }

  if (record.availableAt && record.availableAt > Date.now()) {
    await safeReply(interaction, {
      content: `Your appeal is not open yet. It opens ${formatRelative(record.availableAt)}.`,
      ephemeral: true,
    });
    return true;
  }

  if (["submitted", "approved", "denied"].includes(record.status)) {
    await safeReply(interaction, {
      content: "This appeal has already been submitted or reviewed.",
      ephemeral: true,
    });
    return true;
  }

  await interaction.showModal(makeAppealModal(record));
  return true;
}

async function handleAppealSubmit(interaction, recordId) {
  let record = getAppealRecord(recordId);
  if (!record) {
    await safeReply(interaction, { content: "Sorry, I could not find that ban appeal case.", ephemeral: true });
    return true;
  }

  if (!record.appealable || (record.availableAt && record.availableAt > Date.now())) {
    await safeReply(interaction, { content: "This appeal is not open yet.", ephemeral: true });
    return true;
  }

  if (["submitted", "approved", "denied"].includes(record.status)) {
    await safeReply(interaction, { content: "This appeal has already been submitted or reviewed.", ephemeral: true });
    return true;
  }

  await interaction.deferReply({ ephemeral: true }).catch(() => null);

  const answers = {
    happened: interaction.fields.getTextInputValue("happened"),
    rule: interaction.fields.getTextInputValue("rule"),
    ready: interaction.fields.getTextInputValue("ready"),
    different: interaction.fields.getTextInputValue("different"),
    extra: interaction.fields.getTextInputValue("extra") || "",
  };

  record = updateAppealRecord(record.id, (current) => {
    current.status = "submitted";
    current.appealSubmittedAt = Date.now();
    current.answers = answers;
    return current;
  });

  const guild = await fetchGuild(interaction.client, record.guildId);
  if (!guild) {
    await safeReply(interaction, {
      content: "Your appeal was saved, but I could not reach the Glace server review channel. Please let Corporate+ know.",
      ephemeral: true,
    });
    return true;
  }

  try {
    await createReviewThread(guild, record);
    await safeReply(interaction, {
      content: `${ACCEPTED} Your appeal was submitted. Thank you for taking the time to explain everything calmly.`,
      ephemeral: true,
    });
  } catch (err) {
    console.error("[BAN APPEALS] Failed to create review thread:", err);
    await safeReply(interaction, {
      content: "Your appeal was saved, but I could not create the review thread. Please let Corporate+ know.",
      ephemeral: true,
    });
  }

  return true;
}

async function updateReviewMessage(interaction, record, color, title, note) {
  const embed = buildSubmittedAppealEmbed(record)
    .setColor(color)
    .setTitle(`${GLACE} ${title}`)
    .addFields({ name: "Decision", value: note, inline: false });

  try {
    if (interaction.message?.editable) {
      await interaction.message.edit({ embeds: [embed], components: [buildReviewButtons(record, true)] });
    }
  } catch (err) {
    console.error("[BAN APPEALS] Failed to update review message:", err);
  }
}

async function dmUserDecision(client, record, approved) {
  const user = await client.users.fetch(record.userId).catch(() => null);
  if (!user) return false;

  const invite = process.env.BAN_APPEAL_APPROVED_INVITE || process.env.GLACE_DISCORD_INVITE || "";
  const description = approved
    ? `Your ban appeal for **Glace Hotels** was approved. You should now be unbanned.${invite ? `\n\nServer invite: ${invite}` : ""}`
    : "Your ban appeal for **Glace Hotels** was reviewed and denied. Please respect the decision made by the review team.";

  const embed = new EmbedBuilder()
    .setColor(approved ? COLOR_APPROVED : COLOR_DENIED)
    .setTitle(approved ? `${ACCEPTED} Ban Appeal Approved` : "Ban Appeal Denied")
    .setDescription(description)
    .setTimestamp(new Date());

  const preferredChannel = record.dmChannelId
    ? await client.channels.fetch(record.dmChannelId).catch(() => null)
    : null;
  const result = await sendUserDm(user, { embeds: [embed] }, preferredChannel);
  return result.ok;
}

async function handleApprove(interaction, recordId) {
  const record = getAppealRecord(recordId);
  if (!record) {
    await safeReply(interaction, { content: "I could not find that appeal case.", ephemeral: true });
    return true;
  }

  if (!atLeastTier(interaction.member, getReviewerMinTier())) {
    await safeReply(interaction, { content: "You do not have permission to review ban appeals.", ephemeral: true });
    return true;
  }

  await interaction.deferReply({ ephemeral: true }).catch(() => null);

  const guild = interaction.guild || (await fetchGuild(interaction.client, record.guildId));
  if (!guild) {
    await safeReply(interaction, { content: "I could not find the Glace server for this appeal.", ephemeral: true });
    return true;
  }

  let unbanText = "User was unbanned.";
  try {
    await guild.bans.remove(record.userId, `Ban appeal approved by ${interaction.user.tag}`);
  } catch (err) {
    unbanText = "I could not remove the ban automatically. They may already be unbanned, or I may need Ban Members permission.";
  }

  const updated = updateAppealRecord(record.id, (current) => {
    current.status = "approved";
    current.reviewedAt = Date.now();
    current.reviewedById = interaction.user.id;
    current.reviewedByTag = interaction.user.tag || interaction.user.username || interaction.user.id;
    return current;
  });

  await updateReviewMessage(
    interaction,
    updated,
    COLOR_APPROVED,
    "Ban Appeal Approved",
    `${ACCEPTED} Approved by ${interaction.user.tag || interaction.user.username}.\n${unbanText}`
  );

  await dmUserDecision(interaction.client, updated, true).catch(() => false);

  await logModerationAction(interaction, {
    action: "Ban Appeal Approved / Unban",
    targetUser: { id: record.userId, tag: record.userTag, username: record.userTag },
    reason: record.ruleLabel,
    details: `Reviewed by ${interaction.user.tag || interaction.user.username}. ${unbanText}`,
  }).catch(() => null);

  await safeReply(interaction, { content: `${ACCEPTED} Appeal approved. ${unbanText}`, ephemeral: true });
  return true;
}

async function handleDeny(interaction, recordId) {
  const record = getAppealRecord(recordId);
  if (!record) {
    await safeReply(interaction, { content: "I could not find that appeal case.", ephemeral: true });
    return true;
  }

  if (!atLeastTier(interaction.member, getReviewerMinTier())) {
    await safeReply(interaction, { content: "You do not have permission to review ban appeals.", ephemeral: true });
    return true;
  }

  await interaction.deferReply({ ephemeral: true }).catch(() => null);

  const updated = updateAppealRecord(record.id, (current) => {
    current.status = "denied";
    current.reviewedAt = Date.now();
    current.reviewedById = interaction.user.id;
    current.reviewedByTag = interaction.user.tag || interaction.user.username || interaction.user.id;
    return current;
  });

  await updateReviewMessage(
    interaction,
    updated,
    COLOR_DENIED,
    "Ban Appeal Denied",
    `Denied by ${interaction.user.tag || interaction.user.username}.`
  );

  await dmUserDecision(interaction.client, updated, false).catch(() => false);

  await logModerationAction(interaction, {
    action: "Ban Appeal Denied",
    targetUser: { id: record.userId, tag: record.userTag, username: record.userTag },
    reason: record.ruleLabel,
    details: `Reviewed by ${interaction.user.tag || interaction.user.username}.`,
  }).catch(() => null);

  await safeReply(interaction, { content: "Appeal denied.", ephemeral: true });
  return true;
}

async function handleCloseThread(interaction, recordId) {
  const record = getAppealRecord(recordId);
  if (!record) {
    await safeReply(interaction, { content: "I could not find that appeal case.", ephemeral: true });
    return true;
  }

  if (!atLeastTier(interaction.member, getReviewerMinTier())) {
    await safeReply(interaction, { content: "You do not have permission to close ban appeal threads.", ephemeral: true });
    return true;
  }

  await interaction.deferReply({ ephemeral: true }).catch(() => null);

  if (interaction.channel?.isThread?.()) {
    await interaction.channel.setArchived(true, `Ban appeal thread closed by ${interaction.user.tag}`).catch(() => null);
  }

  await safeReply(interaction, { content: "Thread closed.", ephemeral: true });
  return true;
}

async function handleBanAppealInteraction(interaction) {
  const id = interaction.customId || "";
  if (!id.startsWith("banappeal:")) return false;

  const [, action, recordId] = id.split(":");

  if (interaction.isButton() && action === "start") return handleAppealStart(interaction, recordId);
  if (interaction.isModalSubmit() && action === "submit") return handleAppealSubmit(interaction, recordId);
  if (interaction.isButton() && action === "approve") return handleApprove(interaction, recordId);
  if (interaction.isButton() && action === "deny") return handleDeny(interaction, recordId);
  if (interaction.isButton() && action === "close") return handleCloseThread(interaction, recordId);

  return false;
}

module.exports = {
  RULES,
  getRuleById,
  getRuleChoices,
  createBanAppealRecord,
  getLatestAppealForUser,
  sendBanNotice,
  sendAppealInvite,
  runBanAppealReminderTick,
  handleBanAppealInteraction,
  formatDateTime,
  formatRelative,
};
