'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { getTier } = require('./permissions');
const { TIERS } = require('../config/access');

const DEFAULT_CHANNEL_ID = '1474299478675558565';
const PANEL_FOOTER = 'Glace Hotels • Review On-Call Roles';

function channelId() {
  return String(
    process.env.REVIEW_ON_CALL_CHANNEL_ID
    || process.env.TICKET_REVIEW_ON_CALL_CHANNEL_ID
    || DEFAULT_CHANNEL_ID,
  ).trim();
}

function configuredRoles() {
  return {
    corporate: String(process.env.CORPORATE_REVIEW_PING_ROLE_ID || '').trim(),
    board: String(
      process.env.CORPORATE_BOARD_REVIEW_PING_ROLE_ID
      || process.env.BOARD_REVIEW_PING_ROLE_ID
      || '',
    ).trim(),
    presidential: String(process.env.PRESIDENTIAL_REVIEW_PING_ROLE_ID || '').trim(),
  };
}

function roleForTier(tier) {
  const roles = configuredRoles();
  if (tier >= TIERS.PRESIDENTIAL) return { id: roles.presidential, label: 'Presidential Review' };
  if (tier >= TIERS.CORPORATE_BOARD) return { id: roles.board, label: 'Corporate Board Review' };
  if (tier >= TIERS.CORPORATE) return { id: roles.corporate, label: 'Corporate Review' };
  return null;
}

function panelPayload() {
  const embed = new EmbedBuilder()
    .setTitle('★ Review Team On-Call')
    .setDescription([
      'Use this panel when you are available to review staff requests, promotions, LOAs, and profile changes.',
      '',
      '**On Call** adds the review ping role for your current Glace tier.',
      '**Off Call** removes your review ping roles so you are not pinged while unavailable.',
      '',
      'Corporate, Corporate Board, and Presidential members only.',
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
  if (!wanted) return { ok: false, reason: 'No review on-call channel configured.' };

  const channel = await client.channels.fetch(wanted).catch(() => null);
  if (!channel?.isTextBased?.()) {
    return { ok: false, reason: 'Review on-call channel not found.' };
  }

  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const existing = recent?.find(
    (message) => message.author?.id === client.user?.id
      && message.embeds?.[0]?.footer?.text === PANEL_FOOTER,
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
      '❌ Only current Corporate, Corporate Board, and Presidential members may join the review on-call list.',
    );
    return true;
  }

  const roles = configuredRoles();
  const allRoleIds = [...new Set(Object.values(roles).filter(Boolean))];

  if (!selected.id) {
    await interaction.editReply(`❌ The ${selected.label} ping role is not configured in Render.`);
    return true;
  }

  try {
    if (interaction.customId === 'ghreview:on') {
      const stale = allRoleIds.filter(
        (id) => id !== selected.id && interaction.member.roles.cache.has(id),
      );
      if (stale.length) {
        await interaction.member.roles.remove(stale, 'Glace review on-call tier sync');
      }
      if (!interaction.member.roles.cache.has(selected.id)) {
        await interaction.member.roles.add(selected.id, 'Member selected Go On Call');
      }
      await interaction.editReply(
        `✅ You are now **On Call** for **${selected.label}**. You will receive its review pings.`,
      );
      return true;
    }

    const removable = allRoleIds.filter((id) => interaction.member.roles.cache.has(id));
    if (removable.length) {
      await interaction.member.roles.remove(removable, 'Member selected Go Off Call');
    }
    await interaction.editReply(
      removable.length
        ? '✅ You are now **Off Call**. Your review ping role was removed.'
        : '✅ You are already **Off Call**.',
    );
  } catch (error) {
    await interaction.editReply(
      `❌ I could not update the review role. Make sure the bot has **Manage Roles** and is above the review ping roles. (${error.message})`,
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
