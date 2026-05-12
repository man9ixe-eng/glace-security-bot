// src/deploy-commands.js
// Registers slash commands in src/commands/** with Discord.
// Main Glace server gets every command.
// GH Appeals server gets only appeal setup commands, so staff commands do not clutter that server.

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID; // your bot application ID
const MAIN_GUILD_ID = process.env.GUILD_ID; // your main Glace server ID
const APPEALS_GUILD_ID =
  process.env.BAN_APPEALS_GUILD_ID ||
  process.env.APPEALS_GUILD_ID ||
  '1503667501127438406'; // GH | Appeals server ID

if (!TOKEN || !CLIENT_ID || !MAIN_GUILD_ID) {
  console.error('Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID in .env');
  process.exit(1);
}

const commandEntries = [];

// Read all folders inside src/commands
const commandsPathRoot = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(commandsPathRoot);

for (const folder of commandFolders) {
  const commandsPath = path.join(commandsPathRoot, folder);
  if (!fs.statSync(commandsPath).isDirectory()) continue;

  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);

    if ('data' in command && 'execute' in command) {
      const json = command.data.toJSON();
      commandEntries.push({ name: command.data.name, folder, file, json, filePath });
      console.log(`[DEPLOY] Prepared /${command.data.name} from ${filePath}`);
    } else {
      console.warn(`[DEPLOY] Command at ${filePath} is missing "data" or "execute". Skipping.`);
    }
  }
}

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function deployGuildCommands(guildId, commands, label) {
  console.log(`[DEPLOY] Refreshing ${commands.length} application (/) commands for ${label} (${guildId})...`);

  const data = await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, guildId),
    { body: commands },
  );

  console.log(`[DEPLOY] Successfully reloaded ${data.length} commands for ${label}.`);
}

(async () => {
  try {
    const mainCommands = commandEntries.map(entry => entry.json);

    // Keep GH | Appeals clean. Only deploy the setup command there.
    const appealsCommandNames = new Set([
      'appealpanel',
    ]);

    const appealsCommands = commandEntries
      .filter(entry => appealsCommandNames.has(entry.name))
      .map(entry => entry.json);

    await deployGuildCommands(MAIN_GUILD_ID, mainCommands, 'Main Glace Server');

    if (APPEALS_GUILD_ID && appealsCommands.length) {
      await deployGuildCommands(APPEALS_GUILD_ID, appealsCommands, 'GH Appeals Server');
    } else if (!appealsCommands.length) {
      console.warn('[DEPLOY] /appealpanel was not found, so no commands were deployed to GH Appeals. Make sure src/commands/moderation/appealpanel.js exists.');
    }
  } catch (error) {
    console.error('Failed to deploy commands:', error);
    process.exitCode = 1;
  }
})();
