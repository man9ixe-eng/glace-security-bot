// src/utils/sessionAnnouncements.js
// Compatibility wrapper used by src/index.js.

const { runSessionAutomation } = require('./sessionAutomation');

async function runSessionAnnouncementTick(client) {
  return runSessionAutomation(client);
}

module.exports = { runSessionAnnouncementTick };
