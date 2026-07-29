'use strict';

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = { groupId: null, fetchedAt: 0, members: [], roles: [], error: null };

function clean(value, max = 300) { return String(value ?? '').trim().slice(0, max); }
function normalize(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function tierForRank(rankName) {
  const n = normalize(rankName);
  if (!n) return 0;
  if (n === 'president' || n.includes('vice president') || n === 'ceo' || n.includes('chief executive officer')) return 8;
  if (n.includes('board of director') || n.includes('presidential intern') || n.includes('corporate board')) return 7;
  if (n.includes('junior corporate') || n.includes('senior corporate') || n.includes('head corporate') || n === 'corporate') return 6;
  if (n.includes('executive manager') || n.includes('corporate intern') || n.includes('senior management')) return 5;
  if (n === 'supervisor' || n.includes('assistant manager') || n.includes('hotel manager') || n === 'management') return 4;
  if (n.includes('leadership intern') || n === 'intern' || n.includes('intern team')) return 3;
  return 0;
}
function tierLabel(tier) {
  return ({ 3: 'Intern Team', 4: 'Management', 5: 'Senior Management', 6: 'Corporate', 7: 'Corporate Board', 8: 'Presidential' })[Number(tier)] || 'Unmapped';
}
async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}
async function fetchRoleMembers(groupId, role) {
  const results = [];
  let cursor = '';
  do {
    const url = new URL(`https://groups.roblox.com/v1/groups/${groupId}/roles/${role.id}/users`);
    url.searchParams.set('limit', '100');
    url.searchParams.set('sortOrder', 'Asc');
    if (cursor) url.searchParams.set('cursor', cursor);
    const page = await fetchJson(url);
    for (const row of Array.isArray(page?.data) ? page.data : []) {
      const user = row?.user || row;
      const userId = clean(user?.userId || user?.id, 40);
      if (!userId) continue;
      results.push({
        robloxUserId: userId,
        robloxUsername: clean(user?.username || user?.name, 100),
        robloxDisplayName: clean(user?.displayName || user?.display_name || user?.username || user?.name, 100),
        rankId: String(role.id),
        rankNumber: Number(role.rank) || 0,
        rankName: clean(role.name, 100),
        tier: tierForRank(role.name),
        tierLabel: tierLabel(tierForRank(role.name)),
      });
    }
    cursor = clean(page?.nextPageCursor, 500);
  } while (cursor);
  return results;
}
async function listRobloxStaff({ force = false } = {}) {
  const groupId = clean(process.env.ROBLOX_GROUP_ID || process.env.ROBLOX_COMMUNITY_ID, 40);
  if (!groupId) return { configured: false, groupId: null, members: [], roles: [], error: 'ROBLOX_GROUP_ID is not configured.' };
  if (!force && cache.groupId === groupId && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return { configured: true, ...cache };
  try {
    const roleResponse = await fetchJson(`https://groups.roblox.com/v1/groups/${groupId}/roles`);
    const roles = (Array.isArray(roleResponse?.roles) ? roleResponse.roles : [])
      .map((role) => ({ id: String(role.id), name: clean(role.name, 100), rank: Number(role.rank) || 0, tier: tierForRank(role.name) }))
      .filter((role) => role.tier >= 3)
      .sort((a, b) => b.rank - a.rank);
    const members = [];
    for (const role of roles) {
      const roleMembers = await fetchRoleMembers(groupId, role);
      members.push(...roleMembers);
    }
    members.sort((a, b) => b.tier - a.tier || b.rankNumber - a.rankNumber || a.robloxUsername.localeCompare(b.robloxUsername));
    cache = { groupId, fetchedAt: Date.now(), members, roles, error: null };
    return { configured: true, ...cache };
  } catch (error) {
    cache = { groupId, fetchedAt: Date.now(), members: [], roles: [], error: error?.message || String(error) };
    return { configured: true, ...cache };
  }
}
function alignWithDiscord(robloxMembers, guildMembers, profiles = []) {
  const profileByRoblox = new Map();
  const profileByDiscord = new Map();
  for (const profile of profiles || []) {
    if (profile.robloxUserId) profileByRoblox.set(String(profile.robloxUserId), profile);
    if (profile.robloxUsername) profileByRoblox.set(normalize(profile.robloxUsername), profile);
    if (profile.userId) profileByDiscord.set(String(profile.userId), profile);
  }
  const discordByName = new Map();
  for (const member of guildMembers || []) {
    const values = [member.user?.username, member.user?.globalName, member.displayName, member.nickname].filter(Boolean);
    for (const value of values) discordByName.set(normalize(value), member);
  }
  return (robloxMembers || []).map((item) => {
    const profile = profileByRoblox.get(String(item.robloxUserId)) || profileByRoblox.get(normalize(item.robloxUsername));
    const member = profile?.userId ? guildMembers.find((x) => String(x.id) === String(profile.userId)) : discordByName.get(normalize(item.robloxUsername));
    return {
      ...item,
      discordUserId: member?.id || profile?.userId || null,
      discordDisplayName: member?.displayName || profile?.discordDisplayName || null,
      timezone: profile?.timezone || null,
      linked: Boolean(member || profile?.userId),
    };
  });
}

module.exports = { listRobloxStaff, alignWithDiscord, tierForRank, tierLabel };
