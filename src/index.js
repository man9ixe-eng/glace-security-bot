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
const { runWeeklyMaintenance } = require("./utils/activityTracker");

// ✅ Only keep enforceTicketSpeak (we route ticket buttons inside InteractionCreate)
const ticketSystem = require("./utils/ticketSystem");

// IMPORTANT: priorityStore.js exports the CLASS (module.exports = PriorityStore)
const PriorityStore = require("./utils/priorityStore");

// ===========================
// HTTP SERVER FOR RENDER
// ===========================
const PORT = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Glace bot is running.\n");
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

// MESSAGE CREATE
if (ENABLE_MESSAGE_CONTENT) {
  client.on("messageCreate", async (message) => {
    if (message.author?.bot) return;

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

// ===========================
// INTERACTIONS (BUTTONS + SLASH)
// ===========================

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // BUTTONS
    if (interaction.isButton()) {
      const id = interaction.customId || "";

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

      // session queue buttons
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