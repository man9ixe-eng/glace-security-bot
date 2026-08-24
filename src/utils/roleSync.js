'use strict';

const rolesConfig = require('../config/roles');

const GLACE_FAMILY_DELAY_MS = 24 * 60 * 60 * 1000;
const TARGET_GUILD_ID = String(process.env.GUILD_ID || '').trim();

const familyTimers = new Map();
const syncInFlight = new Set();
const warned = new Set();

function normalizeRoleName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/<a?:\w+:\d+>/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function envRoleIds(...names) {
  return names.flatMap((name) => String(process.env[name] || '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^\d{10,25}$/.test(id)));
}

function configuredIds(key) {
  const value = rolesConfig[key];
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean).map(String))];
}

function roleIdSetFor(...keys) {
  return new Set(unique(keys.flatMap(configuredIds)));
}

const STAFF_GROUPS = Object.freeze([
  {
    key: 'junior_staff',
    label: 'Junior Staff',
    rankIds: unique([
      ...configuredIds('SECURITY_ROLE_IDS'),
      ...configuredIds('CUSTODIAN_ROLE_IDS'),
      ...configuredIds('HOTEL_COOK_ROLE_IDS'),
      ...configuredIds('FRONT_DESK_ROLE_IDS'),
    ]),
    rankNames: ['security', 'custodian', 'hotel cook', 'front desk'],
    teamIds: configuredIds('JUNIOR_STAFF_ROLE_IDS'),
    teamNames: ['junior staff'],
    // Junior Staff do not receive a ticket role.
    ticketEnvNames: [],
    ticketNames: [],
  },
  {
    key: 'intern',
    label: 'Intern Team',
    rankIds: configuredIds('LEADERSHIP_INTERN_RANK_ROLE_IDS'),
    rankNames: ['leadership intern'],
    teamIds: configuredIds('INTERN_ROLE_IDS'),
    teamNames: ['intern team'],
    // Leadership Interns receive Ticket Trial.
    ticketEnvNames: ['TICKET_ROLE_TRIAL_ID'],
    ticketNames: ['ticket trial'],
  },
  {
    key: 'management',
    label: 'Management Team',
    rankIds: unique([
      ...configuredIds('SUPERVISOR_ROLE_IDS'),
      ...configuredIds('ASSISTANT_MANAGER_ROLE_IDS'),
      ...configuredIds('HOTEL_MANAGER_ROLE_IDS'),
    ]),
    rankNames: ['supervisor', 'assistant manager', 'hotel manager'],
    teamIds: configuredIds('MANAGEMENT_ROLE_IDS'),
    teamNames: ['management team'],
    ticketEnvNames: ['TICKET_ROLE_MOD_ID'],
    ticketNames: ['ticket mod', 'ticket moderator'],
  },
  {
    key: 'senior_management',
    label: 'Senior Management Team',
    rankIds: unique([
      ...configuredIds('EXECUTIVE_MANAGER_ROLE_IDS'),
      ...configuredIds('CORPORATE_INTERN_RANK_ROLE_IDS'),
    ]),
    rankNames: ['executive manager', 'corporate intern'],
    teamIds: configuredIds('SENIOR_MANAGEMENT_ROLE_IDS'),
    teamNames: ['senior management team', 'senior management'],
    ticketEnvNames: ['TICKET_ROLE_ADMIN_ID'],
    ticketNames: ['ticket admin'],
  },
  {
    key: 'corporate',
    label: 'Corporate Team',
    rankIds: unique([
      ...configuredIds('JUNIOR_CORPORATE_ROLE_IDS'),
      ...configuredIds('SENIOR_CORPORATE_ROLE_IDS'),
      ...configuredIds('HEAD_CORPORATE_ROLE_IDS'),
    ]),
    rankNames: ['junior corporate', 'senior corporate', 'head corporate'],
    teamIds: configuredIds('CORPORATE_ROLE_IDS'),
    teamNames: ['corporate team'],
    ticketEnvNames: ['TICKET_ROLE_REVIEWER_ID'],
    ticketNames: ['ticket reviewer'],
  },
  {
    key: 'corporate_board',
    label: 'Corporate Board Team',
    rankIds: unique([
      ...configuredIds('BOARD_OF_DIRECTOR_RANK_ROLE_IDS'),
      ...configuredIds('PRESIDENTIAL_INTERN_RANK_ROLE_IDS'),
    ]),
    rankNames: ['board of director', 'board of directors', 'presidential intern'],
    teamIds: configuredIds('CORPORATE_BOARD_ROLE_IDS'),
    teamNames: ['corporate board team', 'corporate board'],
    ticketEnvNames: ['TICKET_ROLE_CHIEF_ID'],
    ticketNames: ['ticket chief'],
  },
  {
    key: 'presidential',
    label: 'Presidential Team',
    rankIds: unique([
      ...configuredIds('CHIEF_EXECUTIVE_OFFICER_ROLE_IDS'),
      ...configuredIds('VICE_PRESIDENT_ROLE_IDS'),
      ...configuredIds('PRESIDENT_ROLE_IDS'),
    ]),
    rankNames: ['chief executive officer', 'vice president', 'president'],
    teamIds: configuredIds('PRESIDENTIAL_ROLE_IDS'),
    teamNames: ['presidential team'],
    ticketEnvNames: ['TICKET_ROLE_CHIEF_ID'],
    ticketNames: ['ticket chief'],
  },
]);

