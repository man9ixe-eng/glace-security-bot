'use strict';

const roles = require('../config/roles');
const { TIERS, OPS_LEVELS } = require('../config/access');

function normalizeRoleName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/<a?:\w+:\d+>/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getMemberRoleIds(member) {
  if (!member) return [];
  if (member.roles?.cache) return Array.from(member.roles.cache.keys()).map(String);
  if (Array.isArray(member.roles)) return member.roles.map(String);
  return [];
}

function getMemberRoleNames(member) {
  if (!member?.roles?.cache) return [];
  return Array.from(member.roles.cache.values())
    .map((role) => normalizeRoleName(role?.name))
    .filter(Boolean);
}

function hasAnyRole(member, roleIds = []) {
  const configured = new Set((roleIds || []).filter(Boolean).map(String));
  if (!configured.size) return false;
  return getMemberRoleIds(member).some((id) => configured.has(id));
}

function hasRoleName(member, matcherGroups = [], blockers = []) {
  const names = getMemberRoleNames(member);
  return names.some((name) => {
    if (['former', 'retired', 'alumni', 'resigned'].some((word) => name.includes(word))) return false;
    if (blockers.some((group) => group.every((word) => name.includes(word)))) return false;
    return matcherGroups.some((group) => group.every((word) => name.includes(word)));
  });
}

function isOwner(member) {
  if (!member) return false;
  if (member.guild && String(member.id) === String(member.guild.ownerId)) return true;
  return (roles.OWNER_IDS || []).map(String).includes(String(member.id));
}

function getTier(member) {
  if (!member) return TIERS.MEMBER;
  if (isOwner(member)) return TIERS.PRESIDENTIAL;

  let tier = TIERS.MEMBER;

  if (
    hasAnyRole(member, roles.JUNIOR_STAFF_ROLE_IDS) ||
    hasRoleName(member, [['junior', 'staff'], ['security'], ['custodian'], ['hotel', 'cook'], ['front', 'desk']])
  ) tier = Math.max(tier, TIERS.JUNIOR_STAFF);

  if (
    hasAnyRole(member, roles.INTERN_ROLE_IDS) ||
    hasRoleName(member, [['intern', 'team'], ['leadership', 'intern']], [['corporate', 'intern'], ['presidential', 'intern']])
  ) tier = Math.max(tier, TIERS.INTERN);

  if (
    hasAnyRole(member, roles.MANAGEMENT_ROLE_IDS) ||
    hasRoleName(member, [['management', 'team'], ['supervisor'], ['assistant', 'manager'], ['hotel', 'manager']], [['senior', 'management']])
  ) tier = Math.max(tier, TIERS.MANAGEMENT);

  if (
    hasAnyRole(member, roles.SENIOR_MANAGEMENT_ROLE_IDS) ||
    hasRoleName(member, [['senior', 'management'], ['executive', 'manager'], ['corporate', 'intern']])
  ) tier = Math.max(tier, TIERS.SENIOR_MANAGEMENT);

  if (
    hasAnyRole(member, roles.CORPORATE_ROLE_IDS) ||
    hasRoleName(member, [['corporate', 'team'], ['junior', 'corporate'], ['senior', 'corporate'], ['head', 'corporate']], [['corporate', 'intern'], ['corporate', 'board']])
  ) tier = Math.max(tier, TIERS.CORPORATE);

  if (
    hasAnyRole(member, roles.CORPORATE_BOARD_ROLE_IDS) ||
    hasRoleName(member, [['corporate', 'board'], ['board', 'director'], ['board', 'directors'], ['presidential', 'intern']])
  ) tier = Math.max(tier, TIERS.CORPORATE_BOARD);

  if (
    hasAnyRole(member, roles.PRESIDENTIAL_ROLE_IDS) ||
    hasRoleName(
      member,
      [['presidential', 'team'], ['chief', 'executive', 'officer'], ['vice', 'president'], ['president']],
      [['presidential', 'intern']],
    )
  ) tier = Math.max(tier, TIERS.PRESIDENTIAL);

  return tier;
}

function getTierLabel(tier) {
  switch (Number(tier)) {
    case TIERS.MEMBER: return 'Regular Member';
    case TIERS.JUNIOR_STAFF: return 'Junior Staff';
    case TIERS.INTERN: return 'Intern Team';
    case TIERS.MANAGEMENT: return 'Management';
    case TIERS.SENIOR_MANAGEMENT: return 'Senior Management';
    case TIERS.CORPORATE: return 'Corporate';
    case TIERS.CORPORATE_BOARD: return 'Corporate Board';
    case TIERS.PRESIDENTIAL: return 'Presidential';
    default: return `Unknown (Tier ${tier})`;
  }
}

function getOpsLevel(member) {
  const tier = getTier(member);
  if (tier >= TIERS.PRESIDENTIAL) return OPS_LEVELS.PRESIDENTIAL;
  if (tier >= TIERS.CORPORATE_BOARD) return OPS_LEVELS.CORPORATE_BOARD;
  if (tier >= TIERS.CORPORATE) return OPS_LEVELS.CORPORATE;
  if (tier >= TIERS.SENIOR_MANAGEMENT) return OPS_LEVELS.SENIOR_MANAGEMENT;
  if (tier >= TIERS.INTERN) return OPS_LEVELS.INTERN_MANAGEMENT;
  return OPS_LEVELS.NONE;
}

function getOpsLabel(level) {
  switch (Number(level)) {
    case OPS_LEVELS.INTERN_MANAGEMENT: return 'Intern Team / Management';
    case OPS_LEVELS.SENIOR_MANAGEMENT: return 'Senior Management';
    case OPS_LEVELS.CORPORATE: return 'Corporate';
    case OPS_LEVELS.CORPORATE_BOARD: return 'Corporate Board';
    case OPS_LEVELS.PRESIDENTIAL: return 'Presidential';
    default: return 'No Operations Access';
  }
}

function atLeastTier(member, requiredTier) {
  return getTier(member) >= Number(requiredTier || TIERS.MEMBER);
}

function outranks(actor, target, { allowEqual = false } = {}) {
  if (!actor || !target) return false;
  if (isOwner(actor)) return true;
  const actorTier = getTier(actor);
  const targetTier = getTier(target);
  return allowEqual ? actorTier >= targetTier : actorTier > targetTier;
}

function isRegular(member) { return getTier(member) === TIERS.MEMBER; }
function isJuniorStaff(member) { return getTier(member) === TIERS.JUNIOR_STAFF; }
function isIntern(member) { return getTier(member) === TIERS.INTERN; }
function isManagement(member) { return getTier(member) === TIERS.MANAGEMENT; }
function isSeniorManagement(member) { return getTier(member) === TIERS.SENIOR_MANAGEMENT; }
function isCorporate(member) { return getTier(member) === TIERS.CORPORATE; }
function isCorporateBoard(member) { return getTier(member) === TIERS.CORPORATE_BOARD; }
function isPresidential(member) { return getTier(member) === TIERS.PRESIDENTIAL; }

module.exports = {
  TIERS,
  OPS_LEVELS,
  normalizeRoleName,
  getMemberRoleIds,
  getMemberRoleNames,
  hasAnyRole,
  hasRoleName,
  isOwner,
  getTier,
  getTierLabel,
  getOpsLevel,
  getOpsLabel,
  atLeastTier,
  outranks,
  isRegular,
  isJuniorStaff,
  isIntern,
  isManagement,
  isSeniorManagement,
  isCorporate,
  isCorporateBoard,
  isPresidential,
};
