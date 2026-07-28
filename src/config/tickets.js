'use strict';

function env(name) {
  const value = String(process.env[name] || '').trim();
  return value || null;
}

const SHARED_PANEL_CHANNEL_ID = env('TICKET_PANEL_CHANNEL_ID');
const SHARED_LOG_CHANNEL_ID = env('TICKET_LOG_CHANNEL_ID') || env('OPERATIONS_LOG_CHANNEL_ID');

module.exports = {
  // Only needed when the ticket system is used. Missing values no longer crash the entire bot.
  SUPPORT_CATEGORY_ID: env('SUPPORT_CATEGORY_ID'),

  // Legacy value kept for compatibility. Ticket counters now live in the persistent DATA_DIR store.
  TICKET_COUNTER_CHANNEL_ID: env('TICKET_COUNTER_CHANNEL_ID'),

  PANELS: {
    corporate: env('TICKET_PANEL_CORPORATE_CHANNEL_ID') || SHARED_PANEL_CHANNEL_ID,
    ingame: env('TICKET_PANEL_INGAME_CHANNEL_ID') || SHARED_PANEL_CHANNEL_ID,
    kick: env('TICKET_PANEL_KICK_CHANNEL_ID') || SHARED_PANEL_CHANNEL_ID,
    ban: env('TICKET_PANEL_BAN_CHANNEL_ID') || SHARED_PANEL_CHANNEL_ID,
    pban: env('TICKET_PANEL_PBAN_CHANNEL_ID') || SHARED_PANEL_CHANNEL_ID,
  },

  ROLES: {
    trial: env('TICKET_ROLE_TRIAL_ID'),
    mod: env('TICKET_ROLE_MOD_ID'),
    admin: env('TICKET_ROLE_ADMIN_ID'),
    reviewer: env('TICKET_ROLE_REVIEWER_ID'),
  },

  // One TICKET_LOG_CHANNEL_ID can replace all of the old ticket log channels.
  LOGS: {
    corporate_pban: env('TICKET_LOG_CORPORATE_PBAN_CHANNEL_ID') || SHARED_LOG_CHANNEL_ID,
    ingame: env('TICKET_LOG_INGAME_CHANNEL_ID') || SHARED_LOG_CHANNEL_ID,
    kick: env('TICKET_LOG_KICK_CHANNEL_ID') || SHARED_LOG_CHANNEL_ID,
    ban: env('TICKET_LOG_BAN_CHANNEL_ID') || SHARED_LOG_CHANNEL_ID,
  },

  TYPES: {
    corporate: {
      emoji: '⚪', label: 'Corporate Assistance', prefix: 'corporate-', pingRole: 'reviewer', log: 'corporate_pban',
      theme: { color: 0xffffff }, panelTitle: 'Corporate Assistance',
      panelBody: ['Need corporate support? Click below to start a private case.', '', '**How it works**', '1) Click **Open Ticket**', '2) A private channel is created', '3) Send the details and evidence', '4) The case closes once resolved'].join('\n'),
      buttonLabel: 'Open Ticket',
    },
    kick: {
      emoji: '🟡', label: 'Kick Request', prefix: 'kick-', pingRole: 'mod', log: 'kick',
      theme: { color: 0xf1c40f }, panelTitle: 'Kick Request',
      panelBody: ['Need a kick handled? Click below to start a private case.', '', 'Provide the username, proof, and reason when the ticket opens.'].join('\n'),
      buttonLabel: 'Open Ticket',
    },
    ban: {
      emoji: '🟠', label: 'Ban Request', prefix: 'ban-', pingRole: 'admin', log: 'ban',
      theme: { color: 0xe67e22 }, panelTitle: 'Ban Request',
      panelBody: ['Need a ban handled? Click below to start a private case.', '', 'Provide the username, proof, and ban reason when the ticket opens.'].join('\n'),
      buttonLabel: 'Open Ticket',
    },
    pban: {
      emoji: '🔴', label: 'PBAN Request', prefix: 'pban-', pingRole: 'reviewer', log: 'corporate_pban',
      theme: { color: 0xe74c3c }, panelTitle: 'PBAN Request',
      panelBody: ['Need a PBAN handled? Click below to start a private case.', '', 'Provide the full evidence bundle and context when the ticket opens.'].join('\n'),
      buttonLabel: 'Open Ticket',
    },
    ingame: {
      emoji: '🔵', label: 'In-Game Assistance', prefix: 'in-game-', pingRole: 'trial', log: 'ingame',
      theme: { color: 0x3aa6ff }, panelTitle: 'In-Game Assistance',
      panelBody: ['Need help in-game? Click below to start a private case.', '', 'Tell staff what is happening and where you are.'].join('\n'),
      buttonLabel: 'Open Ticket',
    },
  },
};