const ALL_TEAM_ROLE_IDS = roleIdSetFor(
  'JUNIOR_STAFF_ROLE_IDS',
  'INTERN_ROLE_IDS',
  'MANAGEMENT_ROLE_IDS',
  'SENIOR_MANAGEMENT_ROLE_IDS',
  'CORPORATE_ROLE_IDS',
  'CORPORATE_BOARD_ROLE_IDS',
  'PRESIDENTIAL_ROLE_IDS',
);

const ALL_TEAM_ROLE_NAMES = new Set(STAFF_GROUPS.flatMap((group) => group.teamNames));

const ALL_TICKET_ENV_NAMES = [
  'TICKET_ROLE_INTERN_ID',
  'TICKET_ROLE_TRIAL_ID',
  'TICKET_ROLE_MOD_ID',
  'TICKET_ROLE_ADMIN_ID',
  'TICKET_ROLE_REVIEWER_ID',
  'TICKET_ROLE_CHIEF_ID',
];
const ALL_TICKET_ROLE_IDS = new Set(envRoleIds(...ALL_TICKET_ENV_NAMES));
const ALL_TICKET_ROLE_NAMES = new Set([
  'ticket intern',
  'ticket trial',
  'ticket mod',
  'ticket moderator',
  'ticket admin',
  'ticket reviewer',
  'ticket chief',
]);

function isTargetGuild(guild) {
  if (!guild) return false;
  return !TARGET_GUILD_ID || String(guild.id) === TARGET_GUILD_ID;
}

function memberRoleIds(member) {
  return new Set([...(member?.roles?.cache?.keys?.() || [])].map(String));
}

function memberRoleNames(member) {
  return new Set([...(member?.roles?.cache?.values?.() || [])].map((role) => normalizeRoleName(role?.name)).filter(Boolean));
}

function memberMatchesGroup(member, group) {
  const ids = memberRoleIds(member);
  if (group.rankIds.some((id) => ids.has(String(id)))) return true;

  const names = memberRoleNames(member);
  return group.rankNames.some((name) => names.has(name));
}

function getTargetStaffGroup(member) {
  // Highest rank wins if Bloxlink briefly leaves multiple rank roles during a sync.
  for (let index = STAFF_GROUPS.length - 1; index >= 0; index -= 1) {
    const group = STAFF_GROUPS[index];
    if (memberMatchesGroup(member, group)) return group;
  }
  return null;
}

