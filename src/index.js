// src/index.js
'use strict';

require('dotenv').config();

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Partials, Collection, Events } = require('discord.js');

const { handleMessageAutomod } = require('./utils/automod');
const { runSessionAnnouncementTick } = require('./utils/sessionAnnouncements');
const { handleQueueButtonInteraction } = require('./utils/sessionQueueManager');
const { handleEditActivityReply } = require('./utils/editActivityManager');
const { runWeeklyMaintenance } = require('./utils/activityTracker');
const ticketSystem = require('./utils/ticketSystem');
const PriorityStore = require('./utils/priorityStore');
const { enforceCommandAccess, denyAccess } = require('./utils/commandAccess');
const { auditCommand } = require('./utils/operationsAudit');
const { getConfigurationReport, logConfigurationReport } = require('./utils/configValidation');
const { handleOpsWebRequest } = require('./web/opsPortal');
const { handleStaffRequestInteraction } = require('./utils/staffRequestSystem');
const { handlePromotionInteraction } = require('./utils/promotionDiscord');
const { ensureReviewOnCallPanel, handleReviewOnCallInteraction } = require('./utils/reviewOnCallPanel');
const { handleStaffJourneyInteraction, startStaffJourneyAutomation, stopStaffJourneyAutomation } = require('./utils/staffJourneySystem');
const { startSupabaseHeartbeat } = require('./utils/supabaseHeartbeat');
const {
  syncStaffRoles,
  ensureGlaceFamily,
  scheduleGlaceFamily,
  cancelFamilyTimer,
  reconcileAllGuilds,
  clearRoleSyncTimers,
} = require('./utils/roleSync');

let banAppeals = null;
try {
  banAppeals = require('./utils/banAppeals');
} catch (error) {
  console.error('[BAN APPEALS] System disabled because it could not load:', error);
}

let handleJuniorActivityLogMessage = null;
try {
  ({ handleJuniorActivityLogMessage } = require('./utils/juniorActivityTracker'));
} catch (error) {
  console.warn('[JUNIOR ACTIVITY] Live tracking disabled:', error.message || error);
}

// ===========================
// DISCORD CLIENT
// ===========================
const ENABLE_MESSAGE_CONTENT = String(process.env.ENABLE_MESSAGE_CONTENT || 'true').toLowerCase() === 'true';
const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.DirectMessages,
];
if (ENABLE_MESSAGE_CONTENT) intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);

const client = new Client({
  intents,
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});
client.commands = new Collection();

// ===========================
// HTTP / STAFF OPERATIONS SITE
// ===========================
const PORT = Number(process.env.PORT || 3000);
const server = http.createServer(async (req, res) => {
  try {
    if (await handleOpsWebRequest(req, res, client)) return;

    if (req.url?.startsWith('/appeal') && banAppeals?.handleAppealWebRequest) {
      return await banAppeals.handleAppealWebRequest(req, res, client);
    }

    if (req.url === '/health' || req.url === '/healthz') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify({
        ok: true,
        service: 'glace-security-bot',
        discordReady: client.isReady(),
        guilds: client.guilds.cache.size,
        uptimeSeconds: Math.floor(process.uptime()),
        configuration: getConfigurationReport(),
        timestamp: new Date().toISOString(),
      }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Glace Security Bot is running.\nHealth: /health\nGlace Staff Hub: /ops\nBan appeals: /appeal\n');
  } catch (error) {
    console.error('[HTTP] Request error:', error);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Something went wrong.\n');
  }
});
server.listen(PORT, () => console.log(`[HTTP] Listening on port ${PORT}`));

// ===========================
// PRIORITY STORE
// ===========================
try {
  const priorityStore = new PriorityStore(process.env.PRIORITY_STORE_PATH);
  priorityStore.load();
  client.priorityStore = priorityStore;
  console.log('[PRIORITY] Store loaded.');
} catch (error) {
  console.error('[PRIORITY] Store disabled:', error);
  client.priorityStore = {
    load: () => {}, saveNow: () => {}, recordAttendance: () => {},
    getLastAttendedAt: () => 0, getAttendedCount: () => 0,
  };
}

// ===========================
// COMMAND LOADER
// ===========================
const commandsPathRoot = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPathRoot)) {
  for (const folder of fs.readdirSync(commandsPathRoot)) {
    const commandsPath = path.join(commandsPathRoot, folder);
    if (!fs.statSync(commandsPath).isDirectory()) continue;

    for (const file of fs.readdirSync(commandsPath).filter((name) => name.endsWith('.js'))) {
      const filePath = path.join(commandsPath, file);
      try {
        delete require.cache[require.resolve(filePath)];
        const command = require(filePath);
        if (command?.data && typeof command.execute === 'function') {
          client.commands.set(command.data.name, command);
          console.log(`[COMMAND] Loaded /${command.data.name}`);
        } else {
          console.warn(`[COMMAND] Skipped ${filePath}: missing data or execute.`);
        }
      } catch (error) {
        // One optional system must never prevent the whole security bot from starting.
        console.error(`[COMMAND] Failed to load ${filePath}:`, error);
      }
    }
  }
}

