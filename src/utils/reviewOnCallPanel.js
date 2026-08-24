'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { getTier } = require('./permissions');
const { TIERS } = require('../config/access');

const DEFAULT_CHANNEL_ID = '1474299478675558565';
const PANEL_FOOTER = 'Glace Hotels \u2022 On-Call Roles';

function channelId() {
  return String(
    process.env.REVIEW_ON_CALL_CHANNEL_ID
    || process.env.TICKET_REVIEW_ON_CALL_CHANNEL_ID
    || DEFAULT_CHANNEL_ID,
  ).trim();
}

function firstConfigured(...values) {
  return String(values.find((value) => String(value || '').trim()) || '').trim();
}

function configuredRoles() {
  return {
    intern: firstConfigured(
      process.env.INTERN_REVIEW_PING_ROLE_ID,
      process.env.INTERN_TEAM_REVIEW_PING_ROLE_ID,
    ),
    management: firstConfigured(
      process.env.MANAGEMENT_REVIEW_PING_ROLE_ID,
      process.env.MANAGER_REVIEW_PING_ROLE_ID,
    ),
    senior: firstConfigured(
      process.env.SENIOR_MANAGEMENT_REVIEW_PING_ROLE_ID,
      process.env.SENIOR_REVIEW_PING_ROLE_ID,
    ),
    corporate: firstConfigured(process.env.CORPORATE_REVIEW_PING_ROLE_ID),
    board: firstConfigured(
      process.env.CORPORATE_BOARD_REVIEW_PING_ROLE_ID,
      process.env.BOARD_REVIEW_PING_ROLE_ID,
    ),
    presidential: firstConfigured(process.env.PRESIDENTIAL_REVIEW_PING_ROLE_ID),
  };
}

function roleForTier(tier) {
  const roles = configuredRoles();
  if (tier >= TIERS.PRESIDENTIAL) return { id: roles.presidential, label: 'Presidential' };
  if (tier >= TIERS.CORPORATE_BOARD) return { id: roles.board, label: 'Corporate Board' };
  if (tier >= TIERS.CORPORATE) return { id: roles.corporate, label: 'Corporate' };
  if (tier >= TIERS.SENIOR_MANAGEMENT) return { id: roles.senior, label: 'Senior Management' };
  if (tier >= TIERS.MANAGEMENT) return { id: roles.management, label: 'Management' };
  if (tier >= TIERS.INTERN) return { id: roles.intern, label: 'Intern Team' };
  return null;
}

function panelPayload() {
  const embed = new EmbedBuilder()
    .setTitle('\u2605 Staff On-Call Roles')
    .setDescription([
      'Use this panel to control whether you receive ticket and review pings.',
      '',
      '**On Call** gives you the on-call role that matches your current Glace tier.',
      '**Off Call** removes your on-call role until you are available again.',
      '',
      'Available to all current Intern Team+ staff.',
    ].join('\n'))
    .setColor(0x2368b3)
    .setFooter({ text: PANEL_FOOTER });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ghreview:on')
      .setLabel('Go On Call')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('ghreview:off')
      .setLabel('Go Off Call')
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}

async function ensureReviewOnCallPanel(client) {
  const wanted = channelId();
  if (!wanted) return { ok: false, reason: 'No on-call channel configured.' };

  const channel = await client.channels.fetch(wanted).catch(() => null);
  if (!channel?.isTextBased?.()) {
    return { ok: false, reason: 'On-call channel not found.' };
  }

  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const existing = recent?.find(
    (message) => message.author?.id === client.user?.id
      && ['Glace Hotels \u2022 Review On-Call Roles', PANEL_FOOTER].includes(message.embeds?.[0]?.footer?.text),
  );

  if (existing) {
    await existing.edit(panelPayload());
    return { ok: true, updated: true, messageId: existing.id, channelId: channel.id };
  }

  const sent = await channel.send(panelPayload());
  return { ok: true, created: true, messageId: sent.id, channelId: channel.id };
}

async function handleReviewOnCallInteraction(interaction) {
  if (!interaction.isButton?.() || !String(interaction.customId || '').startsWith('ghreview:')) {
    return false;
  }

  if (!interaction.guildId || !interaction.member) {
    await interaction.reply({
      content: 'This panel can only be used inside the Glace server.',
      ephemeral: true,
    }).catch(() => null);
    return true;
  }

  await interaction.deferReply({ ephemeral: true });
  const tier = getTier(interaction.member);
  const selected = roleForTier(tier);

  if (!selected) {
    await interaction.editReply(
      '\u274C Only current Intern Team+ staff may use the on-call panel.',
    );
    return true;
  }

  const roles = configuredRoles();
  const allRoleIds = [...new Set(Object.values(roles).filter(Boolean))];

  if (!selected.id) {
    await interaction.editReply(
      `\u274C The on-call role for **${selected.label}** is not configured in Render yet.`,
    );
    return true;
  }

  try {
    if (interaction.customId === 'ghreview:on') {
      const stale = allRoleIds.filter(
        (id) => id !== selected.id && interaction.member.roles.cache.has(id),
      );
      if (stale.length) {
        await interaction.member.roles.remove(stale, 'Glace on-call tier sync');
      }
      if (!interaction.member.roles.cache.has(selected.id)) {
        await interaction.member.roles.add(selected.id, 'Member selected Go On Call');
      }
      await interaction.editReply(
        `\u2705 You are now **On Call** as **${selected.label}** and will receive its ticket/review pings.`,
      );
      return true;
    }

    const removable = allRoleIds.filter((id) => interaction.member.roles.cache.has(id));
    if (removable.length) {
      await interaction.member.roles.remove(removable, 'Member selected Go Off Call');
    }
    await interaction.editReply(
      removable.length
        ? '\u2705 You are now **Off Call**. Your on-call role was removed.'
        : '\u2705 You are already **Off Call**.',
    );
  } catch (error) {
    await interaction.editReply(
      `\u274C I could not update your on-call role. Make sure the bot has **Manage Roles** and is above every on-call role. (${error.message})`,
    );
  }

  return true;
}

module.exports = {
  DEFAULT_CHANNEL_ID,
  ensureReviewOnCallPanel,
  handleReviewOnCallInteraction,
  roleForTier,
  configuredRoles,
};
