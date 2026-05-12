// src/index.js
"use strict";

require("dotenv").config();

const http = require("http");
const { Client, GatewayIntentBits, Partials, Collection, Events } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");

const { handleMessageAutomod } = require("./utils/automod");
const { runSessionAnnouncementTick } = require("./utils/sessionAnnouncements");
const { handleQueueButtonInteraction } = require("./utils/sessionQueueManager");
const { handleEditActivityReply } = require("./utils/editActivityManager");
const { runWeeklyMaintenance } = require("./utils/activityTracker");
let banAppeals = null;
try {
  banAppeals = require("./utils/banAppeals");
} catch (err) {
  console.error("[BAN APPEALS] Failed to load ban appeal system:", err);
}

const { runBanAppealReminderTick, handleBanAppealInteraction } = require("./utils/banAppeals");

let handleJuniorActivityLogMessage = null;
try {
  ({ handleJuniorActivityLogMessage } = require("./utils/juniorActivityTracker"));
} catch {
  handleJuniorActivityLogMessage = null;
}

// ✅ Only keep enforceTicketSpeak (we route ticket buttons inside InteractionCreate)
const ticketSystem = require("./utils/ticketSystem");

// IMPORTANT: priorityStore.js exports the CLASS (module.exports = PriorityStore)
const PriorityStore = require("./utils/priorityStore");

// ===========================
// HTTP SERVER FOR RENDER
// ===========================
const PORT = process.env.PORT || 3000;
let webClient = null;

http
  .createServer(async (req, res) => {
    try {
      if (req.url?.startsWith("/appeal") && banAppeals?.handleAppealWebRequest) {
        return await banAppeals.handleAppealWebRequest(req, res, webClient);
      }

      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Glace bot is running.\nBan appeals: /appeal\n");
    } catch (err) {
      console.error("[HTTP] Request error:", err);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Something went wrong.\n");
    }
  })
  .listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
  });

// ===========================
// DISCORD CLIENT SETUP
// ===========================
const ENABLE_MESSAGE_CONTENT =
  (process.env.ENABLE_MESSAGE_CONTENT || "true").toLowerCase() === "true";

const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.DirectMessages,
];

if (ENABLE_MESSAGE_CONTENT) {
  intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
} else {
  console.log("[INTENTS] ENABLE_MESSAGE_CONTENT=false -> messageCreate automod/!ping will not run.");
}

const client = new Client({
  intents,
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});
webClient = client;


// Commands collection
client.commands = new Collection();

// ===========================
// PRIORITY STORE
// ===========================
try {
  const storePath = process.env.PRIORITY_STORE_PATH; // optional
  const priorityStore = new PriorityStore(storePath);

  priorityStore.load();
  client.priorityStore = priorityStore;

  console.log(
    `[PRIORITY] Store loaded. Path: ${
      storePath && storePath.trim().length
        ? storePath
        : "default (src/data/priority.json)"
    }`
  );
} catch (err) {
  console.error("[PRIORITY] Failed to init priority store:", err);
  client.priorityStore = {
    load: () => {},
    saveNow: () => {},
    recordAttendance: () => {},
    getLastAttendedAt: () => 0,
    getAttendedCount: () => 0,
  };
}

// ===========================
// LOAD SLASH COMMANDS
// ===========================
const commandsPathRoot = path.join(__dirname, "commands");

if (fs.existsSync(commandsPathRoot)) {
  const commandFolders = fs.readdirSync(commandsPathRoot);

  for (const folder of commandFolders) {
    const commandsPath = path.join(commandsPathRoot, folder);
    if (!fs.statSync(commandsPath).isDirectory()) continue;

    const commandFiles = fs
      .readdirSync(commandsPath)
      .filter((file) => file.endsWith(".js"));

    for (const file of commandFiles) {
      const filePath = path.join(commandsPath, file);

      delete require.cache[require.resolve(filePath)];
      const command = require(filePath);

      if ("data" in command && "execute" in command) {
        client.commands.set(command.data.name, command);
        console.log(`[COMMAND] Loaded /${command.data.name} from ${filePath}`);
      } else {
        console.log(`[WARN] Command at ${filePath} missing "data" or "execute". Skipping.`);
      }
    }
  }
} else {
  console.log("[COMMAND] No commands folder found at:", commandsPathRoot);
}

// ===========================
// EVENTS
// ===========================

// READY
client.once(Events.ClientReady, (c) => {
  runWeeklyMaintenance();
  if (banAppeals?.runBanAppealReminderTick) {
    banAppeals.runBanAppealReminderTick(c).catch((err) =>
      console.error("[BAN APPEALS] Ready tick error:", err)
    );
  }
  runBanAppealReminderTick(c).catch((err) => console.error("[BAN APPEALS] Ready tick error:", err));
  console.log(
    `[READY] Logged in as ${c.user.tag} (id: ${c.user.id}) in ${c.guilds.cache.size} guild(s).`
  );
});

// SHARD / GATEWAY DEBUG
client.on("shardReady", (id) => console.log(`[SHARD] Ready: ${id}`));
client.on("shardDisconnect", (event, id) =>
  console.log(`[SHARD] Disconnect: ${id}`, event?.code, event?.reason)
);
client.on("shardReconnecting", (id) => console.log(`[SHARD] Reconnecting: ${id}`));
client.on("shardResume", (id) => console.log(`[SHARD] Resumed: ${id}`));
client.on("shardError", (err, id) => console.error(`[SHARD] Error: ${id}`, err));

setTimeout(() => {
  if (!client.isReady()) console.error("[READY] Still NOT ready after 30s.");
}, 30_000);

const ENABLE_DISCORD_DEBUG =
  (process.env.ENABLE_DISCORD_DEBUG || "false").toLowerCase() === "true";