function getGuildRole(guild, id) {
  if (!guild || !id) return null;
  return guild.roles.cache.get(String(id)) || null;
}

function resolveFirstExistingRole(guild, ids = [], exactNames = []) {
  for (const id of unique(ids)) {
    const role = getGuildRole(guild, id);
    if (role) return role;
  }

  const wantedNames = new Set(exactNames.map(normalizeRoleName));
  if (!wantedNames.size) return null;
  return [...guild.roles.cache.values()].find((role) => wantedNames.has(normalizeRoleName(role.name))) || null;
}

function resolveTeamRole(guild, group) {
  return resolveFirstExistingRole(guild, group?.teamIds || [], group?.teamNames || []);
}

function resolveTicketRole(guild, group) {
  if (!group) return null;

  // Environment variables are ordered by preference. For Intern, this means
  // TICKET_ROLE_INTERN_ID first and TICKET_ROLE_TRIAL_ID only as a fallback.
  for (const envName of group.ticketEnvNames || []) {
    const role = resolveFirstExistingRole(guild, envRoleIds(envName), []);
    if (role) return role;
  }

  // Name fallback keeps the bot functional if an env value was forgotten.
  // The order mirrors the preferred env order.
  for (const name of group.ticketNames || []) {
    const role = resolveFirstExistingRole(guild, [], [name]);
    if (role) return role;
  }

  return null;
}

function isManagedTeamRole(role) {
  if (!role) return false;
  return ALL_TEAM_ROLE_IDS.has(String(role.id)) || ALL_TEAM_ROLE_NAMES.has(normalizeRoleName(role.name));
}

function isManagedTicketRole(role) {
  if (!role) return false;
  return ALL_TICKET_ROLE_IDS.has(String(role.id)) || ALL_TICKET_ROLE_NAMES.has(normalizeRoleName(role.name));
}

function canManageRole(guild, role) {
  if (!guild || !role || role.managed) return false;
  const botMember = guild.members.me;
  if (!botMember) return false;
  return role.position < botMember.roles.highest.position;
}

function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

async function addRoleSafe(member, role, reason) {
  if (!member || !role || member.roles.cache.has(role.id)) return false;
  if (!canManageRole(member.guild, role)) {
    warnOnce(
      `unmanageable:add:${member.guild.id}:${role.id}`,
      `[ROLE SYNC] Cannot add ${role.name} (${role.id}). Move the bot role above it and make sure the bot has Manage Roles.`,
    );
    return false;
  }
  await member.roles.add(role, reason);
  return true;
}

async function removeRoleSafe(member, role, reason) {
  if (!member || !role || !member.roles.cache.has(role.id)) return false;
  if (!canManageRole(member.guild, role)) {
    warnOnce(
      `unmanageable:remove:${member.guild.id}:${role.id}`,
      `[ROLE SYNC] Cannot remove ${role.name} (${role.id}). Move the bot role above it and make sure the bot has Manage Roles.`,
    );
    return false;
  }
  await member.roles.remove(role, reason);
  return true;
}

