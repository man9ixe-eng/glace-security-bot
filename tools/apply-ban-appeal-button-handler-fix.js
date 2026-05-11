// tools/apply-ban-appeal-button-handler-fix.js
// Run from your bot root: node tools/apply-ban-appeal-button-handler-fix.js
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const indexPath = path.join(process.cwd(), "src", "index.js");

if (!fs.existsSync(indexPath)) {
  console.error("❌ Could not find src/index.js. Run this from your bot root folder.");
  process.exit(1);
}

let src = fs.readFileSync(indexPath, "utf8");
let changed = false;

function save() {
  if (!changed) {
    console.log("✅ Ban appeal button handler already looks connected.");
    return;
  }
  fs.writeFileSync(indexPath, src);
  console.log("✅ Ban appeal button/modal handler connected inside src/index.js.");
}

function insertAfter(needle, insert) {
  if (src.includes(insert.trim())) return false;
  const pos = src.indexOf(needle);
  if (pos === -1) {
    console.warn(`[WARN] Could not find insert point:\n${needle}`);
    return false;
  }
  src = src.slice(0, pos + needle.length) + insert + src.slice(pos + needle.length);
  changed = true;
  return true;
}

function replaceOnce(needle, replacement) {
  if (src.includes(replacement)) return false;
  const pos = src.indexOf(needle);
  if (pos === -1) {
    console.warn(`[WARN] Could not find text to replace:\n${needle}`);
    return false;
  }
  src = src.slice(0, pos) + replacement + src.slice(pos + needle.length);
  changed = true;
  return true;
}

// 1) Make sure the bot can receive DM interactions reliably.
if (!src.includes("GatewayIntentBits.DirectMessages")) {
  replaceOnce(
    "GatewayIntentBits.GuildMessageReactions,",
    "GatewayIntentBits.GuildMessageReactions,\n  GatewayIntentBits.DirectMessages,"
  );
}

// 2) Make sure the banAppeals util is required safely.
if (!src.includes('banAppeals = require("./utils/banAppeals")') && !src.includes("banAppeals = require('./utils/banAppeals')")) {
  const importNeedle = 'const { runWeeklyMaintenance } = require("./utils/activityTracker");';
  const fallbackNeedle = 'const ticketSystem = require("./utils/ticketSystem");';
  const insert = `\nlet banAppeals = null;\ntry {\n  banAppeals = require("./utils/banAppeals");\n} catch (err) {\n  console.error("[BAN APPEALS] Failed to load ban appeal system:", err);\n}\n`;

  if (!insertAfter(importNeedle, insert)) {
    insertAfter(fallbackNeedle, `\n${insert}`);
  }
}

// 3) Put the appeal button/modal handler at the VERY TOP of InteractionCreate.
// This matters because DM buttons do not have guild/channel context like normal server buttons.
const handlerSnippet = `
    if (banAppeals?.handleBanAppealInteraction) {
      const banAppealHandled = await banAppeals.handleBanAppealInteraction(interaction);
      if (banAppealHandled) return;
    }
`;

if (!src.includes("handleBanAppealInteraction(interaction)")) {
  const interactionNeedle = "client.on(Events.InteractionCreate, async (interaction) => {\n  try {";
  insertAfter(interactionNeedle, handlerSnippet);
}

// If it exists but was inserted too low, do not try to move it blindly.
// The key check is that the handler is called before queue/ticket command logic.

// 4) Add cooldown retry tick if missing. Not needed for the button itself, but keeps appeals smooth.
if (!src.includes("runBanAppealReminderTick(client)")) {
  const weeklyNeedle = "}, 60 * 60 * 1000);";
  insertAfter(
    weeklyNeedle,
    `\n\n// Ban appeal cooldown checks: every 10 minutes\nsetInterval(async () => {\n  try {\n    if (banAppeals?.runBanAppealReminderTick) {\n      await banAppeals.runBanAppealReminderTick(client);\n    }\n  } catch (err) {\n    console.error("[BAN APPEALS] Reminder tick error:", err);\n  }\n}, 10 * 60 * 1000);`
  );
}

save();