if (ENABLE_DISCORD_DEBUG) {
  client.on("debug", (msg) => {
    if (typeof msg === "string" && msg.includes("Provided token")) return;
    console.log("[DISCORD DEBUG]", msg);
  });
}

client.on("warn", (msg) => console.warn("[DISCORD WARN]", msg));
client.on("error", (err) => console.error("[DISCORD ERROR]", err));

// Session announcements: every 1 minute
setInterval(async () => {
  try {
    console.log("[AUTO] Session announcement tick...");
    await runSessionAnnouncementTick(client);
  } catch (err) {
    console.error("[AUTO] Session announcement error:", err);
  }
}, 60 * 1000);

// Weekly activity maintenance: every 1 hour
setInterval(() => {
  try {
    runWeeklyMaintenance();
  } catch (err) {
    console.error("[ACTIVITY] Weekly maintenance error:", err);
  }
}, 60 * 60 * 1000);

// Ban appeal cooldown checks: every 10 minutes
setInterval(async () => {
  try {
    if (banAppeals?.runBanAppealReminderTick) {
      await banAppeals.runBanAppealReminderTick(client);
    }
  } catch (err) {
    console.error("[BAN APPEALS] Reminder tick error:", err);
  }
}, 10 * 60 * 1000);

// Ban appeal cooldown checks: every 10 minutes
setInterval(async () => {
  try {
    await runBanAppealReminderTick(client);
  } catch (err) {
    console.error("[BAN APPEALS] Reminder tick error:", err);
  }
}, 10 * 60 * 1000);

// MESSAGE CREATE
if (ENABLE_MESSAGE_CONTENT) {
  client.on("messageCreate", async (message) => {
    // Roblox/TC logs may come from a webhook or bot user, so record them before ignoring bots.
    if (handleJuniorActivityLogMessage) {
      try {
        await handleJuniorActivityLogMessage(message);
      } catch (err) {
        console.error("[JUNIOR ACTIVITY] Live log handling error:", err);
      }
    }

    if (message.author?.bot) return;


    try {
      if (banAppeals?.handleAppealTicketMessage) {
        const handledAppealTicket = await banAppeals.handleAppealTicketMessage(message);
        if (handledAppealTicket) return;
      }
    } catch (err) {
      console.error("[BAN APPEALS] Ticket message handling error:", err);
    }
    try {
      const handledEditReply = await handleEditActivityReply(message);
      if (handledEditReply) return;
    } catch (err) {
      console.error("[EDITACTIVITY] Reply handling error:", err);
    }

    // Ticket typing enforcement (tickets should not be automodded)
    try {
      const inTicket = await ticketSystem.enforceTicketSpeak(message);
      if (inTicket) return;
    } catch (err) {
      console.error("[TICKETS] enforceTicketSpeak error:", err);
    }

    // Automod
    try {
      await handleMessageAutomod(message);
    } catch (err) {
      console.error("[AUTOMOD] Error while processing message:", err);
    }

    if (message.content === "!ping") {
      message.reply("Pong! (prefix command)");
    }
  });
}


client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    if (banAppeals?.handleBanAppealReaction) {
      await banAppeals.handleBanAppealReaction(reaction, user);
    }
  } catch (err) {
    console.error("[BAN APPEALS] Reaction handling error:", err);
  }
});

// ===========================
// INTERACTIONS (BUTTONS + SLASH)
// ===========================

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (banAppeals?.handleBanAppealInteraction) {
      const banAppealHandled = await banAppeals.handleBanAppealInteraction(interaction);
      if (banAppealHandled) return;
    }
    const banAppealHandled = await handleBanAppealInteraction(interaction);
    if (banAppealHandled) return;

    if (interaction.isButton() || interaction.isStringSelectMenu()) {
      const id = interaction.customId || "";

      if (banAppeals?.handleBanAppealInteraction) {
        const handledBanAppeal = await banAppeals.handleBanAppealInteraction(interaction);
        if (handledBanAppeal) return;
      }

      if (interaction.isButton()) {
        // ticket close yes/no buttons
        if (id.startsWith("ticket:closeyes:") || id.startsWith("ticket:closeno:")) {
          const { handleTicketControlButton } = require("./utils/ticketSystem");
          const handled = await handleTicketControlButton(interaction);
          if (handled) return;
        }

        // ticket create buttons
        if (id.startsWith("ticket:create:")) {
          const typeKeyRaw = id.split(":").slice(2).join(":");
          const { createTicketChannel } = require("./utils/ticketSystem");
          await createTicketChannel(interaction, typeKeyRaw);
          return;
        }
      }

      const queueHandled = await handleQueueButtonInteraction(interaction);
      if (queueHandled) return;
    }

    // SLASH COMMANDS
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
      return;
    }
  } catch (err) {
    console.error("[INTERACTION] Error while executing:", err);
    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.reply({ content: "❌ Error while executing this interaction.", ephemeral: true });
      }
    } catch {}
  }
});

// ===========================
// GLOBAL ERROR HANDLERS
// ===========================
process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED REJECTION]", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT EXCEPTION]", err);
});

// ===========================
// LOGIN TO DISCORD
// ===========================
const rawToken = process.env.DISCORD_TOKEN;

if (!rawToken) {
  console.error("[LOGIN] No DISCORD_TOKEN found in environment. Set it in Render env vars.");
  process.exit(1);
}

const token = rawToken.trim();
console.log(
  `[LOGIN] DISCORD_TOKEN detected. Raw length: ${rawToken.length}, trimmed length: ${token.length}.`
);

client
  .login(token)
  .then(() => console.log("[LOGIN] client.login() resolved. Waiting for READY event..."))
  .catch((err) => console.error("[LOGIN] Failed to login to Discord:", err));