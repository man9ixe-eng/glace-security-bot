// src/utils/ticketSystem.js
"use strict";

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionsBitField,
  ChannelType,
  AttachmentBuilder,
} = require("discord.js");

const cfg = require("../config/tickets");
const { getNextNumberAndBump, markUserOpen, clearUserOpen } = require("./ticketsStore");

// Optional modlog (safe if missing)
let logModerationAction = null;
try {
  ({ logModerationAction } = require("./modlog"));
} catch {}

// -----------------------------
// Helpers
// -----------------------------
function normalizeTypeKey(raw) {
  if (!raw) return raw;
  const key = String(raw).toLowerCase().trim();
  const map = {
    "corporate-assist": "corporate",
    corporate: "corporate",
    "in-game-assist": "ingame",
    "ingame-assist": "ingame",
    "in-game": "ingame",
    ingame: "ingame",
    "kick-assist": "kick",
    kick: "kick",
    "ban-assist": "ban",
    ban: "ban",
    "pban-assist": "pban",
    pban: "pban",
  };
  return map[key] || key;
}

function getType(typeKeyRaw) {
  const typeKey = normalizeTypeKey(typeKeyRaw);
  const type = cfg.TYPES[typeKey];
  return { typeKey, type };
}

function safeUserTag(user) {
  if (!user) return "Unknown";
  if (user.discriminator && user.discriminator !== "0") return `${user.username}#${user.discriminator}`;
  return `${user.username} (${user.id})`;
}

// Always respond ephemerally (safe across states)
async function respondEphemeral(interaction, payload) {
  try {
    if (interaction.deferred && !interaction.replied) return await interaction.editReply(payload);
    if (interaction.replied) return await interaction.followUp({ ...payload, ephemeral: true });
    return await interaction.reply({ ...payload, ephemeral: true });
  } catch {}
}

function typeColor(typeKey) {
  const t = cfg.TYPES?.[typeKey];
  const c = t?.theme?.color;
  if (!c) return 0x3aa6ff;
  if (typeof c === "number") return c;
  // allow "#RRGGBB"
  if (typeof c === "string" && c.startsWith("#")) return parseInt(c.slice(1), 16);
  return 0x3aa6ff;
}

function buildTicketTopicLines(meta) {
  return [
    `Ticket Type: ${meta.typeLabel}`,
    `Opened by: ${meta.openerTag}`,
    `Claimed by: ${meta.claimedTag}`,
    `TypeKey: ${meta.typeKey}`,
    `Original: ${meta.originalName}`,
  ].join("\n");
}

function parseTicketTopic(channelTopic) {
  const topic = String(channelTopic || "");
  const lines = topic.split("\n").map((l) => l.trim());

  const out = {
    typeLabel: null,
    openerId: null,
    openerTag: null,
    claimedTag: null,
    claimerId: null,
    typeKey: null,
    originalName: null,
  };

  const grab = (prefix) => lines.find((l) => l.toLowerCase().startsWith(prefix)) || null;

  const typeLine = grab("ticket type:");
  if (typeLine) out.typeLabel = typeLine.split(":").slice(1).join(":").trim();

  const openedLine = grab("opened by:");
  if (openedLine) {
    const rhs = openedLine.split(":").slice(1).join(":").trim();
    out.openerTag = rhs;
    const m = rhs.match(/\((\d{10,25})\)\s*$/);
    if (m) out.openerId = m[1];
  }

  const claimedLine = grab("claimed by:");
  if (claimedLine) {
    const rhs = claimedLine.split(":").slice(1).join(":").trim();
    out.claimedTag = rhs;
    const m = rhs.match(/\((\d{10,25})\)\s*$/);
    if (m) out.claimerId = m[1];
  }

  const typeKeyLine = grab("typekey:");
  if (typeKeyLine) out.typeKey = normalizeTypeKey(typeKeyLine.split(":").slice(1).join(":").trim());

  const origLine = grab("original:");
  if (origLine) out.originalName = origLine.split(":").slice(1).join(":").trim();

  return out;
}

