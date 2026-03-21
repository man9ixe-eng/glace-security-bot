// src/config/tickets.js
"use strict";

// Glace Security Bot — Ticket System Config
function env(name, required = true) {
  const val = process.env[name];
  if (!val && required) {
    throw new Error(`[TICKETS CONFIG] Missing required env var: ${name}`);
  }
  return val || null;
}

module.exports = {
  // ===== Core =====
  SUPPORT_CATEGORY_ID: env("SUPPORT_CATEGORY_ID"),
  TICKET_COUNTER_CHANNEL_ID: env("TICKET_COUNTER_CHANNEL_ID"),

  // ===== Panel Channels =====
  PANELS: {
    corporate: env("TICKET_PANEL_CORPORATE_CHANNEL_ID"),
    ingame: env("TICKET_PANEL_INGAME_CHANNEL_ID"),
    kick: env("TICKET_PANEL_KICK_CHANNEL_ID"),
    ban: env("TICKET_PANEL_BAN_CHANNEL_ID"),
    pban: env("TICKET_PANEL_PBAN_CHANNEL_ID"),
  },

  // ===== Staff Roles =====
  ROLES: {
    trial: env("TICKET_ROLE_TRIAL_ID"),
    mod: env("TICKET_ROLE_MOD_ID"),
    admin: env("TICKET_ROLE_ADMIN_ID"),
    reviewer: env("TICKET_ROLE_REVIEWER_ID"),
  },

  // ===== Transcript Log Channels =====
  LOGS: {
    corporate_pban: env("TICKET_LOG_CORPORATE_PBAN_CHANNEL_ID"),
    ingame: env("TICKET_LOG_INGAME_CHANNEL_ID"),
    kick: env("TICKET_LOG_KICK_CHANNEL_ID"),
    ban: env("TICKET_LOG_BAN_CHANNEL_ID"),
  },

  // ===== Ticket Types =====
  // NOTE: theme.color can be number (0xRRGGBB) or "#RRGGBB"
  TYPES: {
    corporate: {
      emoji: "⚪",
      label: "Corporate Assistance",
      prefix: "corporate-",
      pingRole: "reviewer",
      log: "corporate_pban",
      theme: { color: 0xffffff },
      panelTitle: "Corporate Assistance",
      panelBody: [
        "Need corporate support? React/click below to start a case.",
        "",
        "**How it works**",
        "1) Click **Open Ticket**",
        "2) A private channel will be created",
        "3) Send your details when the ticket opens",
        "4) Case closes once resolved",
      ].join("\n"),
      buttonLabel: "Open Ticket",
    },

    kick: {
      emoji: "🟡",
      label: "Kick Request",
      prefix: "kick-",
      pingRole: "mod",
      log: "kick",
      theme: { color: 0xf1c40f },
      panelTitle: "Kick Request",
      panelBody: [
        "Need a kick handled? React/click below to start a case.",
        "",
        "**How it works**",
        "1) Click **Open Ticket**",
        "2) A private channel will be created",
        "3) Provide username + proof + reason",
        "4) Case closes once resolved",
      ].join("\n"),
      buttonLabel: "Open Ticket",
    },

    ban: {
      emoji: "🟠",
      label: "Ban Request",
      prefix: "ban-",
      pingRole: "admin",
      log: "ban",
      theme: { color: 0xe67e22 },
      panelTitle: "Ban Request",
      panelBody: [
        "Need a ban handled? React/click below to start a case.",
        "",
        "**How it works**",
        "1) Click **Open Ticket**",
        "2) A private channel will be created",
        "3) Provide username + proof + ban reason",
        "4) Case closes once resolved",
      ].join("\n"),
      buttonLabel: "Open Ticket",
    },

    pban: {
      emoji: "🔴",
      label: "PBAN Request",
      prefix: "pban-",
      pingRole: "reviewer",
      log: "corporate_pban",
      theme: { color: 0xe74c3c },
      panelTitle: "PBAN Request",
      panelBody: [
        "Need a PBAN handled? React/click below to start a case.",
        "",
        "**How it works**",
        "1) Click **Open Ticket**",
        "2) A private channel will be created",
        "3) Provide full evidence bundle + context",
        "4) Case closes once resolved",
      ].join("\n"),
      buttonLabel: "Open Ticket",
    },

    ingame: {
      emoji: "🔵",
      label: "In-Game Assistance",
      prefix: "in-game-",
      pingRole: "trial",
      log: "ingame",
      theme: { color: 0x3aa6ff },
      panelTitle: "In-Game Assistance",
      panelBody: [
        "Need help in-game? React/click below to start a case.",
        "",
        "**How it works**",
        "1) Click **Open Ticket**",
        "2) A private channel will be created",
        "3) Tell us what’s happening + where you are",
        "4) Case closes once resolved",
      ].join("\n"),
      buttonLabel: "Open Ticket",
    },
  },
};