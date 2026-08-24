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
function getTicketConfigMissing() {
  const missing = [];
  if (!cfg.SUPPORT_CATEGORY_ID) missing.push('SUPPORT_CATEGORY_ID');
  if (!cfg.ROLES?.trial) missing.push('TICKET_ROLE_TRIAL_ID');
  if (!cfg.ROLES?.mod) missing.push('TICKET_ROLE_MOD_ID');
  if (!cfg.ROLES?.admin) missing.push('TICKET_ROLE_ADMIN_ID');
  if (!cfg.ROLES?.reviewer) missing.push('TICKET_ROLE_REVIEWER_ID');
  return missing;
}

function ticketSystemReady() {
  return getTicketConfigMissing().length === 0;
}

async function requireTicketSystem(interaction) {
  const missing = getTicketConfigMissing();
  if (!missing.length) return true;
  await respondEphemeral(interaction, {
    content: `\u274C The ticket system is not configured yet. Missing: ${missing.join(', ')}.`,
  });
  return false;
}

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
    PermissionsBitField.Flags.UseApplicationCommands, // \u2705
  ];

  const staffView = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.UseApplicationCommands, // \u2705
  ];

  const staffTalk = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.AttachFiles,
    PermissionsBitField.Flags.EmbedLinks,
    PermissionsBitField.Flags.UseApplicationCommands, // \u2705
  ];

  const claimerAllow = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.AttachFiles,
    PermissionsBitField.Flags.EmbedLinks,
    PermissionsBitField.Flags.UseApplicationCommands, // \u2705
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
  if (!await requireTicketSystem(interaction)) return null;
  const embed = buildPanelEmbed(typeKeyRaw);
  const row = buildPanelRow(typeKeyRaw);
  if (!embed || !row) return respondEphemeral(interaction, { content: "\u274C Invalid ticket type." });

  await interaction.channel.send({ embeds: [embed], components: [row] });
  return respondEphemeral(interaction, { content: "\u2705 Panel posted." });
}

// -----------------------------
// CREATE
// -----------------------------
async function createTicketChannel(interaction, typeKeyRaw) {
  if (!await requireTicketSystem(interaction)) return null;
  const { typeKey, type } = getType(typeKeyRaw);
  if (!type) return respondEphemeral(interaction, { content: "\u274C Unknown ticket type." });

  const guild = interaction.guild;
  const opener = interaction.user;

  const supportCategory = guild.channels.cache.get(cfg.SUPPORT_CATEGORY_ID);
  if (!supportCategory) {
    return respondEphemeral(interaction, { content: "\u274C SUPPORT_CATEGORY_ID invalid or bot cannot access it." });
  }

  const result = await getNextNumberAndBump(guild, typeKey, opener.id);
  if (result.blocked) {
    return respondEphemeral(interaction, { content: `\u274C You already have an open ticket: <#${result.channelId}>` });
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

  // \u2705 Ping role + opener
  const pingText = [pingRole ? `<@&${pingRole.id}>` : null, `<@${opener.id}>`].filter(Boolean).join(" ");

  await channel.send({ content: pingText, embeds: [openEmbed] });

  // \u2705 Make it easy to jump (Discord won\u2019t auto-switch channels, but link button = instant)
  const jumpRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Go to your ticket").setURL(channel.url)
  );

  return respondEphemeral(interaction, {
    content: `\u2705 Ticket created: ${channel}`,
    components: [jumpRow],
  });
}