function isTicketChannel(channel) {
  if (!channel) return false;
  if (channel.type !== ChannelType.GuildText) return false;
  if (!channel.parentId) return false;
  if (channel.parentId !== cfg.SUPPORT_CATEGORY_ID) return false;
  const t = String(channel.topic || "");
  return t.includes("Ticket Type:") && t.includes("Opened by:");
}

function memberHasRole(member, roleId) {
  if (!roleId) return false;
  return member?.roles?.cache?.has(roleId) || false;
}

// -----------------------------
// Tier permission model (your rules)
// Intern tickets: ingame
// Management tickets: kick, ban
// Corporate tickets: corporate, pban
// -----------------------------
function getViewerRolesForType(typeKey) {
  const r = cfg.ROLES;

  const TRIAL = r.trial;
  const MOD = r.mod;
  const ADMIN = r.admin;
  const REVIEWER = r.reviewer;

  // Intern tier => Trial + up
  if (typeKey === "ingame") return [TRIAL, MOD, ADMIN, REVIEWER].filter(Boolean);

  // Management tier => Mod + up
  if (typeKey === "kick" || typeKey === "ban") return [MOD, ADMIN, REVIEWER].filter(Boolean);

  // Corporate tier => Reviewer only
  if (typeKey === "corporate" || typeKey === "pban") return [REVIEWER].filter(Boolean);

  // fallback: safest = reviewer only
  return [REVIEWER].filter(Boolean);
}

function canClaimType(member, typeKey) {
  // Claim rules can match your tier model too:
  // ingame => trial/mod/admin/reviewer
  // kick => mod/admin/reviewer
  // ban => admin/reviewer (or keep mod out)
  // corporate/pban => reviewer only

  const r = cfg.ROLES;
  const isTrial = memberHasRole(member, r.trial);
  const isMod = memberHasRole(member, r.mod);
  const isAdmin = memberHasRole(member, r.admin);
  const isReviewer = memberHasRole(member, r.reviewer);

  if (isReviewer) return true;

  switch (typeKey) {
    case "ingame":
      return isTrial || isMod || isAdmin;
    case "kick":
      return isMod || isAdmin;
    case "ban":
      return isAdmin; // change to (isMod || isAdmin) if you want mods to claim bans
    case "corporate":
    case "pban":
      return false; // reviewer-only
    default:
      return false;
  }
}

// Before claim: staff in allowed tier CAN type.
// After claim: ONLY opener + claimer + added users can type.
function buildTicketPermissions(guild, typeKey, openerId, claimerIdOrNull) {
  const botId = guild.members.me?.id;

  const openerAllow = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.AttachFiles,
    PermissionsBitField.Flags.EmbedLinks,
    PermissionsBitField.Flags.UseApplicationCommands, // ✅
  ];

  const staffView = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.UseApplicationCommands, // ✅
  ];

  const staffTalk = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.AttachFiles,
    PermissionsBitField.Flags.EmbedLinks,
    PermissionsBitField.Flags.UseApplicationCommands, // ✅
  ];

  const claimerAllow = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.AttachFiles,
    PermissionsBitField.Flags.EmbedLinks,
    PermissionsBitField.Flags.UseApplicationCommands, // ✅
  ];

  const viewerRoleIds = getViewerRolesForType(typeKey);

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: openerId, allow: openerAllow },
  ];

  if (botId) {
    overwrites.push({
      id: botId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageChannels,
        PermissionsBitField.Flags.ManageMessages,
        PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.EmbedLinks,
        PermissionsBitField.Flags.UseApplicationCommands,
      ],
    });
  }

  // Staff tier permissions:
  // - if UNCLAIMED => staff can TALK (so ping role can speak and claim comfortably)
  // - if CLAIMED => staff becomes VIEW ONLY (talk removed), claimer gets talk
  for (const rid of viewerRoleIds) {
    overwrites.push({
      id: rid,
      allow: claimerIdOrNull ? staffView : staffTalk,
      deny: claimerIdOrNull ? [PermissionsBitField.Flags.SendMessages] : [],
    });
  }

  if (claimerIdOrNull) {
    overwrites.push({ id: claimerIdOrNull, allow: claimerAllow });
  }

  return overwrites;
}