async function ensureRuntimeSlashCommands(readyClient) {
  const guildId = String(process.env.GUILD_ID || '').trim();
  const guild = guildId
    ? (readyClient.guilds.cache.get(guildId) || await readyClient.guilds.fetch(guildId).catch(() => null))
    : null;
  if (!guild) {
    console.warn('[COMMAND SYNC] GUILD_ID was not available; runtime command sync was skipped.');
    return;
  }

  const commandNames = [
    'addsession', 'editcard', 'manualjuniorlog',
    'enroll', 'promote', 'resign', 'updateuser', 'demote', 'staffjourneypost', 'staffjourneytest',
  ];
  const retiredStaffJourneyNames = [
    'promotion', 'announce-promotion', 'changeuser', 'resignation', 'staff-journey', 'add-demotion', 'unenroll',
  ];

  try {
    const existing = await guild.commands.fetch();
    for (const retiredName of retiredStaffJourneyNames) {
      const oldCommand = existing.find((entry) => entry.name === retiredName);
      if (oldCommand) {
        await guild.commands.delete(oldCommand.id);
        console.log(`[COMMAND SYNC] Removed retired /${retiredName}.`);
      }
    }

    const refreshed = await guild.commands.fetch();
    for (const commandName of commandNames) {
      const command = readyClient.commands.get(commandName);
      if (!command?.data) continue;
      const payload = command.data.toJSON();
      const current = refreshed.find((entry) => entry.name === payload.name);
      if (current) {
        await guild.commands.edit(current.id, payload);
        console.log(`[COMMAND SYNC] Updated /${commandName}.`);
      } else {
        await guild.commands.create(payload);
        console.log(`[COMMAND SYNC] Created /${commandName}.`);
      }
    }
  } catch (error) {
    console.error('[COMMAND SYNC] Could not sync Staff Journey/session commands:', error);
  }
}

// ===========================
// READY / AUTOMATION
// ===========================
let stopSupabaseHeartbeat = null;

client.once(Events.ClientReady, async (readyClient) => {
  logConfigurationReport();
  try { await Promise.resolve(runWeeklyMaintenance()); } catch (error) { console.error('[ACTIVITY] Ready maintenance failed:', error); }
  if (banAppeals?.runBanAppealReminderTick) {
    banAppeals.runBanAppealReminderTick(readyClient).catch((error) => console.error('[BAN APPEALS] Ready tick failed:', error));
  }
  try { await ensureRuntimeSlashCommands(readyClient); } catch (error) { console.error('[COMMAND SYNC] Ready sync failed:', error); }
  try {
    await reconcileAllGuilds(readyClient, { includeFamilyScheduling: true });
  } catch (error) { console.error('[ROLE SYNC] Ready reconciliation failed:', error); }
  try {
    const panel = await ensureReviewOnCallPanel(readyClient);
    if (!panel.ok) console.warn('[REVIEW ON-CALL]', panel.reason);
  } catch (error) { console.error('[REVIEW ON-CALL] Panel setup failed:', error); }
  try { startStaffJourneyAutomation(readyClient); } catch (error) { console.error('[STAFF JOURNEY] Automation startup failed:', error); }
  try { if (!stopSupabaseHeartbeat) stopSupabaseHeartbeat = startSupabaseHeartbeat(); } catch (error) { console.error('[SUPABASE] Heartbeat startup failed:', error); }
  console.log(`[READY] Logged in as ${readyClient.user.tag} in ${readyClient.guilds.cache.size} guild(s).`);
});

