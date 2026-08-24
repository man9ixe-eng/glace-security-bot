'use strict';

const { ApplicationCommandOptionType } = require('discord.js');
const { enforceCommandAccess } = require('./commandAccess');
const { auditCommand } = require('./operationsAudit');

const ACCESS_ROLE_ID = '1541381128714453052';
const COMMAND_CHANNEL_ID = '1541381517169918063';

const APPROVED = new Set([
  'ban',
  'checkwarnings',
  'clear',
  'clearwarn',
  'clearwarns',
  'kick',
  'lock',
  'slowmode',
  'timeout',
  'unban',
  'unlock',
  'warn',
  'warnings',
  'activity',
  'activitylist',
  'addsession',
  'cancelsession',
  'editcard',
  'junioractivity',
  'logsession',
  'removesession',
  'sessionattendees',
  'sessionqueue',
  'sessions',
  'viewactivity',
  'addloa',
  'demote',
  'enroll',
  'extendloa',
  'promote',
  'removeloa',
  'resign',
  'staffjourneypost',
  'updateuser',
  'adduser',
  'claim',
  'close',
  'forceclose',
  'ping',
  'stafftier',
]);

const COMMAND_ALIASES = Object.freeze({
  clearwarns: 'clearwarnall',
});

const CHANNEL_TARGET_COMMANDS = new Set([
  'claim',
  'close',
  'forceclose',
  'adduser',
  'lock',
  'unlock',
  'clear',
  'slowmode',
]);

function stripQuotes(value) {
  const text = String(value ?? '').trim();

  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];

    if (
      (first === '"' && last === '"')
      || (first === "'" && last === "'")
    ) {
      return text.slice(1, -1);
    }
  }

  return text;
}