function parseTicketNumberFromName(name) {
  const m = String(name || "").match(/-(\d{1,4})$/);
  return m ? m[1] : null;
}

function getLogChannelIdForType(typeKey) {
  const t = cfg.TYPES[typeKey];
  if (!t) return null;
  const logKey = t.log;
  return cfg.LOGS?.[logKey] || null;
}

// -----------------------------
// PANEL
// -----------------------------
function buildPanelRow(typeKeyRaw) {
  const { typeKey, type } = getType(typeKeyRaw);
  if (!type) return null;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:create:${typeKey}`)
      .setLabel(type.buttonLabel || "Open Ticket")
      .setStyle(ButtonStyle.Primary)
  );
}

function buildPanelEmbed(typeKeyRaw) {
  const { typeKey, type } = getType(typeKeyRaw);
  if (!type) return null;

  return new EmbedBuilder()
    .setTitle(type.panelTitle || type.label || typeKey)
    .setDescription(type.panelBody || `Click below to open a **${type.label}** ticket.`)
    .setColor(typeColor(typeKey));
}

async function postPanel(interaction, typeKeyRaw) {
  const embed = buildPanelEmbed(typeKeyRaw);
  const row = buildPanelRow(typeKeyRaw);
  if (!embed || !row) return respondEphemeral(interaction, { content: "❌ Invalid ticket type." });

  await interaction.channel.send({ embeds: [embed], components: [row] });
  return respondEphemeral(interaction, { content: "✅ Panel posted." });
}

// -----------------------------
// CREATE
// -----------------------------
async function createTicketChannel(interaction, typeKeyRaw) {
  const { typeKey, type } = getType(typeKeyRaw);
  if (!type) return respondEphemeral(interaction, { content: "❌ Unknown ticket type." });

  const guild = interaction.guild;
  const opener = interaction.user;

  const supportCategory = guild.channels.cache.get(cfg.SUPPORT_CATEGORY_ID);
  if (!supportCategory) {
    return respondEphemeral(interaction, { content: "❌ SUPPORT_CATEGORY_ID invalid or bot cannot access it." });
  }

  const result = await getNextNumberAndBump(guild, typeKey, opener.id);
  if (result.blocked) {
    return respondEphemeral(interaction, { content: `❌ You already have an open ticket: <#${result.channelId}>` });
  }

  const num = result.number;
  const originalName = `${type.prefix}${String(num).padStart(2, "0")}`;

  const openerTag = safeUserTag(opener);

  const channel = await guild.channels.create({
    name: originalName,
    type: ChannelType.GuildText,
    parent: supportCategory.id,
    permissionOverwrites: buildTicketPermissions(guild, typeKey, opener.id, null),
    topic: buildTicketTopicLines({
      typeLabel: type.label,
      openerTag,
      claimedTag: "Unclaimed",
      typeKey,
      originalName,
    }),
  });

  await markUserOpen(guild, opener.id, channel.id);

  const pingRoleId = cfg.ROLES[type.pingRole];
  const pingRole = pingRoleId ? guild.roles.cache.get(pingRoleId) : null;

  const openEmbed = new EmbedBuilder()
    .setTitle(`${type.emoji ? `${type.emoji} ` : ""}${type.label} Ticket Opened`)
    .setDescription(
      [
        `**Opened by:** <@${opener.id}>`,
        `**Ticket:** **${originalName}**`,
        `**Status:** Unclaimed`,
        "",
        "Type your details below. A staff member will claim this shortly.",
      ].join("\n")
    )
    .setColor(typeColor(typeKey));

  // ✅ Ping role + opener
  const pingText = [pingRole ? `<@&${pingRole.id}>` : null, `<@${opener.id}>`].filter(Boolean).join(" ");

  await channel.send({ content: pingText, embeds: [openEmbed] });

  // ✅ Make it easy to jump (Discord won’t auto-switch channels, but link button = instant)
  const jumpRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Go to your ticket").setURL(channel.url)
  );

  return respondEphemeral(interaction, {
    content: `✅ Ticket created: ${channel}`,
    components: [jumpRow],
  });
}