async function syncStaffRoles(member, { reason = 'Automatic Glace rank/team sync' } = {}) {
  if (!member || member.user?.bot || !isTargetGuild(member.guild)) {
    return { changed: false, target: null, added: [], removed: [] };
  }

  const lockKey = `${member.guild.id}:${member.id}`;
  if (syncInFlight.has(lockKey)) return { changed: false, target: null, added: [], removed: [], skipped: 'in-flight' };
  syncInFlight.add(lockKey);

  try {
    const targetGroup = getTargetStaffGroup(member);
    const desiredTeamRole = targetGroup ? resolveTeamRole(member.guild, targetGroup) : null;
    const desiredTicketRole = targetGroup ? resolveTicketRole(member.guild, targetGroup) : null;

    if (targetGroup && !desiredTeamRole) {
      warnOnce(
        `missing-team:${member.guild.id}:${targetGroup.key}`,
        `[ROLE SYNC] Could not find the ${targetGroup.label} role. Check the configured team-role ID.`,
      );
    }

    if (targetGroup && !desiredTicketRole) {
      warnOnce(
        `missing-ticket:${member.guild.id}:${targetGroup.key}`,
        `[ROLE SYNC] Could not find a ticket role for ${targetGroup.label}. Checked ${targetGroup.ticketEnvNames.join(' -> ')} and role-name fallbacks.`,
      );
    }

    const currentRoles = [...member.roles.cache.values()];
    const teamRolesToRemove = currentRoles.filter((role) =>
      isManagedTeamRole(role) && (!desiredTeamRole || role.id !== desiredTeamRole.id));
    const ticketRolesToRemove = currentRoles.filter((role) =>
      isManagedTicketRole(role) && (!desiredTicketRole || role.id !== desiredTicketRole.id));

    const removed = [];
    const added = [];

    for (const role of [...teamRolesToRemove, ...ticketRolesToRemove]) {
      try {
        if (await removeRoleSafe(member, role, reason)) removed.push(role.id);
      } catch (error) {
        console.error(`[ROLE SYNC] Failed removing ${role.name} from ${member.user?.tag || member.id}:`, error.message || error);
      }
    }

    // Refresh the member after removals before adding the desired roles. Discord.js
    // updates cache during role mutations, so this stays idempotent on update events.
    for (const role of [desiredTeamRole, desiredTicketRole].filter(Boolean)) {
      try {
        if (await addRoleSafe(member, role, reason)) added.push(role.id);
      } catch (error) {
        console.error(`[ROLE SYNC] Failed adding ${role.name} to ${member.user?.tag || member.id}:`, error.message || error);
      }
    }

    if (added.length || removed.length) {
      console.log(
        `[ROLE SYNC] ${member.user?.tag || member.id}: ${targetGroup?.label || 'No staff rank'} | ` +
        `added=${added.length ? added.join(',') : 'none'} removed=${removed.length ? removed.join(',') : 'none'}`,
      );
    }

    return {
      changed: Boolean(added.length || removed.length),
      target: targetGroup?.key || null,
      added,
      removed,
    };
  } finally {
    syncInFlight.delete(lockKey);
  }
}

function getFamilyRole(guild) {
  return resolveFirstExistingRole(guild, configuredIds('GLACE_FAMILY_ROLE_IDS'), ['glace family']);
}

function familyEligibleAt(member) {
  const joinedAt = Number(member?.joinedTimestamp || 0);
  return joinedAt > 0 ? joinedAt + GLACE_FAMILY_DELAY_MS : null;
}

async function ensureGlaceFamily(member, { reason = '24-hour Glace Family membership requirement met' } = {}) {
  if (!member || member.user?.bot || !isTargetGuild(member.guild)) return { changed: false, eligible: false };

  const eligibleAt = familyEligibleAt(member);
  if (!eligibleAt || Date.now() < eligibleAt) return { changed: false, eligible: false, eligibleAt };

  const role = getFamilyRole(member.guild);
  if (!role) {
    warnOnce(
      `missing-family:${member.guild.id}`,
      '[GLACE FAMILY] Could not find the Glace Family role. Check GLACE_FAMILY_ROLE_ID / configured role ID.',
    );
    return { changed: false, eligible: true, missingRole: true };
  }

  if (member.roles.cache.has(role.id)) return { changed: false, eligible: true, roleId: role.id };

  try {
    const changed = await addRoleSafe(member, role, reason);
    if (changed) console.log(`[GLACE FAMILY] Added ${role.name} to ${member.user?.tag || member.id} after 24 hours.`);
    return { changed, eligible: true, roleId: role.id };
  } catch (error) {
    console.error(`[GLACE FAMILY] Failed to add role to ${member.user?.tag || member.id}:`, error.message || error);
    return { changed: false, eligible: true, error };
  }
}