function removeSlice(text, start, length) {
  return `${text.slice(0, start)} ${text.slice(start + length)}`
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTargetChannel(raw, commandName) {
  let remaining = String(raw || '').trim();
  let targetInput = null;

  // Explicit format: in:#ticket or in:<#123>
  const explicit = remaining.match(
    /(?:^|\s)in\s*:\s*(<#\d{15,25}>|#[A-Za-z0-9_-]+|\d{15,25})(?=\s|$)/i
  );

  if (explicit) {
    targetInput = explicit[1];
    remaining = removeSlice(
      remaining,
      explicit.index,
      explicit[0].length
    );

    return { targetInput, remaining };
  }

  // Friendly format for channel-based commands:
  // !claim #ticket
  if (CHANNEL_TARGET_COMMANDS.has(commandName)) {
    const bareChannel = remaining.match(
      /(?:^|\s)(<#\d{15,25}>|#[A-Za-z0-9_-]+)(?=\s|$)/
    );

    if (bareChannel) {
      targetInput = bareChannel[1];
      remaining = removeSlice(
        remaining,
        bareChannel.index,
        bareChannel[0].length
      );
    }
  }

  return { targetInput, remaining };
}

function parseNamedArguments(raw) {
  const input = String(raw || '');
  const result = new Map();
  const marker = /(?:^|\s)([A-Za-z0-9_-]+)\s*[:=]\s*/g;
  const matches = [];
  let match;

  while ((match = marker.exec(input)) !== null) {
    matches.push({
      key: String(match[1] || '').toLowerCase(),
      markerStart: match.index,
      valueStart: marker.lastIndex,
    });
  }

  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i];
    const end =
      i + 1 < matches.length
        ? matches[i + 1].markerStart
        : input.length;

    result.set(
      current.key,
      stripQuotes(input.slice(current.valueStart, end))
    );
  }

  return result;
}

function parseDiscordId(value) {
  const text = String(value || '').trim();

  let match = text.match(/^<@!?(\d{15,25})>$/);
  if (match) return match[1];

  match = text.match(/^<#(\d{15,25})>$/);
  if (match) return match[1];

  match = text.match(/^<@&(\d{15,25})>$/);
  if (match) return match[1];

  if (/^\d{15,25}$/.test(text)) return text;

  return null;
}

function normalizedName(value) {
  return String(value || '')
    .trim()
    .replace(/^[@#]/, '')
    .toLowerCase();
}

async function resolveMember(guild, value) {
  if (!guild) return null;

  const id = parseDiscordId(value);

  if (id) {
    return guild.members.fetch(id).catch(() => null);
  }

  const wanted = normalizedName(value);
  if (!wanted) return null;

  return guild.members.cache.find((member) => {
    const names = [
      member.user?.username,
      member.user?.globalName,
      member.displayName,
      member.nickname,
    ]
      .filter(Boolean)
      .map((name) => String(name).toLowerCase());

    return names.includes(wanted);
  }) || null;
}

async function resolveUser(guild, value) {
  const member = await resolveMember(guild, value);

  if (member?.user) {
    return member.user;
  }

  const id = parseDiscordId(value);
  if (!id) return null;

  return guild?.client?.users?.fetch(id).catch(() => null);
}

async function resolveChannel(guild, value) {
  if (!guild) return null;

  const id = parseDiscordId(value);

  if (id) {
    return guild.channels.fetch(id).catch(() => null);
  }

  const wanted = normalizedName(value);
  if (!wanted) return null;

  return guild.channels.cache.find(
    (channel) =>
      String(channel.name || '').toLowerCase() === wanted
  ) || null;
}

async function resolveRole(guild, value) {
  if (!guild) return null;

  const id = parseDiscordId(value);

  if (id) {
    return guild.roles.fetch(id).catch(() => null);
  }

  const wanted = normalizedName(value);
  if (!wanted) return null;

  return guild.roles.cache.find(
    (role) => String(role.name || '').toLowerCase() === wanted
  ) || null;
}

function commandSchema(command) {
  try {
    return command?.data?.toJSON?.() || {};
  } catch {
    return {};
  }
}

function flattenOptions(options = []) {
  const output = [];

  for (const option of options) {
    if (
      option.type === ApplicationCommandOptionType.Subcommand
      || option.type === ApplicationCommandOptionType.SubcommandGroup
    ) {
      output.push(...flattenOptions(option.options || []));
      continue;
    }

    output.push(option);
  }

  return output;
}

function applyChoice(option, value) {
  const choices = Array.isArray(option?.choices)
    ? option.choices
    : [];

  if (!choices.length) {
    return value;
  }

  const wanted = String(value || '').trim().toLowerCase();

  const found = choices.find(
    (choice) =>
      String(choice.name || '').toLowerCase() === wanted
      || String(choice.value ?? '').toLowerCase() === wanted
  );

  return found ? found.value : value;
}

function parseBoolean(value) {
  const text = String(value || '').trim().toLowerCase();

  if (['true', 'yes', 'y', '1', 'on'].includes(text)) {
    return true;
  }

  if (['false', 'no', 'n', '0', 'off'].includes(text)) {
    return false;
  }

  return null;
}

function usageFor(requestedName, schema) {
  const parts = [`!${requestedName}`];

  for (const option of flattenOptions(schema.options || [])) {
    let sample = '<value>';

    if (option.type === ApplicationCommandOptionType.User) {
      sample = '@user';
    } else if (option.type === ApplicationCommandOptionType.Channel) {
      sample = '#channel';
    } else if (option.type === ApplicationCommandOptionType.Role) {
      sample = '@role';
    } else if (option.type === ApplicationCommandOptionType.Boolean) {
      sample = 'yes/no';
    } else if (option.choices?.length) {
      sample =
        `"${option.choices
          .slice(0, 3)
          .map((choice) => choice.name)
          .join(' / ')}"`;
    } else if (option.type === ApplicationCommandOptionType.String) {
      sample = '"text"';
    }

    parts.push(
      `${option.name}:${sample}${option.required ? '' : ' (optional)'}`
    );
  }

  if (CHANNEL_TARGET_COMMANDS.has(requestedName)) {
    parts.push('#target-channel');
  }

  return parts.join(' ');
}

async function buildOptions(command, args, guild, message) {
  const schema = commandSchema(command);
  const definitions = flattenOptions(schema.options || []);
  const records = new Map();
  const data = [];
  const errors = [];

  for (const option of definitions) {
    const name = String(option.name || '').toLowerCase();

    if (!name) {
      continue;
    }

    let raw = args.get(name);

    if (
      (raw === undefined || raw === '')
      && option.type === ApplicationCommandOptionType.Attachment
    ) {
      raw = message.attachments.first()?.url || undefined;
    }

    if (
      (raw === undefined || raw === '')
      && option.required
    ) {
      errors.push(`Missing required option \`${name}\`.`);
      continue;
    }

    if (raw === undefined || raw === '') {
      continue;
    }

    raw = applyChoice(option, raw);

    let value = raw;
    let user = null;
    let member = null;
    let channel = null;
    let role = null;
    let attachment = null;

    switch (option.type) {
      case ApplicationCommandOptionType.String:
        value = String(raw);
        break;

      case ApplicationCommandOptionType.Integer: {
        const parsed = Number.parseInt(String(raw), 10);

        if (!Number.isFinite(parsed)) {
          errors.push(`\`${name}\` must be a whole number.`);
        } else {
          value = parsed;
        }

        break;
      }

      case ApplicationCommandOptionType.Number: {
        const parsed = Number(String(raw));

        if (!Number.isFinite(parsed)) {
          errors.push(`\`${name}\` must be a number.`);
        } else {
          value = parsed;
        }

        break;
      }

      case ApplicationCommandOptionType.Boolean: {
        const parsed = parseBoolean(raw);

        if (parsed === null) {
          errors.push(
            `\`${name}\` must be yes/no or true/false.`
          );
        } else {
          value = parsed;
        }

        break;
      }

      case ApplicationCommandOptionType.User:
        member = await resolveMember(guild, raw);
        user =
          member?.user
          || await resolveUser(guild, raw);

        if (!user) {
          errors.push(
            `I could not find the user for \`${name}\`: ${raw}`
          );
        }

        value = user?.id || raw;
        break;

      case ApplicationCommandOptionType.Channel:
        channel = await resolveChannel(guild, raw);

        if (!channel) {
          errors.push(
            `I could not find the channel for \`${name}\`: ${raw}`
          );
        }

        value = channel?.id || raw;
        break;

      case ApplicationCommandOptionType.Role:
        role = await resolveRole(guild, raw);

        if (!role) {
          errors.push(
            `I could not find the role for \`${name}\`: ${raw}`
          );
        }

        value = role?.id || raw;
        break;

      case ApplicationCommandOptionType.Mentionable:
        member = await resolveMember(guild, raw);

        if (member) {
          user = member.user;
          value = member.id;
        } else {
          role = await resolveRole(guild, raw);

          if (role) {
            value = role.id;
          } else {
            errors.push(
              `I could not find the mentionable for \`${name}\`: ${raw}`
            );
          }
        }

        break;

      case ApplicationCommandOptionType.Attachment:
        attachment = message.attachments.first() || null;

        if (!attachment) {
          errors.push(`Attach a file for \`${name}\`.`);
        }

        value = attachment?.id || raw;
        break;

      default:
        value = raw;
        break;
    }

    const record = {
      name,
      type: option.type,
      value,
      user,
      member,
      channel,
      role,
      attachment,
    };

    records.set(name, record);
    data.push(record);
  }

  function get(name, required = false) {
    const record =
      records.get(String(name || '').toLowerCase())
      || null;

    if (!record && required) {
      throw new Error(
        `Missing required option: ${name}`
      );
    }

    return record;
  }

  return {
    schema,
    errors,
    options: {
      data,

      getString: (name, required = false) => {
        const record = get(name, required);
        return record ? String(record.value) : null;
      },

      getInteger: (name, required = false) => {
        const record = get(name, required);
        return record
          ? Number.parseInt(record.value, 10)
          : null;
      },

      getNumber: (name, required = false) => {
        const record = get(name, required);
        return record ? Number(record.value) : null;
      },

      getBoolean: (name, required = false) => {
        const record = get(name, required);
        return record ? Boolean(record.value) : null;
      },

      getUser: (name, required = false) => {
        const record = get(name, required);
        return record?.user || record?.member?.user || null;
      },

      getMember: (name) =>
        get(name, false)?.member || null,

      getChannel: (name, required = false) =>
        get(name, required)?.channel || null,

      getRole: (name, required = false) =>
        get(name, required)?.role || null,

      getMentionable: (name, required = false) => {
        const record = get(name, required);
        return record?.member || record?.role || null;
      },

      getAttachment: (name, required = false) =>
        get(name, required)?.attachment || null,

      getSubcommand: () => null,
      getSubcommandGroup: () => null,
      get: (name) => get(name, false),
    },
  };
}

function normalizePayload(payload) {
  if (typeof payload === 'string') {
    return { content: payload };
  }

  const normalized = { ...(payload || {}) };

  delete normalized.ephemeral;
  delete normalized.flags;

  return normalized;
}

function createInteractionAdapter({
  message,
  commandName,
  options,
  targetChannel,
}) {
  const responseChannel = message.channel;
  let replyMessage = null;

  const interaction = {
    id: message.id,
    commandName,
    commandType: 1,
    guild: message.guild,
    guildId: message.guildId,
    channel: targetChannel,
    channelId: targetChannel.id,
    client: message.client,
    user: message.author,
    member: message.member,
    memberPermissions: message.member?.permissions || null,
    appPermissions:
      targetChannel.permissionsFor?.(message.client.user)
      || null,
    options,
    createdTimestamp: message.createdTimestamp,
    createdAt: message.createdAt,
    locale: 'en-US',
    guildLocale:
      message.guild?.preferredLocale
      || 'en-US',
    deferred: false,
    replied: false,

    inGuild: () => true,
    inCachedGuild: () => true,
    isChatInputCommand: () => true,
    isCommand: () => true,

    async reply(payload) {
      replyMessage =
        await responseChannel.send(
          normalizePayload(payload)
        );

      interaction.replied = true;

      return replyMessage;
    },

    async deferReply() {
      if (
        interaction.deferred
        || interaction.replied
      ) {
        return replyMessage;
      }

      replyMessage =
        await responseChannel.send({
          content: '\u23F3 Processing command...',
        });

      interaction.deferred = true;

      return replyMessage;
    },

    async editReply(payload) {
      const normalized =
        normalizePayload(payload);

      if (replyMessage?.editable) {
        const edited =
          await replyMessage.edit(normalized);

        interaction.replied = true;

        return edited;
      }

      replyMessage =
        await responseChannel.send(normalized);

      interaction.replied = true;

      return replyMessage;
    },

    async followUp(payload) {
      return responseChannel.send(
        normalizePayload(payload)
      );
    },

    async fetchReply() {
      return replyMessage;
    },

    async deleteReply() {
      if (replyMessage?.deletable) {
        await replyMessage
          .delete()
          .catch(() => null);
      }
    },

    async showModal() {
      return interaction.reply({
        content:
          '\u274C This command requires a Discord modal and cannot be completed through its ! version.',
      });
    },
  };

  return interaction;
}

async function handleRestrictedPrefixCommand(message) {
  if (
    !message?.guild
    || message.author?.bot
  ) {
    return false;
  }

  if (message.channelId !== COMMAND_CHANNEL_ID) {
    return false;
  }

  const content =
    String(message.content || '').trim();

  const match =
    content.match(/^!([A-Za-z0-9_-]+)/);

  if (!match) {
    return false;
  }

  const requestedName =
    String(match[1] || '').toLowerCase();

  if (!APPROVED.has(requestedName)) {
    return false;
  }

  if (
    !message.member?.roles?.cache?.has(
      ACCESS_ROLE_ID
    )
  ) {
    return true;
  }

  const actualName =
    COMMAND_ALIASES[requestedName]
    || requestedName;

  const command =
    message.client.commands.get(actualName);

  if (
    !command?.data
    || typeof command.execute !== 'function'
  ) {
    await message.reply(
      `\u274C The bot does not currently have a working slash command behind !${requestedName}.`
    ).catch(() => null);

    return true;
  }

  let rawArgs =
    content.slice(match[0].length).trim();

  const targetResult =
    extractTargetChannel(
      rawArgs,
      requestedName
    );

  rawArgs = targetResult.remaining;

  const parsedArgs =
    parseNamedArguments(rawArgs);

  let targetChannel = message.channel;

  if (targetResult.targetInput) {
    const resolved =
      await resolveChannel(
        message.guild,
        targetResult.targetInput
      );

    if (!resolved?.isTextBased?.()) {
      await message.reply(
        `\u274C I could not find the target text channel: ${targetResult.targetInput}`
      ).catch(() => null);

      return true;
    }

    targetChannel = resolved;
  }

  const built =
    await buildOptions(
      command,
      parsedArgs,
      message.guild,
      message
    );

  if (built.errors.length) {
    await message.reply({
      content:
        `\u274C ${built.errors.join('\n')}\n\n`
        + `Format:\n\`${usageFor(requestedName, built.schema)}\``,
    }).catch(() => null);

    return true;
  }

  const interaction =
    createInteractionAdapter({
      message,
      commandName: actualName,
      options: built.options,
      targetChannel,
    });

  const access =
    await enforceCommandAccess(interaction);

  if (!access.ok) {
    await auditCommand(
      interaction,
      'denied',
      {
        error: access.reason,
        source: 'restricted_prefix',
        requestedPrefixCommand:
          requestedName,
      }
    ).catch(() => null);

    await interaction.reply({
      content: `\u274C ${access.reason}`,
    }).catch(() => null);

    return true;
  }

  try {
    await command.execute(interaction);

    await auditCommand(
      interaction,
      'executed',
      {
        source: 'restricted_prefix',
        requestedPrefixCommand:
          requestedName,
      }
    ).catch(() => null);
  } catch (error) {
    console.error(
      `[PREFIX COMMAND] !${requestedName} failed:`,
      error
    );

    await auditCommand(
      interaction,
      'failed',
      {
        error:
          error?.message
          || String(error),
        source: 'restricted_prefix',
        requestedPrefixCommand:
          requestedName,
      }
    ).catch(() => null);

    const payload = {
      content:
        '\u274C That ! command failed safely. The error was added to the Operations Audit.',
    };

    if (
      interaction.deferred
      && !interaction.replied
    ) {
      await interaction
        .editReply(payload)
        .catch(() => null);
    } else if (
      interaction.replied
      || interaction.deferred
    ) {
      await interaction
        .followUp(payload)
        .catch(() => null);
    } else {
      await interaction
        .reply(payload)
        .catch(() => null);
    }
  }

  return true;
}

module.exports = {
  ACCESS_ROLE_ID,
  COMMAND_CHANNEL_ID,
  APPROVED,
  handleRestrictedPrefixCommand,
};