// -----------------------------
// CLAIM (locks staff talking after claim)
// -----------------------------
async function claimTicket(interaction) {
  if (!await requireTicketSystem(interaction)) return null;
  const channel = interaction.channel;
  if (!isTicketChannel(channel)) return respondEphemeral(interaction, { content: "\u274C Use inside a ticket." });

  const meta = parseTicketTopic(channel.topic);
  const typeKey = meta.typeKey || normalizeTypeKey(channel.name.split("-")[0]);
  const type = cfg.TYPES[typeKey];
  if (!type) return respondEphemeral(interaction, { content: "\u274C Could not determine ticket type." });

  if (!canClaimType(interaction.member, typeKey)) {
    return respondEphemeral(interaction, { content: "\u274C You can\u2019t claim this ticket type." });
  }

  if (meta.claimerId && meta.claimerId !== interaction.user.id) {
    return respondEphemeral(interaction, { content: "\u274C Already claimed by someone else." });
  }

  // \u2705 Rebuild overwrites so staff becomes VIEW ONLY after claim
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
        .setTitle("Ticket Claimed \u2705")
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

  return respondEphemeral(interaction, { content: "\u2705 Ticket claimed." });
}

// -----------------------------
// CLOSE PROMPT (deduped)
// -----------------------------
async function promptClose(interaction) {
  if (!await requireTicketSystem(interaction)) return null;
  const channel = interaction.channel;
  if (!isTicketChannel(channel)) return respondEphemeral(interaction, { content: "\u274C Use inside a ticket." });

  const meta = parseTicketTopic(channel.topic);
  if (!meta.openerId) return respondEphemeral(interaction, { content: "\u274C Opener not found in topic." });

  // Dedupe: don\u2019t spam close prompts
  try {
    const recent = await channel.messages.fetch({ limit: 25 });
    const already = recent.find((m) => {
      if (!m.author?.bot) return false;
      if (!m.components?.length) return false;
      return m.components.some((row) =>
        row.components?.some((c) => String(c.customId || "").startsWith("ticket:closeyes:"))
      );
    });
    if (already) return respondEphemeral(interaction, { content: "\u2705 Close prompt already sent in this ticket." });
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

  return respondEphemeral(interaction, { content: "\u2705 Close prompt sent." });
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
  if (!await requireTicketSystem(interaction)) return null;
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }
  } catch {}

  const channel = interaction.channel;
  if (!isTicketChannel(channel)) {
    await respondEphemeral(interaction, { content: "\u274C Use inside a ticket." });
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
    await interaction.editReply({ content: "\u274C Only claimer (or Admin/Reviewer) can force close." }).catch(() => {});
    return;
  }

  const transcriptTxt = await buildTranscriptText(channel);
  const logged = await sendTranscriptToLogs(interaction.guild, typeKey, channel, meta, transcriptTxt, reason);

  if (meta.openerId) await clearUserOpen(interaction.guild, meta.openerId);

  await interaction
    .editReply({
      content: logged
        ? "\u2705 Closing ticket\u2026 transcript logged."
        : "\u2705 Closing ticket\u2026 (\u26A0\uFE0F No log channel configured/found).",
    })
    .catch(() => {});

  try {
    await channel.delete(`Ticket closed by ${interaction.user.id}: ${reason}`);
  } catch (e) {
    console.error("[TICKETS] Delete failed:", e);
    await interaction
      .editReply({
        content:
          "\u274C Transcript logged, but I **could not delete the channel**. Ensure bot role is ABOVE any ticket roles and has Manage Channels (Administrator usually covers this).",
      })
      .catch(() => {});
  }
}

// -----------------------------
// ADD USER
// -----------------------------
async function addUserToTicket(interaction, user, reason = "No reason provided") {
  if (!await requireTicketSystem(interaction)) return null;
  const channel = interaction.channel;
  if (!isTicketChannel(channel)) return respondEphemeral(interaction, { content: "\u274C Use inside a ticket." });

  const meta = parseTicketTopic(channel.topic);

  const r = cfg.ROLES;
  const isAdmin = memberHasRole(interaction.member, r.admin);
  const isReviewer = memberHasRole(interaction.member, r.reviewer);
  const isClaimer = meta.claimerId && meta.claimerId === interaction.user.id;

  if (!(isClaimer || isAdmin || isReviewer)) {
    return respondEphemeral(interaction, { content: "\u274C Only claimer (or Admin/Reviewer) can add users." });
  }

  await channel.permissionOverwrites.edit(user.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    AttachFiles: true,
    EmbedLinks: true,
    UseApplicationCommands: true,
  });

  await channel.send(`\u2705 Added <@${user.id}> to this ticket.\n**Reason:** ${reason}`);
  return respondEphemeral(interaction, { content: "\u2705 User added." });
}

