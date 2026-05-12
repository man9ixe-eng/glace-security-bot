// tools/apply-ban-appeal-ticket-patch.js
// Run from your bot root: node tools/apply-ban-appeal-ticket-patch.js
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
  if (src.includes(insert.trim())) return false;
  const i = src.indexOf(needle);
  if (i === -1) return false;
  src = src.slice(0, i + needle.length) + insert + src.slice(i + needle.length);
  changed = true;
  return true;
}

function insertBefore(needle, insert) {
  if (src.includes(insert.trim())) return false;
  const i = src.indexOf(needle);
  if (i === -1) return false;
  src = src.slice(0, i) + insert + src.slice(i);
  changed = true;
  return true;
}

function ensureRequire() {
  if (src.includes('require("./utils/banAppeals")') || src.includes("require('./utils/banAppeals')")) return;

  const insert = `\nlet banAppeals = null;\ntry {\n  banAppeals = require("./utils/banAppeals");\n} catch (err) {\n  console.error("[BAN APPEALS] Failed to load ban appeal system:", err);\n}\n`;

  if (insertAfter('const { runWeeklyMaintenance } = require("./utils/activityTracker");', insert)) return;
  if (insertAfter("const { runWeeklyMaintenance } = require('./utils/activityTracker');", insert)) return;

  // Fallback: place after top requires.
  insertAfter('const path = require("node:path");', insert);
}

function ensureMessageHandler() {
  const block = `\n    try {\n      if (banAppeals?.handleAppealTicketMessage) {\n        const handledAppealTicket = await banAppeals.handleAppealTicketMessage(message);\n        if (handledAppealTicket) return;\n      }\n    } catch (err) {\n      console.error("[BAN APPEALS] Ticket message handling error:", err);\n    }\n`;

  if (src.includes("handledAppealTicket")) return;
  if (insertBefore("    try {\n      const handledEditReply = await handleEditActivityReply(message);", block)) return;
  if (insertBefore("    // Ticket typing enforcement", block)) return;
  console.warn("[WARN] Could not find messageCreate insert point. Add the ban appeal ticket message handler manually.");
}

function ensureInteractionHandler() {
  const block = `\n      if (banAppeals?.handleBanAppealInteraction) {\n        const handledBanAppeal = await banAppeals.handleBanAppealInteraction(interaction);\n        if (handledBanAppeal) return;\n      }\n`;

  if (src.includes("handledBanAppeal")) return;
  if (insertAfter('      const id = interaction.customId || "";\n', block)) return;
  if (insertAfter("      const id = interaction.customId || '';\n", block)) return;
  console.warn("[WARN] Could not find InteractionCreate button insert point. Add the ban appeal interaction handler manually.");
}

function ensureReactionHandler() {
  if (src.includes("handleBanAppealReaction")) return;

  const block = `\nclient.on(Events.MessageReactionAdd, async (reaction, user) => {\n  try {\n    if (banAppeals?.handleBanAppealReaction) {\n      await banAppeals.handleBanAppealReaction(reaction, user);\n    }\n  } catch (err) {\n    console.error("[BAN APPEALS] Reaction handling error:", err);\n  }\n});\n\n`;

  if (insertBefore("// ===========================\n// INTERACTIONS (BUTTONS + SLASH)", block)) return;
  if (insertBefore("client.on(Events.InteractionCreate", block)) return;
  console.warn("[WARN] Could not find reaction handler insert point. Add the MessageReactionAdd handler manually.");
}

ensureRequire();
ensureMessageHandler();
ensureInteractionHandler();
ensureReactionHandler();

if (changed) {
  fs.writeFileSync(indexPath, src);
  console.log("✅ src/index.js updated for Glace ban appeal tickets/reaction review.");
} else {
  console.log("✅ src/index.js already had the needed ban appeal ticket/reaction changes.");
}