client.on('shardReady', (id) => console.log(`[SHARD] Ready: ${id}`));
client.on('shardDisconnect', (event, id) => console.warn(`[SHARD] Disconnect ${id}:`, event?.code, event?.reason));
client.on('shardReconnecting', (id) => console.log(`[SHARD] Reconnecting: ${id}`));
client.on('shardResume', (id) => console.log(`[SHARD] Resumed: ${id}`));
client.on('shardError', (error, id) => console.error(`[SHARD] Error ${id}:`, error));
client.on('warn', (message) => console.warn('[DISCORD WARN]', message));
client.on('error', (error) => console.error('[DISCORD ERROR]', error));

if (String(process.env.ENABLE_DISCORD_DEBUG || 'false').toLowerCase() === 'true') {
  client.on('debug', (message) => {
    if (typeof message === 'string' && message.includes('Provided token')) return;
    console.log('[DISCORD DEBUG]', message);
  });
}

const intervals = [];
intervals.push(setInterval(async () => {
  try { await runSessionAnnouncementTick(client); }
  catch (error) { console.error('[AUTO] Session announcement failed:', error); }
}, 60_000));

intervals.push(setInterval(async () => {
  try { await Promise.resolve(runWeeklyMaintenance()); }
  catch (error) { console.error('[ACTIVITY] Weekly maintenance failed:', error); }
}, 60 * 60_000));

const ROLE_RECONCILE_INTERVAL_MS = Math.max(5 * 60_000, Number(process.env.ROLE_RECONCILE_INTERVAL_MS || 15 * 60_000));
intervals.push(setInterval(async () => {
  try { await reconcileAllGuilds(client, { includeFamilyScheduling: true }); }
  catch (error) { console.error('[ROLE SYNC] Periodic reconciliation failed:', error); }
}, ROLE_RECONCILE_INTERVAL_MS));

if (banAppeals?.runBanAppealReminderTick) {
  intervals.push(setInterval(async () => {
    try { await banAppeals.runBanAppealReminderTick(client); }
    catch (error) { console.error('[BAN APPEALS] Reminder tick failed:', error); }
  }, 10 * 60_000));
}

// ===========================
// MEMBER / ROLE AUTOMATION
// ===========================
client.on(Events.GuildMemberAdd, async (member) => {
  try {
    await syncStaffRoles(member, { reason: 'Glace automatic role sync after member join' });
  } catch (error) { console.error('[ROLE SYNC] Join staff-role sync failed:', error); }

  try {
    const familyResult = await ensureGlaceFamily(member);
    if (!familyResult.eligible) scheduleGlaceFamily(member);
  } catch (error) { console.error('[GLACE FAMILY] Join scheduling failed:', error); }
});

client.on(Events.GuildMemberUpdate, async (_oldMember, newMember) => {
  try {
    await syncStaffRoles(newMember, { reason: 'Bloxlink/rank change automatic team + ticket sync' });
  } catch (error) { console.error('[ROLE SYNC] Member-update staff-role sync failed:', error); }

  try {
    const familyResult = await ensureGlaceFamily(newMember);
    if (!familyResult.eligible) scheduleGlaceFamily(newMember);
  } catch (error) { console.error('[GLACE FAMILY] Member-update check failed:', error); }
});

client.on(Events.GuildMemberRemove, (member) => {
  try { cancelFamilyTimer(member.guild.id, member.id); } catch {}
});

// ===========================
// MESSAGES
// ===========================
if (ENABLE_MESSAGE_CONTENT) {
  client.on(Events.MessageCreate, async (message) => {
    if (handleJuniorActivityLogMessage) {
      try { await handleJuniorActivityLogMessage(message); }
      catch (error) { console.error('[JUNIOR ACTIVITY] Live log failed:', error); }
    }

    if (message.author?.bot) return;

    try {
      if (banAppeals?.handleAppealTicketMessage && await banAppeals.handleAppealTicketMessage(message)) return;
    } catch (error) { console.error('[BAN APPEALS] Ticket message failed:', error); }

    try { if (await handleEditActivityReply(message)) return; }
    catch (error) { console.error('[EDITACTIVITY] Reply handling failed:', error); }

    try { if (await ticketSystem.enforceTicketSpeak(message)) return; }
    catch (error) { console.error('[TICKETS] Speak enforcement failed:', error); }

    try { await handleMessageAutomod(message); }
    catch (error) { console.error('[AUTOMOD] Message processing failed:', error); }

    if (message.content === '!ping') message.reply('Pong!').catch(() => null);
  });
}

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    if (banAppeals?.handleBanAppealReaction) await banAppeals.handleBanAppealReaction(reaction, user);
  } catch (error) { console.error('[BAN APPEALS] Reaction handling failed:', error); }
});

