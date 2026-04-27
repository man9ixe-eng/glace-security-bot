// src/commands/staff/promotion.js
// /promotion — team + ticket role updater for Glace Hotels.

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const rolesConfig = require('../../config/roles');
const { hasAnyRole } = require('../../utils/permissions');

const TEAM_RANKS = {
  intern: {
    label: 'Intern',
    teamIdsKey: 'INTERN_ROLE_IDS',
    teamNameMatchers: [['intern']],
    excludeTargetKeywords: ['corporate'],
    requiredLevel: 6,
    ticketLabel: 'Ticket Intern',
    ticketEnvNames: ['TICKET_ROLE_INTERN_ID', 'TICKET_ROLE_TRIAL_ID'],
    ticketNameMatchers: [['ticket', 'intern'], ['ticket', 'trial']],
  },
  management: {
    label: 'Management',
    teamIdsKey: 'MANAGEMENT_ROLE_IDS',
    teamNameMatchers: [['management']],
    excludeTargetKeywords: ['senior'],
    requiredLevel: 6,
    ticketLabel: 'Ticket Mod',
    ticketEnvNames: ['TICKET_ROLE_MOD_ID'],
    ticketNameMatchers: [['ticket', 'mod'], ['ticket', 'moderator']],
  },
  senior_management: {
    label: 'Senior Management',
    teamIdsKey: 'SENIOR_MANAGEMENT_ROLE_IDS',
    teamNameMatchers: [['senior', 'management']],
    requiredLevel: 6,
    ticketLabel: 'Ticket Admin',
    ticketEnvNames: ['TICKET_ROLE_ADMIN_ID'],
    ticketNameMatchers: [['ticket', 'admin']],
  },
  corporate: {
    label: 'Corporate',
    teamIdsKey: 'CORPORATE_ROLE_IDS',
    teamNameMatchers: [['corporate']],
    excludeTargetKeywords: ['intern', 'board', 'directors'],
    requiredLevel: 7,
    ticketLabel: 'Ticket Reviewer',
    ticketEnvNames: ['TICKET_ROLE_REVIEWER_ID'],
    ticketNameMatchers: [['ticket', 'reviewer']],
  },
  corporate_board: {
    label: 'Corporate Board',
    teamIdsKey: 'CORPORATE_BOARD_ROLE_IDS',
    teamNameMatchers: [['corporate', 'board'], ['board', 'directors']],
    requiredLevel: 7,
    ticketLabel: 'Ticket Chief',
    ticketEnvNames: ['TICKET_ROLE_CHIEF_ID'],
    ticketNameMatchers: [['ticket', 'chief']],
  },
  presidential: {
    label: 'Presidential',
    teamIdsKey: 'PRESIDENTIAL_ROLE_IDS',
    teamNameMatchers: [['presidential']],
    excludeTargetKeywords: ['intern'],
    requiredLevel: 7,
    ticketLabel: 'Ticket Chief',
    ticketEnvNames: ['TICKET_ROLE_CHIEF_ID'],
    ticketNameMatchers: [['ticket', 'chief']],
  },
};

const TEAM_REMOVE_KEYS = [
  'JUNIOR_STAFF_ROLE_IDS',
  'INTERN_ROLE_IDS',
  'MANAGEMENT_ROLE_IDS',
  'SENIOR_MANAGEMENT_ROLE_IDS',
  'CORPORATE_ROLE_IDS',
  'CORPORATE_BOARD_ROLE_IDS',
  'PRESIDENTIAL_ROLE_IDS',
];

const TEAM_REMOVE_MATCHERS = [
  ['junior', 'staff'],
  ['intern'],
  ['management'],
  ['senior', 'management'],
  ['corporate'],
  ['corporate', 'board'],
  ['board', 'directors'],
  ['presidential'],
];