function cancelFamilyTimer(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const existing = familyTimers.get(key);
  if (existing) clearTimeout(existing);
  familyTimers.delete(key);
}

function scheduleGlaceFamily(member) {
  if (!member || member.user?.bot || !isTargetGuild(member.guild)) return;

  cancelFamilyTimer(member.guild.id, member.id);

  const eligibleAt = familyEligibleAt(member);
  if (!eligibleAt) return;
  const remaining = eligibleAt - Date.now();

  if (remaining <= 0) {
    ensureGlaceFamily(member).catch((error) => console.error('[GLACE FAMILY] Immediate eligibility check failed:', error));
    return;
  }

  const key = `${member.guild.id}:${member.id}`;
  const timer = setTimeout(async () => {
    familyTimers.delete(key);
    try {
      const fresh = await member.guild.members.fetch(member.id).catch(() => null);
      if (fresh) await ensureGlaceFamily(fresh);
    } catch (error) {
      console.error('[GLACE FAMILY] Scheduled 24-hour grant failed:', error);
    }
  }, remaining + 1000);

  // The Discord connection keeps the process alive; this timer should not block shutdown.
  timer.unref?.();
  familyTimers.set(key, timer);
}

async function reconcileGuildRoles(guild, { includeFamilyScheduling = true } = {}) {
  if (!guild || !isTargetGuild(guild)) return { members: 0, staffChanges: 0, familyChanges: 0 };

  let members;
  try {
    members = await guild.members.fetch();
  } catch (error) {
    console.error(`[ROLE SYNC] Could not fetch members for ${guild.name}:`, error.message || error);
    return { members: 0, staffChanges: 0, familyChanges: 0, error };
  }

  let staffChanges = 0;
  let familyChanges = 0;

  for (const member of members.values()) {
    if (member.user?.bot) continue;

    try {
      const staffResult = await syncStaffRoles(member, { reason: 'Glace automatic role reconciliation' });
      if (staffResult.changed) staffChanges += 1;
    } catch (error) {
      console.error(`[ROLE SYNC] Staff reconciliation failed for ${member.id}:`, error.message || error);
    }

    try {
      const familyResult = await ensureGlaceFamily(member);
      if (familyResult.changed) familyChanges += 1;
      if (includeFamilyScheduling && !familyResult.eligible) scheduleGlaceFamily(member);
    } catch (error) {
      console.error(`[GLACE FAMILY] Reconciliation failed for ${member.id}:`, error.message || error);
    }
  }

  console.log(
    `[ROLE SYNC] Reconciled ${members.size} member(s) in ${guild.name}. ` +
    `Staff role changes=${staffChanges}; Glace Family grants=${familyChanges}.`,
  );

  return { members: members.size, staffChanges, familyChanges };
}

async function reconcileAllGuilds(client, options = {}) {
  if (!client?.isReady?.()) return [];

  const guilds = TARGET_GUILD_ID
    ? [client.guilds.cache.get(TARGET_GUILD_ID) || await client.guilds.fetch(TARGET_GUILD_ID).catch(() => null)].filter(Boolean)
    : [...client.guilds.cache.values()];

  const results = [];
  for (const guild of guilds) results.push(await reconcileGuildRoles(guild, options));
  return results;
}

function clearRoleSyncTimers() {
  for (const timer of familyTimers.values()) clearTimeout(timer);
  familyTimers.clear();
}

module.exports = {
  GLACE_FAMILY_DELAY_MS,
  STAFF_GROUPS,
  normalizeRoleName,
  getTargetStaffGroup,
  syncStaffRoles,
  ensureGlaceFamily,
  scheduleGlaceFamily,
  cancelFamilyTimer,
  reconcileGuildRoles,
  reconcileAllGuilds,
  clearRoleSyncTimers,
};