// -----------------------------
// CLAIM (locks staff talking after claim)
// -----------------------------
async function claimTicket(interaction) {
  const channel = interaction.channel;
  if (!isTicketChannel(channel)) return respondEphemeral(interaction, { content: "❌ Use inside a ticket." });

  const meta = parseTicketTopic(channel.topic);
  const typeKey = meta.typeKey || normalizeTypeKey(channel.name.split("-")[0]);
  const type = cfg.TYPES[typeKey];
  if (!type) return respondEphemeral(interaction, { content: "❌ Could not determine ticket type." });

  if (!canClaimType(interaction.member, typeKey)) {
    return respondEphemeral(interaction, { content: "❌ You can’t claim this ticket type." });
  }

  if (meta.claimerId && meta.claimerId !== interaction.user.id) {
    return respondEphemeral(interaction, { content: "❌ Already claimed by someone else." });
  }

  // ✅ Rebuild overwrites so staff becomes VIEW ONLY after claim
  await channel.permissionOverwrites.set(
    buildTicketPermissions(interaction.guild, typeKey, meta.openerId || interaction.user.id, interaction.user.id)
  );

  // rename to claimerUsername-##
  const num = parseTicketNumberFromName(meta.originalName || channel.name) || "01";
  await channel.setName(`${interaction.user.username}-${num}`).catch(() => {});

  // update topic
  await channel
    .setTopic(
      buildTicketTopicLines({
        typeLabel: meta.typeLabel || type.label,
        openerTag: meta.openerTag || `Unknown (${meta.openerId || "unknown"})`,
        claimedTag: safeUserTag(interaction.user),
        typeKey,
        originalName: meta.originalName || channel.name,
      })
    )
    .catch(() => {});

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("Ticket Claimed ✅")
        .setDescription(`**Claimed by:** <@${interaction.user.id}>\n**Type:** ${type.label}`)
        .setColor(typeColor(typeKey)),
    ],
  });

  if (typeof logModerationAction === "function") {
    await logModerationAction(interaction.guild, {
      action: "TICKET_CLAIM",
      moderatorId: interaction.user.id,
      targetId: meta.openerId || "unknown",
      reason: `${typeKey} ticket claimed in #${channel.name}`,
    }).catch(() => {});
  }

  return respondEphemeral(interaction, { content: "✅ Ticket claimed." });
}

// -----------------------------
// CLOSE PROMPT (deduped)
// -----------------------------
async function promptClose(interaction) {
  const channel = interaction.channel;
  if (!isTicketChannel(channel)) return respondEphemeral(interaction, { content: "❌ Use inside a ticket." });

  const meta = parseTicketTopic(channel.topic);
  if (!meta.openerId) return respondEphemeral(interaction, { content: "❌ Opener not found in topic." });

  // Dedupe: don’t spam close prompts
  try {
    const recent = await channel.messages.fetch({ limit: 25 });
    const already = recent.find((m) => {
      if (!m.author?.bot) return false;
      if (!m.components?.length) return false;
      return m.components.some((row) =>
        row.components?.some((c) => String(c.customId || "").startsWith("ticket:closeyes:"))
      );
    });
    if (already) return respondEphemeral(interaction, { content: "✅ Close prompt already sent in this ticket." });
  } catch {}

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:closeyes:${channel.id}:${meta.openerId}`)
      .setLabel("YES (close)")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`ticket:closeno:${channel.id}:${meta.openerId}`)
      .setLabel("NO (still need help)")
      .setStyle(ButtonStyle.Secondary)
  );

  await channel.send({
    content: `<@${meta.openerId}>, has your issue been resolved?\n\n- Click **YES** to close.\n- Click **NO** and explain what you still need.`,
    components: [row],
  });

  return respondEphemeral(interaction, { content: "✅ Close prompt sent." });
}

// -----------------------------
// Transcript + Logs
// -----------------------------
async function buildTranscriptText(channel) {
  const out = [];
  out.push(`Transcript for #${channel.name} (${channel.id})`);
  out.push(`Created: ${new Date(channel.createdTimestamp || Date.now()).toISOString()}`);
  out.push("");

  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!messages) return out.join("\n");

  const ordered = Array.from(messages.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  for (const m of ordered) {
    const author = m.author ? safeUserTag(m.author) : "Unknown";
    const time = new Date(m.createdTimestamp).toISOString();
    out.push(`[${time}] ${author}: ${m.content || ""}`);
    for (const a of m.attachments.values()) out.push(`  [attachment] ${a.url}`);
  }

  return out.join("\n");
}

