// src/utils/banAppeals.js
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const https = require("node:https");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
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
const SESSION_COOKIE = "glace_appeal_session";
const STATE_COOKIE = "glace_appeal_state";
const SESSION_MAX_AGE_SECONDS = 60 * 60; // 1 hour

const PRIVACY_WARNING =
  "Please do not include private Glace information in your appeal. Do not share reporter names, private channel names, screenshots, staff-only information, unreleased builds, systems, evidence details, or anything confidential. Keep your answers general and focus on accountability, understanding, and what you would do differently.";

const RULES = [
  {
    id: "1",
    label: "Rule 1 - Be respectful",
    title: "Be respectful",
    text: "Treat everyone with respect. Harassment, discrimination, or targeted hostility of any kind is not allowed.",
    extraQuestions: [
      "What led to the disrespectful behavior, in general terms?",
      "How would you handle that same situation differently now?",
      "How can we trust that you will treat others respectfully if you return?",
    ],
  },
  {
    id: "2",
    label: "Rule 2 - Nickname requirement",
    title: "Nickname requirement",
    text: "Your server nickname must match your Roblox username at all times after verifying. Do not change it. Refusal after being told will result in a warning.",
    extraQuestions: [
      "What Roblox username should your server nickname match?",
      "Why do you understand this rule is important for staff and verification?",
      "How will you make sure your nickname stays correct if you return?",
    ],
  },
  {
    id: "3",
    label: "Rule 3 - No leaking",
    title: "No leaking",
    text: "Do not share non-public information. This includes builds, systems, staff information, channels, operations, or future plans. Leaking will result in an immediate ban.",
    extraQuestions: [
      "Without repeating or sharing the private information, please explain what kind of situation led to your ban.",
      "Do you understand why leaking or sharing private Glace information is serious?",
      "How can we trust that you will respect Glace confidentiality moving forward?",
    ],
  },
  {
    id: "4",
    label: "Rule 4 - Use channels correctly",
    title: "Use channels correctly",
    text: "Only use channels for their intended purpose. Off-topic or misplaced messages may be removed.",
    extraQuestions: [
      "What type of channel misuse happened, in general terms?",
      "Why does Glace need channels to stay organized?",
      "How will you make sure you use channels correctly if you return?",
    ],
  },
  {
    id: "5",
    label: "Rule 5 - Allowed languages",
    title: "Allowed languages",
    text: "Only English, Spanish, Portuguese, Italian, and French are permitted.",
    extraQuestions: [
      "Which allowed language will you use in Glace moving forward?",
      "Why do you understand that language rules help moderation stay fair?",
      "How will you avoid breaking this rule again if you return?",
    ],
  },
  {
    id: "6",
    label: "Rule 6 - No swearing",
    title: "No swearing",
    text: "Swearing or offensive language is not allowed anywhere in the server. Minor cursing is only allowed in Frostbite VC.",
    extraQuestions: [
      "What kind of language issue led to your ban, in general terms?",
      "Why do you understand Glace keeps language clean in most spaces?",
      "What will you do differently before sending messages when upset or joking?",
    ],
  },
  {
    id: "7",
    label: "Rule 7 - No inappropriate content",
    title: "No inappropriate content",
    text: "Sexual, violent, discriminatory, or otherwise inappropriate content is strictly prohibited.",
    extraQuestions: [
      "Without reposting or describing graphic details, please explain what happened in general terms.",
      "Why was that content not okay for Glace Hotels?",
      "How will you make sure this does not happen again?",
    ],
  },
  {
    id: "8",
    label: "Rule 8 - No personal information",
    title: "No personal information",
    text: "Do not share personal or private information, including real names, addresses, phone numbers, emails, or social media accounts.",
    extraQuestions: [
      "Without repeating any personal or private information, please explain what happened in general terms.",
      "Do you understand why sharing personal information is serious?",
      "How will you protect others’ privacy if you return?",
    ],
  },
  {
    id: "9",
    label: "Rule 9 - No advertising",
    title: "No advertising",
    text: "Advertising, self-promotion, or promoting other servers, groups, or services is not allowed.",
    extraQuestions: [
      "What type of advertising or promotion happened, in general terms?",
      "Do you understand why advertising is not allowed in Glace?",
      "How will you avoid advertising or self-promotion if you return?",
    ],
  },
  {
    id: "10",
    label: "Rule 10 - No spamming",
    title: "No spamming",
    text: "Spam of any kind is prohibited. This includes message spam, emoji spam, link spam, or disruptive behavior.",
    extraQuestions: [
      "What type of spam or disruption happened?",
      "Why does spam make the server harder for others to use?",
      "How will you control your messages if you are allowed back?",
    ],
  },
  {
    id: "11",
    label: "Rule 11 - Voice channel conduct",
    title: "Voice channel conduct",
    text: "Do not disrupt voice channels. Loud audio, mic abuse, soundboards, or disruptive voice changers are not allowed.",
    extraQuestions: [
      "What happened in voice chat, in general terms?",
      "Why do you understand VC conduct matters for everyone’s comfort?",
      "How will you behave in voice channels if you return?",
    ],
  },
  {
    id: "12",
    label: "Rule 12 - No drama or arguments",
    title: "No drama or arguments",
    text: "Do not start or continue drama in public channels. If there is an issue, open a ticket or DM Corporate+ respectfully.",
    extraQuestions: [
      "What caused the public drama or argument, in general terms?",
      "How would you handle conflict differently now?",
      "Who should you go to if there is an issue instead of continuing drama publicly?",
    ],
  },
  {
    id: "13",
    label: "Rule 13 - Restricted channel answers",
    title: "Restricted channel answers",
    text: "Only Assistant Managers+ may answer questions in the questions channel. Leadership Interns+ may respond to photo submission requests only.",
    extraQuestions: [
      "What channel/rank boundary did you ignore, in general terms?",
      "Why do you understand rank boundaries help prevent confusion?",
      "How will you make sure you only answer where your rank is allowed?",
    ],
  },
  {
    id: "14",
    label: "Rule 14 - State your issue clearly",
    title: "State your issue clearly",
    text: "You must state your issue within 10 minutes of opening a ticket. Failure to do so may result in the ticket being closed and a warning.",
    extraQuestions: [
      "What happened with the ticket, in general terms?",
      "Why do you understand staff need a clear issue quickly?",
      "What will you do differently when opening tickets?",
    ],
  },
  {
    id: "15",
    label: "Rule 15 - Do not ping staff in tickets",
    title: "Do not ping staff in tickets",
    text: "Do not ping staff members inside tickets. Our system already alerts the appropriate team.",
    extraQuestions: [
      "What happened with staff pings, in general terms?",
      "Why do you understand pinging staff in tickets is not needed?",
      "How will you ask for help patiently if you return?",
    ],
  },
  {
    id: "16",
    label: "Rule 16 - Ticket misuse",
    title: "Ticket misuse",
    text: "Misusing the ticket system or opening unnecessary tickets may result in a warning.",
    extraQuestions: [
      "What type of ticket misuse happened, in general terms?",
      "Why does ticket misuse make it harder for staff to help people?",
      "How will you use tickets properly if you return?",
    ],
  },
  {
    id: "17",
    label: "Rule 17 - No video files",
    title: "No video files",
    text: "Do not upload video files. Use links only, such as Gyazo, Medal, or YouTube.",
    extraQuestions: [
      "What was uploaded or attempted, in general terms?",
      "Why do you understand Glace asks for evidence links instead of video files?",
      "How will you share evidence correctly if you return?",
    ],
  },
  {
    id: "18",
    label: "Rule 18 - No fake or edited evidence",
    title: "No fake or edited evidence",
    text: "Edited, fabricated, or misleading evidence will result in severe punishment.",
    extraQuestions: [
      "Without reposting evidence or naming anyone involved, please explain what happened in general terms.",
      "Why is fake, edited, or misleading evidence harmful to the community?",
      "How can we trust future reports or evidence from you?",
    ],
  },
  {
    id: "19",
    label: "Rule 19 - Reporter confidentiality",
    title: "Reporter confidentiality",
    text: "Do not leak, expose, or confront reporters. Report channels are confidential.",
    extraQuestions: [
      "Without naming the reporter or sharing any confidential details, please explain what happened in general terms.",
      "Do you understand why reporter confidentiality matters?",
      "How will you respect private reports moving forward?",
    ],
  },
  {
    id: "20",
    label: "Rule 20 - Discord Terms/Guidelines",
    title: "Discord Terms/Guidelines",
    text: "All users must follow Discord’s Terms of Service and Community Guidelines.",
    extraQuestions: [
      "What Discord policy issue happened, in general terms?",
      "Why do you understand Discord policies apply inside Glace too?",
      "How will you make sure you follow Discord policies if you return?",
    ],
  },
  {
    id: "21",
    label: "Rule 21 - Age requirement",
    title: "Age requirement",
    text: "You must be 13 years or older to remain in this server. Anyone claiming to be under 13, including jokes, will be removed immediately.",
    extraQuestions: [
      "Do you understand Discord requires users to be 13 or older?",
      "Why do you believe this ban should be reviewed?",
      "Is there anything else you would like our Corporate Team to know?",
    ],
  },
];