// ===========================
// INTERACTIONS
// ===========================
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (banAppeals?.handleBanAppealInteraction && await banAppeals.handleBanAppealInteraction(interaction)) return;

    if (interaction.isButton() && await handleStaffJourneyInteraction(interaction)) return;

    if (interaction.isModalSubmit() && String(interaction.customId || '').startsWith('manualjuniorlog:')) {
      const manualJuniorLog = interaction.client.commands.get('manualjuniorlog');
      if (manualJuniorLog?.handleModalSubmit && await manualJuniorLog.handleModalSubmit(interaction)) return;
    }

    if (interaction.isButton() && await handleReviewOnCallInteraction(interaction)) return;
    if ((interaction.isButton() || interaction.isModalSubmit()) && await handleStaffRequestInteraction(interaction)) return;
    if ((interaction.isButton() || interaction.isModalSubmit()) && await handlePromotionInteraction(interaction)) return;

    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      const id = interaction.customId || '';
      if (interaction.isButton()) {
        if (id.startsWith('ticket:closeyes:') || id.startsWith('ticket:closeno:')) {
          if (await ticketSystem.handleTicketControlButton(interaction)) return;
        }
        if (id.startsWith('ticket:create:')) {
          await ticketSystem.createTicketChannel(interaction, id.split(':').slice(2).join(':'));
          return;
        }
      }
      if (await handleQueueButtonInteraction(interaction)) return;
    }

    if (!interaction.isChatInputCommand()) return;
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;

    const access = await enforceCommandAccess(interaction);
    if (!access.ok) {
      await auditCommand(interaction, 'denied', { error: access.reason });
      await denyAccess(interaction, access);
      return;
    }

    try {
      await command.execute(interaction);
      await auditCommand(interaction, 'executed');
    } catch (error) {
      console.error(`[COMMAND] /${interaction.commandName} failed:`, error);
      await auditCommand(interaction, 'failed', { error: error?.message || String(error) });
      const payload = { content: '❌ That command failed safely. Nothing else will continue running from this request. The error was added to the Operations Audit.', ephemeral: true };
      if (interaction.deferred && !interaction.replied) await interaction.editReply(payload).catch(() => null);
      else if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => null);
      else await interaction.reply(payload).catch(() => null);
    }
  } catch (error) {
    console.error('[INTERACTION] Unhandled interaction error:', error);
    const payload = { content: '❌ This interaction could not be completed.', ephemeral: true };
    if (interaction.deferred && !interaction.replied) await interaction.editReply(payload).catch(() => null);
    else if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
  }
});

// ===========================
// PROCESS / LOGIN
// ===========================
process.on('unhandledRejection', (reason) => console.error('[UNHANDLED REJECTION]', reason));
process.on('uncaughtException', (error) => console.error('[UNCAUGHT EXCEPTION]', error));

async function shutdown(signal) {
  console.log(`[SHUTDOWN] ${signal} received.`);
  for (const interval of intervals) clearInterval(interval);
  try { clearRoleSyncTimers(); } catch {}
  try { stopStaffJourneyAutomation(); } catch {}
  try { stopSupabaseHeartbeat?.(); } catch {}
  try { client.priorityStore?.saveNow?.(); } catch {}
  try { client.destroy(); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

const token = String(process.env.DISCORD_TOKEN || '').trim();
if (!token) {
  console.error('[LOGIN] DISCORD_TOKEN is missing.');
  process.exit(1);
}
client.login(token).catch((error) => {
  console.error('[LOGIN] Discord login failed:', error);
  process.exitCode = 1;
});
