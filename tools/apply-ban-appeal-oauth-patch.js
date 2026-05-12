// tools/apply-ban-appeal-oauth-patch.js
// Run from your bot root: node tools/apply-ban-appeal-oauth-patch.js
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

function write() {
  if (changed) {
    fs.writeFileSync(indexPath, src);
    console.log("✅ src/index.js updated for Discord OAuth ban appeals.");
  } else {
    console.log("✅ src/index.js already had the Discord OAuth ban appeal changes.");
  }
}

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
  const i = src.indexOf(needle);
  if (i === -1) return false;
  src = src.slice(0, i) + replacement + src.slice(i + needle.length);
  changed = true;
  return true;
}

function ensureBanAppealRequire() {
  if (src.includes('require("./utils/banAppeals")') || src.includes("require('./utils/banAppeals')")) return;
  insertAfter(
    'const { runWeeklyMaintenance } = require("./utils/activityTracker");',
    `\nlet banAppeals = null;\ntry {\n  banAppeals = require("./utils/banAppeals");\n} catch (err) {\n  console.error("[BAN APPEALS] Failed to load ban appeal system:", err);\n}\n`
  );
}

function ensureWebClientVar() {
  if (!src.includes("let webClient = null;")) {
    if (!replaceOnce(
      "const PORT = process.env.PORT || 3000;",
      "const PORT = process.env.PORT || 3000;\nlet webClient = null;"
    )) {
      console.warn("[WARN] Could not add webClient variable near PORT.");
    }
  }
}

function ensureHttpServerRoutes() {
  const simpleServer = `http\n  .createServer((req, res) => {\n    res.writeHead(200, { "Content-Type": "text/plain" });\n    res.end("Glace bot is running.\\n");\n  })\n  .listen(PORT, () => {\n    console.log(\`HTTP server listening on port \${PORT}\`);\n  });`;

  const oauthServer = `http\n  .createServer(async (req, res) => {\n    try {\n      if (req.url?.startsWith("/appeal") && banAppeals?.handleAppealWebRequest) {\n        return await banAppeals.handleAppealWebRequest(req, res, webClient);\n      }\n\n      res.writeHead(200, { "Content-Type": "text/plain" });\n      res.end("Glace bot is running.\\nBan appeals: /appeal\\n");\n    } catch (err) {\n      console.error("[HTTP] Request error:", err);\n      if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });\n      res.end("Something went wrong.\\n");\n    }\n  })\n  .listen(PORT, () => {\n    console.log(\`HTTP server listening on port \${PORT}\`);\n  });`;

  if (src.includes("banAppeals?.handleAppealWebRequest")) return;
  if (replaceOnce(simpleServer, oauthServer)) return;

  // If an older custom HTTP server already exists, replace only the createServer callback body conservatively.
  const serverRegex = /http\s*\.createServer\(\s*\(req, res\)\s*=>\s*\{[\s\S]*?\}\s*\)\s*\.listen\(PORT,\s*\(\)\s*=>\s*\{\s*console\.log\(`HTTP server listening on port \$\{PORT\}`\);\s*\}\s*\);/m;
  if (serverRegex.test(src)) {
    src = src.replace(serverRegex, oauthServer);
    changed = true;
    return;
  }

  console.warn("[WARN] Could not find the HTTP server block to replace. Add /appeal routing manually if the website does not load.");
}

function ensureClientReference() {
  if (src.includes("webClient = client;")) return;
  const clientBlock = `const client = new Client({\n  intents,\n  partials: [Partials.Message, Partials.Channel, Partials.Reaction],\n});`;
  insertAfter(clientBlock, `\nwebClient = client;\n`);
}

function ensureReadyTick() {
  if (src.includes("[BAN APPEALS] Ready tick error")) return;
  insertAfter(
    "runWeeklyMaintenance();",
    `\n  if (banAppeals?.runBanAppealReminderTick) {\n    banAppeals.runBanAppealReminderTick(c).catch((err) =>\n      console.error("[BAN APPEALS] Ready tick error:", err)\n    );\n  }`
  );
}

function ensureIntervalTick() {
  if (src.includes("Ban appeal cooldown checks: every 10 minutes")) return;
  insertAfter(
    "}, 60 * 60 * 1000);",
    `\n\n// Ban appeal cooldown checks: every 10 minutes\nsetInterval(async () => {\n  try {\n    if (banAppeals?.runBanAppealReminderTick) {\n      await banAppeals.runBanAppealReminderTick(client);\n    }\n  } catch (err) {\n    console.error("[BAN APPEALS] Reminder tick error:", err);\n  }\n}, 10 * 60 * 1000);`
  );
}

function ensureInteractionHandler() {
  if (src.includes("banAppeals?.handleBanAppealInteraction")) return;
  const needle = "client.on(Events.InteractionCreate, async (interaction) => {\n  try {";
  insertAfter(
    needle,
    `\n    if (banAppeals?.handleBanAppealInteraction) {\n      const banAppealHandled = await banAppeals.handleBanAppealInteraction(interaction);\n      if (banAppealHandled) return;\n    }`
  );
}

ensureBanAppealRequire();
ensureWebClientVar();
ensureHttpServerRoutes();
ensureClientReference();
ensureReadyTick();
ensureIntervalTick();
ensureInteractionHandler();
write();
