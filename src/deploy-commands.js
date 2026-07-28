// src/deploy-commands.js
// Registers commands after validating that each one is covered by the central access matrix.

'use strict';
require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');
const { getCommandRequirement } = require('./utils/commandAccess');

const TOKEN = String(process.env.DISCORD_TOKEN || '').trim();
const CLIENT_ID = String(process.env.CLIENT_ID || '').trim();
const MAIN_GUILD_ID = String(process.env.GUILD_ID || '').trim();
const APPEALS_GUILD_ID = String(
  process.env.BAN_APPEALS_GUILD_ID || process.env.APPEALS_GUILD_ID || '1503667501127438406',
).trim();

if (!TOKEN || !CLIENT_ID || !MAIN_GUILD_ID) {
  console.error('Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID in the environment.');
  process.exit(1);
}

const commandEntries = [];
const commandNames = new Set();
const commandsRoot = path.join(__dirname, 'commands');

for (const folder of fs.readdirSync(commandsRoot)) {
  const folderPath = path.join(commandsRoot, folder);
  if (!fs.statSync(folderPath).isDirectory()) continue;

  for (const file of fs.readdirSync(folderPath).filter((name) => name.endsWith('.js'))) {
    const filePath = path.join(folderPath, file);
    try {
      const command = require(filePath);
      if (!command?.data || typeof command.execute !== 'function') {
        console.warn(`[DEPLOY] Skipped ${filePath}: missing data or execute.`);
        continue;
      }

      const json = command.data.toJSON();
      if (commandNames.has(json.name)) throw new Error(`Duplicate slash command name: ${json.name}`);
      if (getCommandRequirement(json.name) === null) {
        throw new Error(`/${json.name} is missing from src/config/access.js`);
      }

      commandNames.add(json.name);
      commandEntries.push({ name: json.name, folder, file, json });
      console.log(`[DEPLOY] Prepared /${json.name}`);
    } catch (error) {
      console.error(`[DEPLOY] Could not prepare ${filePath}:`, error.message || error);
      process.exitCode = 1;
    }
  }
}

if (process.exitCode) process.exit(process.exitCode);

const rest = new REST({ version: '10' }).setToken(TOKEN);
async function deployGuildCommands(guildId, commands, label) {
  console.log(`[DEPLOY] Refreshing ${commands.length} commands for ${label}...`);
  const data = await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildId), { body: commands });
  console.log(`[DEPLOY] Reloaded ${data.length} commands for ${label}.`);
}

(async () => {
  try {
    await deployGuildCommands(MAIN_GUILD_ID, commandEntries.map((entry) => entry.json), 'Main Glace Server');

    const appealsNames = new Set(['appealpanel']);
    const appealsCommands = commandEntries.filter((entry) => appealsNames.has(entry.name)).map((entry) => entry.json);
    if (APPEALS_GUILD_ID && appealsCommands.length) {
      await deployGuildCommands(APPEALS_GUILD_ID, appealsCommands, 'GH Appeals Server');
    }
  } catch (error) {
    console.error('[DEPLOY] Failed:', error);
    process.exitCode = 1;
  }
})();
