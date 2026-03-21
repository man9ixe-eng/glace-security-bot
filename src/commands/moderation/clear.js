// src/commands/moderation/clear.js

const { logModerationAction } = require('../../utils/modlog');
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { atLeastTier } = require('../../utils/permissions');

const MAX_AMOUNT = 100;

// How many old-message deletes to run at once (speed vs rate limits)
const DELETE_CONCURRENCY = 6;

// Small pause between delete batches (helps avoid hard rate-limit stalls)
const BATCH_SLEEP_MS = 350;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function deleteWithPool(messages, poolSize, onProgress) {
  let idx = 0;
  let deleted = 0;

  async function worker() {
    while (idx < messages.length) {
      const myIndex = idx++;
      const msg = messages[myIndex];

      try {
        // Skip pinned messages (remove this if you want pinned deleted too)
        if (msg.pinned) continue;

        await msg.delete();
        deleted++;
        if (typeof onProgress === 'function') onProgress(deleted);
      } catch {
        // ignore failures (missing perms, already deleted, etc.)
      }
    }
  }

  const workers = Array.from({ length: poolSize }, () => worker());
  await Promise.all(workers);
  return deleted;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Delete up to 100 messages in this channel (fast, handles old messages too).')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('How many messages to delete (1–100).')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Reason for clearing messages.')
        .setRequired(false),
    ),

  async execute(interaction) {
    if (!atLeastTier(interaction.member, 2)) {
      return interaction.reply({
        content: 'You must be at least **Tier 2 (Junior Staff)** to use `/clear`.',
        ephemeral: true,
      });
    }

    const amount = interaction.options.getInteger('amount', true);
    const reason = interaction.options.getString('reason') || 'No reason provided';

    if (amount < 1 || amount > MAX_AMOUNT) {
      return interaction.reply({
        content: 'Amount must be between **1** and **100**.',
        ephemeral: true,
      });
    }

    const channel = interaction.channel;

    await interaction.deferReply({ ephemeral: true });

    let totalDeleted = 0;
    let lastProgressEdit = 0;

    // We’ll keep fetching until we hit the amount or there’s nothing left to delete
    // NOTE: Discord fetch limit is 100; we only need up to 100 anyway.
    let beforeId = null;
    let safetyLoops = 0;

    try {
      while (totalDeleted < amount && safetyLoops < 8) {
        safetyLoops++;

        const toFetch = Math.min(100, amount - totalDeleted);
        const fetched = await channel.messages.fetch({
          limit: toFetch,
          ...(beforeId ? { before: beforeId } : {}),
        });

        if (!fetched || fetched.size === 0) break;

        // Set cursor for next fetch (oldest message in this batch)
        beforeId = fetched.last().id;

        // Convert to array (newest -> oldest)
        const batch = Array.from(fetched.values());

        // Don’t delete the interaction itself (usually not in message fetch, but safe)
        const candidates = batch.filter((m) => m.id !== interaction.id);

        // 1) Bulk delete everything Discord allows (newer than 14 days)
        // IMPORTANT: passing true ignores old ones instead of throwing
        const bulkRes = await channel.bulkDelete(candidates, true).catch(() => null);

        const bulkDeletedCount = bulkRes ? bulkRes.size : 0;
        totalDeleted += bulkDeletedCount;

        // 2) Delete the remaining (older than 14 days) using a fast concurrency pool
        if (totalDeleted < amount) {
          const bulkDeletedIds = new Set(bulkRes ? [...bulkRes.keys()] : []);
          const leftovers = candidates
            .filter((m) => !bulkDeletedIds.has(m.id))
            .slice(0, amount - totalDeleted);

          if (leftovers.length > 0) {
            // progress ping (don’t spam edits too hard)
            await interaction.editReply(
              `🧹 Clearing messages...\n` +
              `Deleted so far: **${totalDeleted}/${amount}**\n` +
              `Reason: ${reason}`,
            );

            const deletedOld = await deleteWithPool(leftovers, DELETE_CONCURRENCY, async (delta) => {
              // edit every ~10 deletes to show it’s alive
              const now = totalDeleted + delta;
              if (now - lastProgressEdit >= 10) {
                lastProgressEdit = now;
                try {
                  await interaction.editReply(
                    `🧹 Clearing messages...\n` +
                    `Deleted so far: **${now}/${amount}**\n` +
                    `Reason: ${reason}`,
                  );
                } catch {}
              }
            });

            totalDeleted += deletedOld;

            // Small pause between batches prevents “stuck mid-way” behavior from rate limits
            await sleep(BATCH_SLEEP_MS);
          }
        }


        // If we didn’t delete anything this loop, we’re probably hitting permissions/managed messages
        if (bulkDeletedCount === 0 && totalDeleted < amount) {
          // continue loop, but if nothing changes next time it will break naturally
        }
      }

          await interaction.editReply(
        `✅ Deleted **${totalDeleted}** message(s) in ${channel}.\nReason: ${reason}`,
      );

      await logModerationAction(interaction, {
        action: 'Clear Messages',
        reason,
        details: `Deleted ${totalDeleted} messages in #${interaction.channel.name}`,
      });

    } catch (err) {
      console.error('[CLEAR] Error:', err);
      await interaction.editReply(
        `⚠️ I started clearing, but something interrupted it.\nDeleted: **${totalDeleted}/${amount}**\nReason: ${reason}`,
      );
    }
  },
};