async function sendTranscriptToLogs(guild, typeKey, channel, meta, transcriptTxt, reason) {
  const logChannelId = getLogChannelIdForType(typeKey);
  const logChannel = logChannelId ? await guild.channels.fetch(logChannelId).catch(() => null) : null;
  if (!logChannel) return false;

  const file = new AttachmentBuilder(Buffer.from(transcriptTxt, "utf8"), {
    name: `${(meta.originalName || channel.name)}-transcript.txt`,
  });

  const embed = new EmbedBuilder()
    .setTitle("Ticket Closed")
    .setDescription(
      [
        `**Ticket:** **${meta.originalName || channel.name}**`,
        `**Type:** ${typeKey}`,
        `**Opened by:** ${meta.openerId ? `<@${meta.openerId}>` : meta.openerTag || "Unknown"}`,
        `**Claimed by:** ${meta.claimerId ? `<@${meta.claimerId}>` : meta.claimedTag || "Unclaimed"}`,
        `**Reason:** ${reason}`,
      ].join("\n")
    )
    .setColor(typeColor(typeKey));

  await logChannel.send({ embeds: [embed], files: [file] });
  return true;
}

// -----------------------------
// FORCE CLOSE (always ACK fast)
// -----------------------------
async function forceCloseTicket(interaction, reason = "No reason provided") {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }
  } catch {}

  const channel = interaction.channel;
  if (!isTicketChannel(channel)) {
    await respondEphemeral(interaction, { content: "❌ Use inside a ticket." });
    return;
  }

  const meta = parseTicketTopic(channel.topic);
  const typeKey = meta.typeKey || normalizeTypeKey(channel.name.split("-")[0]);

  // Permission: claimer OR admin/reviewer
  const r = cfg.ROLES;
  const isAdmin = memberHasRole(interaction.member, r.admin);
  const isReviewer = memberHasRole(interaction.member, r.reviewer);
  const isClaimer = meta.claimerId && meta.claimerId === interaction.user.id;

  if (!(isClaimer || isAdmin || isReviewer)) {
    await interaction.editReply({ content: "❌ Only claimer (or Admin/Reviewer) can force close." }).catch(() => {});
    return;
  }

  const transcriptTxt = await buildTranscriptText(channel);
  const logged = await sendTranscriptToLogs(interaction.guild, typeKey, channel, meta, transcriptTxt, reason);

  if (meta.openerId) await clearUserOpen(interaction.guild, meta.openerId);

  await interaction
    .editReply({
      content: logged
        ? "✅ Closing ticket… transcript logged."
        : "✅ Closing ticket… (⚠️ No log channel configured/found).",
    })
    .catch(() => {});

  try {
    await channel.delete(`Ticket closed by ${interaction.user.id}: ${reason}`);
  } catch (e) {
    console.error("[TICKETS] Delete failed:", e);
    await interaction
      .editReply({
        content:
          "❌ Transcript logged, but I **could not delete the channel**. Ensure bot role is ABOVE any ticket roles and has Manage Channels (Administrator usually covers this).",
      })
      .catch(() => {});
  }
}

// -----------------------------
// ADD USER
// -----------------------------
async function addUserToTicket(interaction, user, reason = "No reason provided") {
  const channel = interaction.channel;
  if (!isTicketChannel(channel)) return respondEphemeral(interaction, { content: "❌ Use inside a ticket." });

  const meta = parseTicketTopic(channel.topic);

  const r = cfg.ROLES;
  const isAdmin = memberHasRole(interaction.member, r.admin);
  const isReviewer = memberHasRole(interaction.member, r.reviewer);
  const isClaimer = meta.claimerId && meta.claimerId === interaction.user.id;

  if (!(isClaimer || isAdmin || isReviewer)) {
    return respondEphemeral(interaction, { content: "❌ Only claimer (or Admin/Reviewer) can add users." });
  }

  await channel.permissionOverwrites.edit(user.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
    EmbedLinks: true,
    UseApplicationCommands: true,
  });

  await channel.send(`✅ Added <@${user.id}> to this ticket.\n**Reason:** ${reason}`);
  return respondEphemeral(interaction, { content: "✅ User added." });
}