// -----------------------------
// Close buttons (opener YES/NO)
// -----------------------------
async function handleTicketControlButton(interaction) {
  if (!await requireTicketSystem(interaction)) return false;
  const id = interaction.customId || "";
  if (!(id.startsWith("ticket:closeyes:") || id.startsWith("ticket:closeno:"))) return false;

  const parts = id.split(":");
  const action = parts[1];
  const channelId = parts[2];
  const openerId = parts[3];

  if (interaction.channelId !== channelId) {
    await respondEphemeral(interaction, { content: "\u274C Wrong channel." });
    return true;
  }
  if (interaction.user.id !== openerId) {
    await respondEphemeral(interaction, { content: "\u274C Only the opener can answer this." });
    return true;
  }

  if (action === "closeno") {
    await interaction.update({ content: "\u2705 Okay \u2014 please type what you still need help with.", components: [] }).catch(() => {});
    const meta = parseTicketTopic(interaction.channel.topic);
    if (meta.claimerId) await interaction.channel.send(`<@${meta.claimerId}>, opener still needs help.`).catch(() => {});
    return true;
  }

  // YES
  await interaction.update({ content: "\u2705 Closing ticket\u2026", components: [] }).catch(() => {});
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
    await channel.send("\u274C Transcript logged, but I **can\u2019t delete this channel**.").catch(() => {});
  }

  return true;
}

// -----------------------------
// Speak enforcement
// - If unclaimed: opener OR allowed staff tier can speak
// - If claimed: opener OR claimer OR explicitly added users can speak
// -----------------------------
async function enforceTicketSpeak(message) {
  if (!ticketSystemReady()) return false;
  const channel = message.channel;
  if (!isTicketChannel(channel)) return false;
  const meta = parseTicketTopic(channel.topic);
  const typeKey = meta.typeKey || normalizeTypeKey(channel.name.split("-")[0]);

  if (message.author.bot) return true;

  // Opener always has permission to speak.
  if (meta.openerId && message.author.id === meta.openerId) return true;

  // Claimed tickets: opener + claimer + users explicitly added with /adduser.
  if (meta.claimerId) {
    if (message.author.id === meta.claimerId) return true;

    // /adduser gives the member a direct channel overwrite with SendMessages allowed.
    // Respect that member-specific permission instead of deleting their message.
    const directOverwrite = channel.permissionOverwrites.cache.get(message.author.id);
    const explicitlyAdded =
      directOverwrite?.allow?.has(PermissionsBitField.Flags.SendMessages) || false;

    if (explicitlyAdded) return true;

    await message.delete().catch(() => {});
    await message.author
      .send(
        "\u274C You cannot chat in that claimed ticket unless you are the opener, "
        + "the claimer, or were explicitly added to the ticket."
      )
      .catch(() => {});
    return true;
  }

  // Unclaimed tickets: assigned staff tiers may speak.
  const allowedRoleIds = getViewerRolesForType(typeKey);
  const member = message.member;
  const isStaffAllowed = allowedRoleIds.some(
    (roleId) => member?.roles?.cache?.has(roleId)
  );

  if (isStaffAllowed) return true;

  await message.delete().catch(() => {});
  await message.author
    .send(
      "\u274C You cannot chat in that unclaimed ticket unless you are "
      + "the opener or assigned staff for that ticket type."
    )
    .catch(() => {});
  return true;
}
module.exports = {
  ticketSystemReady,
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