const DEFAULT_QUESTIONS = [
  "In your own words, why were you banned from Glace Hotels? Keep your answer general and do not include private details.",
  "Do you understand why this rule exists? Please explain it in your own words.",
  "What have you learned from this situation?",
  "Why do you believe you are ready to return to Glace Hotels?",
  "If you are allowed back, what will you do differently to make sure this does not happen again?",
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

function formatPlainDate(ms) {
  if (!ms) return "Unknown";
  try {
    return new Date(Number(ms)).toLocaleString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return "Unknown";
  }
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

function truncate(value, limit) {
  const text = String(value || "");
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function getBaseUrl() {
  const raw =
    process.env.BAN_APPEAL_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    process.env.WEB_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : "");

  return String(raw || "").trim().replace(/\/$/, "");
}

function getPublicAppealUrl() {
  const base = getBaseUrl();
  return base ? `${base}/appeal` : "";
}

function getAppealUrl(record) {
  const base = getBaseUrl();
  if (!base) return "";
  return `${base}/appeal?case=${encodeURIComponent(record.id)}`;
}

function getAppealUrlText(record) {
  const url = record ? getAppealUrl(record) : getPublicAppealUrl();
  return url || "Appeal link is not configured yet. Staff must set BAN_APPEAL_BASE_URL in Render.";
}

function getOauthConfig() {
  const baseUrl = getBaseUrl();
  const clientId = process.env.DISCORD_CLIENT_ID || process.env.CLIENT_ID || process.env.APPLICATION_ID || "";
  const clientSecret = process.env.DISCORD_CLIENT_SECRET || process.env.CLIENT_SECRET || "";
  return {
    baseUrl,
    clientId: String(clientId || "").trim(),
    clientSecret: String(clientSecret || "").trim(),
    redirectUri: baseUrl ? `${baseUrl}/appeal/callback` : "",
  };
}

function getSessionSecret() {
  return (
    process.env.BAN_APPEAL_SESSION_SECRET ||
    process.env.DISCORD_CLIENT_SECRET ||
    process.env.CLIENT_SECRET ||
    process.env.DISCORD_TOKEN ||
    "glace-dev-session-secret"
  );
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function signPayload(payload) {
  const json = JSON.stringify(payload);
  const body = base64url(json);
  const sig = crypto.createHmac("sha256", getSessionSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyPayload(token) {
  const raw = String(token || "");
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", getSessionSecret()).update(body).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (parsed.exp && Number(parsed.exp) < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function cookieString(name, value, maxAgeSeconds) {
  const attrs = [
    `${name}=${encodeURIComponent(value)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
  ];
  if (String(process.env.BAN_APPEAL_INSECURE_COOKIES || "false").toLowerCase() !== "true") attrs.push("Secure");
  if (typeof maxAgeSeconds === "number") attrs.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  return attrs.join("; ");
}

function getSession(req) {
  const cookies = parseCookies(req);
  const session = verifyPayload(cookies[SESSION_COOKIE]);
  if (!session?.id) return null;
  return session;
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

function markBanFailed(recordId, errorText = "Unknown error") {
  return updateAppealRecord(recordId, (current) => {
    current.status = "ban_failed";
    current.banFailedAt = Date.now();
    current.banFailedReason = String(errorText || "Unknown error").slice(0, 500);
    return current;
  });
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

function getLatestAppealForDiscordUser(userId, preferredCaseId = "") {
  const store = readStore();
  if (preferredCaseId) {
    const record = store.appeals.find((r) => r.id === preferredCaseId) || null;
    if (record && record.userId === userId) return record;
    return null;
  }

  const activeStatuses = new Set(["banned", "ready", "not_appealable", "submitted", "approved", "denied", "ban_failed"]);
  return [...store.appeals]
    .reverse()
    .find((record) => record.userId === userId && activeStatuses.has(record.status)) || null;
}

function createBanAppealRecord({ guild, user, moderator, rule, appealable, cooldownDays }) {
  const now = Date.now();
  const safeCooldown = clampCooldownDays(cooldownDays);
  const availableAt = appealable ? now + safeCooldown * 24 * 60 * 60 * 1000 : null;

  const store = readStore();

  for (const record of store.appeals) {
    if (
      record.guildId === guild.id &&
      record.userId === user.id &&
      ["banned", "ready", "submitted", "not_appealable"].includes(record.status)
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
    lastDmError: null,
    appealSubmittedAt: null,
    appealLinkSentAt: null,
    webSubmittedAt: null,
    answers: null,
    oauthUser: null,
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
      ? "Your appeal is open now. Please use the Ban Appeal Center link below when you are ready."
      : `Your appeal opens ${formatRelative(record.availableAt)}.`;

  const embed = new EmbedBuilder()
    .setColor(record.appealable ? COLOR_PENDING : COLOR_DENIED)
    .setTitle(`${GLACE} Glace Hotels | Ban Notice`)
    .setDescription(
      `Hi there,\n\nYou have been banned from the **Glace Hotels** Discord server.\n\n${appealLine}`
    )
    .addFields(
      { name: "Rule Broken", value: `${record.ruleLabel}\n${record.ruleText}`.slice(0, 1024), inline: false },
      { name: "Appealable", value: record.appealable ? "Yes" : "No", inline: true },
      { name: "Appeal Opens", value: record.appealable ? formatDateTime(record.availableAt) : "Not available", inline: true }
    )
    .setFooter({ text: "Please be honest, calm, and respectful if you submit an appeal." })
    .setTimestamp(new Date(record.bannedAt));

  if (record.appealable) {
    embed.addFields({ name: "Ban Appeal Center", value: getAppealUrlText(record).slice(0, 1024), inline: false });
    embed.addFields({ name: "Privacy Reminder", value: "Do not include private Glace info, reporter names, screenshots, or leaked content in your appeal.", inline: false });
  }

  return embed;
}

function buildAppealReadyEmbed(record) {
  return new EmbedBuilder()
    .setColor(COLOR_GLACE)
    .setTitle(`${GLACE} Ban Appeal Open`)
    .setDescription("Your appeal cooldown is over. If you feel ready to explain what happened, you can submit your appeal through the Ban Appeal Center.")
    .addFields(
      { name: "Rule Broken", value: record.ruleLabel, inline: false },
      { name: "Ban Appeal Center", value: getAppealUrlText(record).slice(0, 1024), inline: false },
      { name: "Privacy Reminder", value: "Please keep your answers general. Do not share private Glace information, reporter names, screenshots, or leaked details.", inline: false }
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
  const result = await sendUserDm(user, { embeds: [buildBanNoticeEmbed(record)] }, preferredChannel);
  updateAppealRecord(record.id, (current) => {
    current.dmNoticeStatus = result.ok ? "sent" : "failed";
    current.dmAppealStatus = record.appealable ? (result.ok ? "link_sent" : "failed") : current.dmAppealStatus;
    current.dmChannelId = result.channelId || current.dmChannelId || null;
    current.lastDmAttemptAt = Date.now();
    current.nextDmAttemptAt = result.ok ? null : Date.now() + DM_RETRY_AFTER_MS;
    current.lastDmError = result.ok ? null : result.error;
    if (record.appealable && result.ok) current.appealLinkSentAt = Date.now();
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

  const result = await sendUserDm(user, { embeds: [buildAppealReadyEmbed(record)] }, preferredChannel);

  updateAppealRecord(record.id, (current) => {
    current.dmAppealStatus = result.ok ? "link_sent" : "failed";
    current.dmChannelId = result.channelId || current.dmChannelId || null;
    current.appealLinkSentAt = result.ok ? Date.now() : current.appealLinkSentAt || null;
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
      (!record.nextDmAttemptAt || record.nextDmAttemptAt <= now) &&
      record.dmAppealStatus !== "link_sent"
  );

  for (const record of readyRecords) {
    try {
      await sendAppealInvite(client, record);
    } catch (err) {
      console.error("[BAN APPEALS] Appeal invite tick failed:", err);
    }
  }
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function sendHtml(res, statusCode, html, extraHeaders = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(html);
}

function sendRedirect(res, location, extraHeaders = {}) {
  res.writeHead(303, { Location: location, ...extraHeaders });
  res.end();
}

function readRequestBody(req, limitBytes = 128 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > limitBytes) {
        reject(new Error("Form is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function parseFormBody(body) {
  const params = new URLSearchParams(body || "");
  const answers = [];
  for (let i = 0; i < 20; i += 1) {
    if (!params.has(`answer_${i}`)) continue;
    answers.push(String(params.get(`answer_${i}`) || "").trim());
  }
  return {
    caseId: String(params.get("case") || "").trim(),
    answers,
  };
}

function pageShell(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${htmlEscape(title)}</title>
  <style>
    :root { color-scheme: dark; --bg:#071525; --card:#10243a; --text:#f7fbff; --muted:#b8d4ed; --blue:#68b7ff; --blue2:#8bd0ff; --yellow:#ffd166; --green:#57f287; --red:#ff6b6b; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:Inter, Arial, Helvetica, sans-serif; background:radial-gradient(circle at top, #153b60, var(--bg) 48%); color:var(--text); min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
    .wrap { width:min(840px, 100%); }
    .card { background:rgba(16,36,58,.96); border:1px solid rgba(104,183,255,.28); box-shadow:0 18px 60px rgba(0,0,0,.35); border-radius:24px; overflow:hidden; }
    .top { padding:26px 28px; border-bottom:1px solid rgba(104,183,255,.20); background:linear-gradient(135deg, rgba(104,183,255,.16), rgba(255,255,255,.02)); }
    h1 { margin:0; font-size:26px; letter-spacing:.2px; }
    h2 { margin:24px 0 8px; font-size:18px; }
    .sub { color:var(--muted); margin-top:9px; line-height:1.5; }
    .content { padding:26px 28px; }
    .pill { display:inline-block; border:1px solid rgba(104,183,255,.34); background:rgba(104,183,255,.10); color:#dff1ff; padding:7px 11px; border-radius:999px; font-size:13px; margin:0 8px 8px 0; }
    label { display:block; font-weight:800; margin:19px 0 8px; line-height:1.35; }
    textarea { width:100%; min-height:118px; resize:vertical; border-radius:15px; border:1px solid rgba(104,183,255,.26); background:#091a2c; color:var(--text); padding:13px 14px; font:inherit; line-height:1.45; outline:none; }
    textarea:focus { border-color:var(--blue); box-shadow:0 0 0 3px rgba(104,183,255,.15); }
    .box { border-left:4px solid var(--yellow); background:rgba(255,209,102,.08); padding:14px 16px; border-radius:13px; margin:16px 0; line-height:1.5; }
    .error { border-left-color:var(--red); background:rgba(255,107,107,.10); }
    .ok { border-left-color:var(--green); background:rgba(87,242,135,.10); }
    .soft { border-left-color:var(--blue); background:rgba(104,183,255,.10); }
    button, .button { display:inline-block; margin-top:20px; background:linear-gradient(135deg, #4fa8ff, #8bd0ff); color:#06111f; border:0; border-radius:15px; padding:13px 18px; font-weight:900; cursor:pointer; text-decoration:none; }
    .button.secondary { background:rgba(255,255,255,.08); color:var(--text); border:1px solid rgba(255,255,255,.18); }
    .small { font-size:13px; color:var(--muted); margin-top:18px; line-height:1.55; }
    .footer { padding:17px 28px 23px; color:var(--muted); font-size:12px; border-top:1px solid rgba(104,183,255,.14); }
    .qnum { color:var(--blue2); font-weight:900; }
  </style>
</head>
<body><main class="wrap"><section class="card">${body}</section></main></body>
</html>`;
}

function renderLanding(caseId = "") {
  const cfg = getOauthConfig();
  const setupOk = Boolean(cfg.baseUrl && cfg.clientId && cfg.clientSecret);
  const loginHref = `/appeal/login${caseId ? `?case=${encodeURIComponent(caseId)}` : ""}`;
  const setupWarning = setupOk
    ? ""
    : `<div class="box error"><b>Setup needed</b><br>Discord OAuth is not fully configured yet. Staff must add BAN_APPEAL_BASE_URL, DISCORD_CLIENT_ID, and DISCORD_CLIENT_SECRET in Render.</div>`;

  return pageShell(
    "Glace Hotels | Ban Appeal Center",
    `<div class="top"><h1>˗ˏˋ Glace Hotels ˎˊ˗</h1><div class="sub">Ban Appeal Center</div></div>
     <div class="content">
       ${setupWarning}
       <div class="box soft">Welcome to the Glace Hotels Ban Appeal Center.<br><br>To continue, please sign in with your Discord account. This helps us confirm who you are and keeps the appeal process fair.</div>
       <a class="button" href="${htmlEscape(loginHref)}">Sign in with Discord</a>
       <p class="small">We only use Discord login to confirm your Discord account ID for this appeal. Please make sure you sign into the account that was banned from Glace.</p>
     </div>
     <div class="footer">Glace Hotels • Fairness, care, and professionalism.</div>`
  );
}

function renderStatusPage(record, title, message, status = "note", session = null) {
  const cls = status === "error" ? "box error" : status === "ok" ? "box ok" : "box";
  const signedIn = session ? `<span class="pill">Signed in as ${htmlEscape(session.displayName || session.username || session.id)}</span>` : "";
  return pageShell(
    `Glace Hotels | ${title}`,
    `<div class="top"><h1>${GLACE} Glace Hotels | Ban Appeal</h1><div class="sub">Please read this carefully before taking any next steps.</div></div>
     <div class="content">
       ${signedIn}
       <div class="${cls}">${message}</div>
       ${record ? `<span class="pill">${htmlEscape(record.ruleLabel)}</span><span class="pill">Case ${htmlEscape(record.id)}</span>` : ""}
       <p class="small">If you believe this is a mistake, please use any public Glace support method available to you and stay respectful.</p>
       <a class="button secondary" href="/appeal/logout">Sign out</a>
     </div>
     <div class="footer">Glace Hotels • Fairness, care, and professionalism.</div>`
  );
}

function buildQuestionsForRecord(record) {
  const rule = getRuleById(record.ruleId) || null;
  return [...DEFAULT_QUESTIONS, ...((rule && rule.extraQuestions) || [])];
}

function renderAppealForm(record, session) {
  const questions = buildQuestionsForRecord(record);
  const questionHtml = questions
    .map(
      (q, i) =>
        `<label for="answer_${i}"><span class="qnum">${i + 1}.</span> ${htmlEscape(q)}</label>
         <textarea id="answer_${i}" name="answer_${i}" maxlength="1200" required placeholder="Type your answer here..."></textarea>`
    )
    .join("\n");

  return pageShell(
    "Glace Hotels | Ban Appeal Form",
    `<div class="top"><h1>${GLACE} Glace Hotels | Ban Appeal Form</h1><div class="sub">Please answer each question honestly and with as much detail as you can.</div></div>
     <div class="content">
       <span class="pill">Signed in as ${htmlEscape(session.displayName || session.username || session.id)}</span>
       <span class="pill">${htmlEscape(record.ruleLabel)}</span>
       <span class="pill">Appeal opened ${htmlEscape(formatPlainDate(record.availableAt || Date.now()))}</span>
       <div class="box"><b>Rule Broken</b><br>${htmlEscape(record.ruleLabel)}<br>${htmlEscape(record.ruleText)}</div>
       <div class="box error"><b>Privacy Reminder</b><br>${htmlEscape(PRIVACY_WARNING)}</div>
       <form method="post" action="/appeal/submit">
         <input type="hidden" name="case" value="${htmlEscape(record.id)}" />
         ${questionHtml}
         <button type="submit">Submit Ban Appeal</button>
       </form>
       <p class="small">Appeals that include private information, reporter names, screenshots, channel names, or leaked content may be denied or removed from review.</p>
     </div>
     <div class="footer">Glace Hotels • Appeal Case ${htmlEscape(record.id)}</div>`
  );
}

function validateAppealAccess(record, session = null) {
  if (!record) return { ok: false, status: 404, html: renderStatusPage(null, "No Appeal Found", `${GLACE} <b>No Appeal Found</b><br><br>Sorry, we could not find an available ban appeal for your Discord account.<br><br>Please make sure you are signed into the correct Discord account, your ban is appealable, your appeal cooldown has ended, and you have not already submitted an appeal.`, "error", session) };
  if (session?.id && record.userId !== session.id) return { ok: false, status: 403, html: renderStatusPage(null, "Wrong Account", `${GLACE} <b>Wrong Discord Account</b><br><br>This appeal case does not belong to the Discord account you signed in with. Please sign into the account that was banned.`, "error", session) };
  if (!record.appealable) return { ok: false, status: 403, html: renderStatusPage(record, "Appeal Unavailable", `${GLACE} <b>Appeal Unavailable</b><br><br>This ban is currently marked as <b>not appealable</b>. Because of that, you are not able to submit an appeal for this ban at this time.`, "error", session) };
  if (record.status === "ban_failed") return { ok: false, status: 403, html: renderStatusPage(record, "Ban Not Completed", "This case was saved, but the ban itself did not complete. Staff will need to review it manually.", "error", session) };
  if (record.status === "replaced") return { ok: false, status: 403, html: renderStatusPage(record, "Old Appeal Case", "This appeal case was replaced by a newer ban case. Please use the newest appeal available for your account.", "error", session) };
  if (record.availableAt && record.availableAt > Date.now()) return { ok: false, status: 403, html: renderStatusPage(record, "Appeal Not Open Yet", `${GLACE} <b>Appeal Not Open Yet</b><br><br>Your ban appeal is not available just yet.<br><br><b>Rule Broken:</b> ${htmlEscape(record.ruleLabel)}<br><b>Appeal Opens:</b> ${htmlEscape(formatPlainDate(record.availableAt))}<br><br>Please come back once your cooldown has ended.`, "error", session) };
  if (["submitted", "approved", "denied"].includes(record.status)) return { ok: false, status: 200, html: renderStatusPage(record, "Appeal Already Submitted", `${ACCEPTED} <b>Appeal Already Submitted</b><br><br>You have already submitted an appeal for this ban. Our Corporate Team will review it as soon as they can. Please do not submit extra appeals or attempt to bypass the process.`, "ok", session) };
  return { ok: true };
}

function httpsRequestJson(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : {}; }
        catch { parsed = { raw: data }; }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error(`HTTP ${res.statusCode}: ${data}`);
          err.statusCode = res.statusCode;
          err.body = parsed;
          reject(err);
        } else {
          resolve(parsed);
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function buildDiscordAuthUrl(caseId = "") {
  const cfg = getOauthConfig();
  if (!cfg.baseUrl || !cfg.clientId || !cfg.clientSecret || !cfg.redirectUri) return null;
  const nonce = crypto.randomBytes(18).toString("base64url");
  const statePayload = { nonce, caseId, exp: Date.now() + 10 * 60 * 1000 };
  const stateCookie = signPayload(statePayload);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: "identify",
    state: nonce,
    prompt: "none",
  });
  return {
    url: `https://discord.com/oauth2/authorize?${params.toString()}`,
    cookie: cookieString(STATE_COOKIE, stateCookie, 10 * 60),
  };
}

async function exchangeCodeForDiscordUser(code) {
  const cfg = getOauthConfig();
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
  }).toString();

  const token = await httpsRequestJson(
    "https://discord.com/api/oauth2/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    },
    body
  );

  const user = await httpsRequestJson("https://discord.com/api/users/@me", {
    method: "GET",
    headers: { Authorization: `Bearer ${token.access_token}` },
  });

  return user;
}

function discordDisplayName(user) {
  const username = user.global_name || user.username || user.id;
  if (user.username && user.discriminator && user.discriminator !== "0") return `${username} (${user.username}#${user.discriminator})`;
  if (user.username && username !== user.username) return `${username} (@${user.username})`;
  return username;
}

async function handleOauthCallback(req, res, parsed) {
  const code = String(parsed.searchParams.get("code") || "").trim();
  const state = String(parsed.searchParams.get("state") || "").trim();
  const cookies = parseCookies(req);
  const savedState = verifyPayload(cookies[STATE_COOKIE]);

  if (!code || !state || !savedState || savedState.nonce !== state) {
    return sendHtml(res, 400, renderStatusPage(null, "Login Failed", "The Discord login session expired or could not be verified. Please try signing in again.", "error"));
  }

  try {
    const user = await exchangeCodeForDiscordUser(code);
    const session = {
      id: user.id,
      username: user.username,
      globalName: user.global_name || null,
      displayName: discordDisplayName(user),
      avatar: user.avatar || null,
      exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
    };
    const sessionCookie = cookieString(SESSION_COOKIE, signPayload(session), SESSION_MAX_AGE_SECONDS);
    const clearState = cookieString(STATE_COOKIE, "", 0);
    const target = `/appeal/form${savedState.caseId ? `?case=${encodeURIComponent(savedState.caseId)}` : ""}`;
    return sendRedirect(res, target, { "Set-Cookie": [sessionCookie, clearState] });
  } catch (err) {
    console.error("[BAN APPEALS] OAuth callback failed:", err);
    return sendHtml(res, 500, renderStatusPage(null, "Login Failed", "Discord login did not complete. Please try again in a moment.", "error"));
  }
}

async function fetchGuild(client, guildId) {
  if (!client || !guildId) return null;
  return client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
}

async function findReviewChannel(guild) {
  const envId = process.env.BAN_APPEAL_REVIEW_CHANNEL_ID;
  if (envId) {
    const channel = await guild.channels.fetch(envId).catch(() => null);
    if (channel?.send) return channel;
  }

  const names = ["ban-appeals", "ban-appeal", "appeals", "corp-audit-log", "audit-log"];
  for (const name of names) {
    const channel = guild.channels.cache.find((ch) => ch?.name === name && ch?.send);
    if (channel) return channel;
  }

  const channels = await guild.channels.fetch().catch(() => null);
  if (channels) {
    for (const name of names) {
      const channel = channels.find((ch) => ch?.name === name && ch?.send);
      if (channel) return channel;
    }
  }
  return null;
}

function buildSubmittedAppealEmbed(record) {
  const embed = new EmbedBuilder()
    .setColor(COLOR_SOFT)
    .setTitle(`${GLACE} Ban Appeal Review`)
    .setDescription("A new ban appeal has been submitted. Please review it fairly and carefully.")
    .addFields(
      { name: "User", value: `${record.userTag || "Unknown"}\n${record.userId}`, inline: true },
      { name: "Rule Broken", value: record.ruleLabel || "Unknown", inline: true },
      { name: "Ban Date", value: formatDateTime(record.bannedAt), inline: true },
      { name: "Appeal Opened", value: formatDateTime(record.availableAt || record.bannedAt), inline: true },
      { name: "Appeal Submitted", value: formatDateTime(record.appealSubmittedAt || Date.now()), inline: true },
      { name: "Discord Login", value: record.oauthUser ? `${record.oauthUser.displayName}\n${record.oauthUser.id}` : "Unknown", inline: true },
      { name: "Safety Reminder", value: "Do not ask the user to reveal reporter names, private channels, screenshots, leaked details, or staff-only information during review.", inline: false }
    )
    .setTimestamp(new Date(record.appealSubmittedAt || Date.now()));

  const answers = Array.isArray(record.answers) ? record.answers : [];
  answers.forEach((entry, index) => {
    embed.addFields({
      name: truncate(`${index + 1}. ${entry.question || "Question"}`, 256),
      value: safeText(entry.answer, 1024),
      inline: false,
    });
  });

  return embed;
}

async function createReviewThread(guild, record) {
  const reviewChannel = await findReviewChannel(guild);
  if (!reviewChannel) throw new Error("No ban appeal review channel found.");

  const safeNameBase = (record.userTag || record.userId || "user").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24) || "user";
  const threadName = `Appeal - ${safeNameBase} - Rule ${record.ruleId}`.slice(0, 95);

  const starter = await reviewChannel.send({
    content: `${GLACE} New ban appeal submitted for **${record.userTag || record.userId}** — ${record.ruleLabel}`,
    allowedMentions: { parse: [] },
  });

  const thread = await starter.startThread({
    name: threadName,
    autoArchiveDuration: 10080,
    reason: `Ban appeal submitted by ${record.userTag || record.userId}`,
  });

  const reviewMessage = await thread.send({
    embeds: [buildSubmittedAppealEmbed(record)],
    components: [buildReviewButtons(record)],
  });

  await starter.edit({ content: `${GLACE} New ban appeal submitted: ${thread}` }).catch(() => null);

  const updated = updateAppealRecord(record.id, (current) => {
    current.reviewChannelId = reviewChannel.id;
    current.reviewThreadId = thread.id;
    current.reviewMessageId = reviewMessage.id;
    return current;
  });

  return updated || record;
}

async function submitAppealFromWeb(client, form, session) {
  let record = getAppealRecord(form.caseId);
  const access = validateAppealAccess(record, session);
  if (!access.ok) return { status: access.status, html: access.html };

  const questions = buildQuestionsForRecord(record);
  const answers = questions.map((question, index) => ({
    question,
    answer: String(form.answers[index] || "").trim().slice(0, 1200),
  }));

  if (answers.some((entry) => !entry.answer)) {
    return { status: 400, html: renderStatusPage(record, "Missing Answers", "Please fill out every required question before submitting your appeal.", "error", session) };
  }

  record = updateAppealRecord(record.id, (current) => {
    current.status = "submitted";
    current.appealSubmittedAt = Date.now();
    current.webSubmittedAt = Date.now();
    current.answers = answers;
    current.oauthUser = {
      id: session.id,
      username: session.username || null,
      globalName: session.globalName || null,
      displayName: session.displayName || session.username || session.id,
    };
    return current;
  });

  const guild = client ? await fetchGuild(client, record.guildId) : null;
  if (guild) {
    try {
      await createReviewThread(guild, record);
    } catch (err) {
      console.error("[BAN APPEALS] Failed to create review thread from website:", err);
    }
  }

  return {
    status: 200,
    html: renderStatusPage(
      record,
      "Appeal Submitted",
      `${ACCEPTED} <b>Appeal Submitted</b><br><br>Thank you for submitting your ban appeal. Your appeal has been sent to the Glace Hotels Corporate Team for review. Please be patient while we look over everything.<br><br>Submitting extra appeals or trying to rush the process may affect the review.`,
      "ok",
      session
    ),
  };
}

async function handleAppealWebRequest(req, res, client) {
  try {
    const parsed = new URL(req.url, "http://localhost");
    const caseId = String(parsed.searchParams.get("case") || "").trim();

    if (req.method === "GET" && parsed.pathname === "/appeal") {
      const session = getSession(req);
      if (session) {
        return sendRedirect(res, `/appeal/form${caseId ? `?case=${encodeURIComponent(caseId)}` : ""}`);
      }
      return sendHtml(res, 200, renderLanding(caseId));
    }

    if (req.method === "GET" && parsed.pathname === "/appeal/login") {
      const auth = buildDiscordAuthUrl(caseId);
      if (!auth) {
        return sendHtml(res, 500, renderStatusPage(null, "Setup Needed", "Discord login is not configured yet. Staff must add the OAuth environment variables in Render first.", "error"));
      }
      return sendRedirect(res, auth.url, { "Set-Cookie": auth.cookie });
    }

    if (req.method === "GET" && parsed.pathname === "/appeal/callback") {
      return await handleOauthCallback(req, res, parsed);
    }

    if (req.method === "GET" && parsed.pathname === "/appeal/logout") {
      return sendRedirect(res, "/appeal", { "Set-Cookie": cookieString(SESSION_COOKIE, "", 0) });
    }

    if (req.method === "GET" && parsed.pathname === "/appeal/form") {
      const session = getSession(req);
      if (!session) return sendRedirect(res, `/appeal${caseId ? `?case=${encodeURIComponent(caseId)}` : ""}`);
      const record = getLatestAppealForDiscordUser(session.id, caseId);
      const access = validateAppealAccess(record, session);
      if (!access.ok) return sendHtml(res, access.status, access.html);
      return sendHtml(res, 200, renderAppealForm(record, session));
    }

    if (req.method === "POST" && parsed.pathname === "/appeal/submit") {
      const session = getSession(req);
      if (!session) return sendRedirect(res, "/appeal");
      const result = await submitAppealFromWeb(client, parseFormBody(await readRequestBody(req)), session);
      return sendHtml(res, result.status || 200, result.html);
    }

    return sendRedirect(res, "/");
  } catch (err) {
    console.error("[BAN APPEALS] Website request error:", err);
    return sendHtml(res, 500, renderStatusPage(null, "Error", "Something went wrong while loading the appeal page. Please try again later.", "error"));
  }
}

async function safeReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) return await interaction.editReply(payload);
    return await interaction.reply(payload);
  } catch {
    return null;
  }
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
    ? `Hi there,\n\nYour ban appeal has been reviewed and approved. You have been unbanned from the Glace Hotels Discord server.\n\nPlease make sure to follow our rules moving forward. We’re giving you another chance, and we truly hope you use it respectfully.${invite ? `\n\n${invite}` : ""}`
    : "Hi there,\n\nYour ban appeal has been reviewed, but it has been denied at this time.\n\nYour ban will remain active. Please do not submit extra appeals unless you are told you may appeal again.";

  const embed = new EmbedBuilder()
    .setColor(approved ? COLOR_APPROVED : COLOR_DENIED)
    .setTitle(approved ? `${ACCEPTED} Glace Hotels | Appeal Approved` : `${GLACE} Glace Hotels | Appeal Denied`)
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

  await updateReviewMessage(interaction, updated, COLOR_APPROVED, "Ban Appeal Approved", `${ACCEPTED} Approved by ${interaction.user.tag || interaction.user.username}.\n${unbanText}`);
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

  await updateReviewMessage(interaction, updated, COLOR_DENIED, "Ban Appeal Denied", `Denied by ${interaction.user.tag || interaction.user.username}.`);
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
  markBanFailed,
  runBanAppealReminderTick,
  handleBanAppealInteraction,
  handleAppealWebRequest,
  getAppealUrl,
  getPublicAppealUrl,
  formatDateTime,
  formatRelative,
};