// -----------------------------
// Close buttons (opener YES/NO)
// -----------------------------
async function handleTicketControlButton(interaction) {
  const id = interaction.customId || "";
  if (!(id.startsWith("ticket:closeyes:") || id.startsWith("ticket:closeno:"))) return false;

  const parts = id.split(":");
  const action = parts[1];
  const channelId = parts[2];
  const openerId = parts[3];

  if (interaction.channelId !== channelId) {
    await respondEphemeral(interaction, { content: "❌ Wrong channel." });
    return true;
  }
  if (interaction.user.id !== openerId) {
    await respondEphemeral(interaction, { content: "❌ Only the opener can answer this." });
    return true;
  }

  if (action === "closeno") {
    await interaction.update({ content: "✅ Okay — please type what you still need help with.", components: [] }).catch(() => {});
    const meta = parseTicketTopic(interaction.channel.topic);
    if (meta.claimerId) await interaction.channel.send(`<@${meta.claimerId}>, opener still needs help.`).catch(() => {});
    return true;
  }

  // YES
  await interaction.update({ content: "✅ Closing ticket…", components: [] }).catch(() => {});
  const channel = interaction.channel;
  const meta = parseTicketTopic(channel.topic);
  const typeKey = meta.typeKey || normalizeTypeKey(channel.name.split("-")[0]);

  const transcriptTxt = await buildTranscriptText(channel);
  await sendTranscriptToLogs(interaction.guild, typeKey, channel, meta, transcriptTxt, "Resolved (opener confirmed YES)");

  if (meta.openerId) await clearUserOpen(interaction.guild, meta.openerId);

  try {
    await channel.delete("Ticket closed by opener (YES)");
  } catch (e) {
    console.error("[TICKETS] Delete failed:", e);
    await channel.send("❌ Transcript logged, but I **can’t delete this channel**.").catch(() => {});
  }

  return true;
}

// -----------------------------
// Speak enforcement
// - If unclaimed: opener OR allowed staff tier can speak
// - If claimed: opener OR claimer OR explicitly added users can speak
// -----------------------------
async function enforceTicketSpeak(message) {
  const channel = message.channel;
  if (!isTicketChannel(channel)) return false;

  const meta = parseTicketTopic(channel.topic);
  const typeKey = meta.typeKey || normalizeTypeKey(channel.name.split("-")[0]);

  if (message.author.bot) return true;

  // opener always ok
  if (meta.openerId && message.author.id === meta.openerId) return true;

  // claimed: only claimer (and added users will pass because they won't be denied at overwrite-level)
  if (meta.claimerId) {
    if (message.author.id === meta.claimerId) return true;
    await message.delete().catch(() => {});
    await channel
      .send({ content: `❌ <@${message.author.id}>, only the **opener** and **claimer** can type here.` })
      .then((m) => setTimeout(() => m.delete().catch(() => {}), 6000))
      .catch(() => {});
    return true;
  }

  // unclaimed: allow staff tier roles for this type
  const allowedRoleIds = getViewerRolesForType(typeKey);
  const member = message.member;
  const isStaffAllowed = allowedRoleIds.some((rid) => member?.roles?.cache?.has(rid));

  if (isStaffAllowed) return true;

  // otherwise block
  await message.delete().catch(() => {});
  await channel
    .send({ content: `❌ <@${message.author.id}>, only the **opener** and **assigned staff** can type here.` })
    .then((m) => setTimeout(() => m.delete().catch(() => {}), 6000))
    .catch(() => {});
  return true;
}

module.exports = {
  normalizeTypeKey,
  getType,
  buildPanelEmbed,
  buildPanelRow,
  postPanel,
  createTicketChannel,
  claimTicket,
  promptClose,
  forceCloseTicket,
  addUserToTicket,
  handleTicketControlButton,
  enforceTicketSpeak,
};