// tools/apply-ban-appeals-index-patch.js
// Run once from your bot root: node tools/apply-ban-appeals-index-patch.js
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const indexPath = path.join(process.cwd(), "src", "index.js");

if (!fs.existsSync(indexPath)) {
  console.error("Could not find src/index.js. Run this from your bot root folder.");
  process.exit(1);
}

let src = fs.readFileSync(indexPath, "utf8");
let changed = false;

function insertAfter(needle, insert) {
  if (src.includes(insert.trim())) return;
  const i = src.indexOf(needle);
  if (i === -1) {
    console.warn(`[WARN] Could not find insert point:\n${needle}`);
    return;
  }
  src = src.slice(0, i + needle.length) + insert + src.slice(i + needle.length);
  changed = true;
}

function replaceOnce(needle, replacement) {
  if (src.includes(replacement)) return;
  if (!src.includes(needle)) {
    console.warn(`[WARN] Could not find text to replace:\n${needle}`);
    return;
  }
  src = src.replace(needle, replacement);
  changed = true;
}

// Add DirectMessages intent so DM buttons/modals can be received more reliably.
if (!src.includes("GatewayIntentBits.DirectMessages")) {
  replaceOnce(
    "GatewayIntentBits.GuildMessageReactions,",
    "GatewayIntentBits.GuildMessageReactions,\n  GatewayIntentBits.DirectMessages,"
  );
}

// Require the ban appeal handler without breaking the bot if the file is missing.
insertAfter(
  'const { runWeeklyMaintenance } = require("./utils/activityTracker");',
  `\nlet banAppeals = null;\ntry {\n  banAppeals = require("./utils/banAppeals");\n} catch (err) {\n  console.error("[BAN APPEALS] Failed to load ban appeal system:", err);\n}\n`
);

// Ready tick for missed cooldowns.
insertAfter(
  "runWeeklyMaintenance();",
  `\n  if (banAppeals?.runBanAppealReminderTick) {\n    banAppeals.runBanAppealReminderTick(c).catch((err) =>\n      console.error("[BAN APPEALS] Ready tick error:", err)\n    );\n  }`
);

// 10-minute cooldown checker.
insertAfter(
  "}, 60 * 60 * 1000);",
  `\n\n// Ban appeal cooldown checks: every 10 minutes\nsetInterval(async () => {\n  try {\n    if (banAppeals?.runBanAppealReminderTick) {\n      await banAppeals.runBanAppealReminderTick(client);\n    }\n  } catch (err) {\n    console.error("[BAN APPEALS] Reminder tick error:", err);\n  }\n}, 10 * 60 * 1000);`
);

// Interaction handler for appeal buttons/modals/review buttons.
insertAfter(
  "client.on(Events.InteractionCreate, async (interaction) => {\n  try {",
  `\n    if (banAppeals?.handleBanAppealInteraction) {\n      const banAppealHandled = await banAppeals.handleBanAppealInteraction(interaction);\n      if (banAppealHandled) return;\n    }`
);

if (changed) {
  fs.writeFileSync(indexPath, src);
  console.log("✅ src/index.js updated for the ban appeal system.");
} else {
  console.log("✅ src/index.js already had the ban appeal changes.");
}
