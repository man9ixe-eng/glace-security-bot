'use strict';

const { COMMAND_MIN_TIER, COMMANDS_REQUIRING_OUTRANK } = require('../config/access');
const { getTier, getTierLabel, outranks, isOwner } = require('./permissions');

function getCommandRequirement(commandName) {
  const name = String(commandName || '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(COMMAND_MIN_TIER, name)
    ? COMMAND_MIN_TIER[name]
    : null;
}

async function enforceCommandAccess(interaction) {
  const commandName = String(interaction?.commandName || '').toLowerCase();
  const required = getCommandRequirement(commandName);

  if (!interaction?.inGuild?.() || !interaction.member) {
    return { ok: false, reason: 'This command can only be used inside an authorized Glace server.' };
  }

  if (required === null) {
    return { ok: false, reason: `/${commandName} is not listed in the central access matrix, so it was blocked for safety.` };
  }

  const actual = getTier(interaction.member);
  if (actual < required) {
    return {
      ok: false,
      actual,
      required,
      reason: `You need **Tier ${required} (${getTierLabel(required)})** to use \`/${commandName}\`. The bot sees you as **Tier ${actual} (${getTierLabel(actual)})**.`,
    };
  }

  const targetOption = COMMANDS_REQUIRING_OUTRANK[commandName];
  if (targetOption && !isOwner(interaction.member)) {
    let target = interaction.options.getMember(targetOption);
    if (!target) {
      const user = interaction.options.getUser(targetOption);
      if (user) target = await interaction.guild.members.fetch(user.id).catch(() => null);
    }
    if (target && !outranks(interaction.member, target)) {
      return { ok: false, actual, required, reason: `You cannot use \`/${commandName}\` on a staff member at your tier or above it.` };
    }
  }

  return { ok: true, actual, required };
}

async function denyAccess(interaction, result) {
  const payload = { content: `\u274C ${result.reason}`, ephemeral: true };
  if (interaction.deferred && !interaction.replied) return interaction.editReply(payload).catch(() => null);
  if (interaction.replied || interaction.deferred) return interaction.followUp(payload).catch(() => null);
  return interaction.reply(payload).catch(() => null);
}

module.exports = { getCommandRequirement, enforceCommandAccess, denyAccess };