const TICKET_REMOVE_ENV_NAMES = [
  'TICKET_ROLE_INTERN_ID',
  'TICKET_ROLE_TRIAL_ID',
  'TICKET_ROLE_MOD_ID',
  'TICKET_ROLE_ADMIN_ID',
  'TICKET_ROLE_REVIEWER_ID',
  'TICKET_ROLE_CHIEF_ID',
];

const TICKET_REMOVE_MATCHERS = [
  ['ticket', 'intern'],
  ['ticket', 'trial'],
  ['ticket', 'mod'],
  ['ticket', 'moderator'],
  ['ticket', 'admin'],
  ['ticket', 'reviewer'],
  ['ticket', 'chief'],
];

function configuredIdsForKey(key) {
  const value = rolesConfig[key];
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [];
}

function envIds(names = []) {
  return names
    .map((name) => process.env[name])
    .filter(Boolean)
    .map(String);
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/<a?:\w+:\d+>/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function roleMatches(role, matchers, { requireTeam = false } = {}) {
  const name = normalizeName(role?.name);
  if (!name) return false;
  if (name.includes('former') || name.includes('retired') || name.includes('alumni')) return false;
  if (requireTeam && !name.includes('team')) return false;

  return matchers.some((keywords) => keywords.every((keyword) => name.includes(keyword)));
}

function uniqueRoles(roles) {
  const seen = new Set();
  return roles.filter((role) => {
    if (!role || seen.has(role.id)) return false;
    seen.add(role.id);
    return true;
  });
}

function findRolesByIdsAndNames(guild, ids = [], matchers = [], opts = {}) {
  const roleIds = new Set(ids.filter(Boolean).map(String));
  const found = [];

  for (const role of guild.roles.cache.values()) {
    if (roleIds.has(role.id) || roleMatches(role, matchers, opts)) {
      found.push(role);
    }
  }

  return uniqueRoles(found);
}

function getActorLevel(member) {
  if (!member || !member.guild) return 0;

  if (member.id === member.guild.ownerId) return 7;
  if (Array.isArray(rolesConfig.OWNER_IDS) && rolesConfig.OWNER_IDS.includes(member.id)) return 7;

  const roleNames = [...member.roles.cache.values()].map((role) => normalizeName(role.name));
  const hasTeamName = (keywords) =>
    roleNames.some((name) => {
      if (!name.includes('team')) return false;
      if (name.includes('former') || name.includes('retired') || name.includes('alumni')) return false;
      return keywords.every((keyword) => name.includes(keyword));
    });

  if (hasAnyRole(member, rolesConfig.PRESIDENTIAL_ROLE_IDS || []) || hasTeamName(['presidential'])) return 7;

  if (
    hasAnyRole(member, rolesConfig.CORPORATE_BOARD_ROLE_IDS || []) ||
    hasAnyRole(member, rolesConfig.CORPORATE_ROLE_IDS || []) ||
    hasTeamName(['corporate']) ||
    hasTeamName(['corporate', 'board']) ||
    hasTeamName(['board', 'directors'])
  ) {
    return 6;
  }

  return 0;
}

function roleMentionList(roles) {
  return roles.length ? roles.map((role) => `<@&${role.id}>`).join(', ') : 'None';
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('promotion')
    .setDescription('Update a member\'s team role and matching ticket role.')
    .setDMPermission(false)
    .addUserOption((option) =>
      option
        .setName('username')
        .setDescription('Member to update')
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('rank')
        .setDescription('New team rank')
        .setRequired(true)
        .addChoices(
          { name: 'Intern', value: 'intern' },
          { name: 'Management', value: 'management' },
          { name: 'Senior Management', value: 'senior_management' },
          { name: 'Corporate', value: 'corporate' },
          { name: 'Corporate Board', value: 'corporate_board' },
          { name: 'Presidential', value: 'presidential' },
        ),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const target = interaction.options.getMember('username');
    const rankKey = interaction.options.getString('rank', true);
    const rank = TEAM_RANKS[rankKey];

    if (!target || !rank) {
      await interaction.editReply('❌ I could not find that member or rank.');
      return;
    }

    const actorLevel = getActorLevel(interaction.member);
    if (actorLevel < rank.requiredLevel) {
      await interaction.editReply(
        rank.requiredLevel >= 7
          ? '❌ Only Presidential+ can add Corporate, Corporate Board, or Presidential team roles.'
          : '❌ Only Corporate+ can add Intern, Management, or Senior Management team roles.',
      );
      return;
    }

    const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.editReply('❌ I need the **Manage Roles** permission to update roles.');
      return;
    }

    const teamRemoveIds = TEAM_REMOVE_KEYS.flatMap(configuredIdsForKey);
    const ticketRemoveIds = envIds(TICKET_REMOVE_ENV_NAMES);

    const teamRolesToRemove = target.roles.cache.filter((role) =>
      teamRemoveIds.includes(role.id) || roleMatches(role, TEAM_REMOVE_MATCHERS, { requireTeam: true }),
    );

    const ticketRolesToRemove = target.roles.cache.filter((role) =>
      ticketRemoveIds.includes(role.id) || roleMatches(role, TICKET_REMOVE_MATCHERS),
    );

    let targetTeamRoles = findRolesByIdsAndNames(
      interaction.guild,
      configuredIdsForKey(rank.teamIdsKey),
      rank.teamNameMatchers,
      { requireTeam: true },
    );

    if (Array.isArray(rank.excludeTargetKeywords) && rank.excludeTargetKeywords.length) {
      targetTeamRoles = targetTeamRoles.filter((role) => {
        const name = normalizeName(role.name);
        return !rank.excludeTargetKeywords.some((keyword) => name.includes(keyword));
      });
    }

    const targetTicketRoles = findRolesByIdsAndNames(
      interaction.guild,
      envIds(rank.ticketEnvNames),
      rank.ticketNameMatchers,
    );

    if (!targetTeamRoles.length) {
      await interaction.editReply(
        `❌ I could not find the **${rank.label} Team** role. Add the role ID in \`src/config/roles.js\` or make sure the role name includes “${rank.label} Team”.`,
      );
      return;
    }

    if (!targetTicketRoles.length) {
      await interaction.editReply(
        `❌ I could not find the **${rank.ticketLabel}** role. Add the matching env var (${rank.ticketEnvNames.join(' or ')}) or make sure the Discord role is named **${rank.ticketLabel}**.`,
      );
      return;
    }

    const removeRoles = uniqueRoles([...teamRolesToRemove.values(), ...ticketRolesToRemove.values()])
      .filter((role) => !targetTeamRoles.some((targetRole) => targetRole.id === role.id))
      .filter((role) => !targetTicketRoles.some((targetRole) => targetRole.id === role.id));

    const addRoles = uniqueRoles([...targetTeamRoles, ...targetTicketRoles]);

    const manageableProblem = [...removeRoles, ...addRoles].find(
      (role) => role.managed || role.position >= botMember.roles.highest.position,
    );

    if (manageableProblem) {
      await interaction.editReply(
        `❌ I cannot manage **${manageableProblem.name}**. Move my bot role above that role in the role list, then try again.`,
      );
      return;
    }

    const reason = `/promotion used by ${interaction.user.tag} (${interaction.user.id})`;

    if (removeRoles.length) {
      await target.roles.remove(removeRoles, reason);
    }

    await target.roles.add(addRoles, reason);

    await interaction.editReply(
      [
        `✅ Updated ${target} to **${rank.label}**.`,
        '',
        `Removed old team/ticket roles: ${roleMentionList(removeRoles)}`,
        `Added team role: ${roleMentionList(targetTeamRoles)}`,
        `Added ticket role: ${roleMentionList(targetTicketRoles)}`,
      ].join('\n'),
    );
  },
};
