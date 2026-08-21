'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} = require('discord.js');
const { trelloRequest } = require('./trelloClient');
const staffRequestStore = require('./staffRequestStore');
const cfg = require('../config/staffJourney');

const EASTERN_TZ = 'America/New_York';
const PENDING_TTL_MS = 10 * 60 * 1000;
const pending = new Map();
let lastMilestoneRunDate = null;
let automationTimer = null;
let archiveTimer = null;

// ---------------------------
// General helpers
// ---------------------------
function clean(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function normalize(value) {
  return clean(value, 500).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function easternParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date);
  const out = {};
  for (const part of parts) if (part.type !== 'literal') out[part.type] = part.value;
  return {
    year: Number(out.year), month: Number(out.month), day: Number(out.day),
    hour: Number(out.hour) % 24, minute: Number(out.minute), second: Number(out.second),
  };
}

function dateKey(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function parseMmDdYyyy(value) {
  const match = clean(value, 20).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function compareDateParts(a, b) {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

function addCalendarDays(parts, days) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + Number(days || 0), 12));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function formatMmDdYyyy(parts) {
  return `${String(parts.month).padStart(2, '0')}/${String(parts.day).padStart(2, '0')}/${parts.year}`;
}

function formatPretty(parts) {
  const month = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(parts.year, parts.month - 1, 1)));
  return `${month} ${String(parts.day).padStart(2, '0')}, ${parts.year}`;
}

function ordinal(day) {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  if (day % 10 === 1) return `${day}st`;
  if (day % 10 === 2) return `${day}nd`;
  if (day % 10 === 3) return `${day}rd`;
  return `${day}th`;
}

function monthLong(parts) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(parts.year, parts.month - 1, 1)));
}

// Build a UTC ISO timestamp for an exact wall-clock time in America/New_York.
// Iterative offset correction keeps midnight correct across EST/EDT transitions.
function zonedIso(parts, hour = 0, minute = 0, second = 0) {
  let guess = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, second);
  for (let i = 0; i < 3; i += 1) {
    const got = easternParts(new Date(guess));
    const wantedUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, second);
    const gotAsUtc = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second);
    const delta = wantedUtc - gotAsUtc;
    if (!delta) break;
    guess += delta;
  }
  return new Date(guess).toISOString();
}

function isoToEasternDateParts(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const p = easternParts(date);
  return { year: p.year, month: p.month, day: p.day };
}

function anchoredMilestone(first, number) {
  const baseIndex = first.year * 12 + (first.month - 1) + number;
  const year = Math.floor(baseIndex / 12);
  const month = (baseIndex % 12) + 1;
  const day = Math.min(first.day, daysInMonth(year, month));
  return { year, month, day };
}

function nextMilestoneAfter(first, reference = easternParts()) {
  const ref = { year: reference.year, month: reference.month, day: reference.day };
  let months = Math.max(1, (ref.year - first.year) * 12 + (ref.month - first.month));
  let candidate = anchoredMilestone(first, months);
  if (compareDateParts(candidate, ref) <= 0) candidate = anchoredMilestone(first, ++months);
  return { parts: candidate, number: months };
}

function milestoneNumberForDate(first, target) {
  let months = (target.year - first.year) * 12 + (target.month - first.month);
  if (months < 1) return 0;
  const expected = anchoredMilestone(first, months);
  if (compareDateParts(expected, target) !== 0) return 0;
  return months;
}

function calendarDuration(start, end) {
  if (!start || !end || compareDateParts(end, start) < 0) return null;
  let years = end.year - start.year;
  let months = end.month - start.month;
  let days = end.day - start.day;
  if (days < 0) {
    months -= 1;
    const previousMonth = end.month === 1 ? 12 : end.month - 1;
    const previousYear = end.month === 1 ? end.year - 1 : end.year;
    days += daysInMonth(previousYear, previousMonth);
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months, days };
}

function humanDuration(duration) {
  if (!duration) return '0 days';
  const parts = [];
  if (duration.years) parts.push(`${duration.years} ${duration.years === 1 ? 'year' : 'years'}`);
  if (duration.months) parts.push(`${duration.months} ${duration.months === 1 ? 'month' : 'months'}`);
  if (duration.days) parts.push(`${duration.days} ${duration.days === 1 ? 'day' : 'days'}`);
  return parts.length ? parts.join(', ') : '0 days';
}

function milestoneHuman(months) {
  const years = Math.floor(months / 12);
  const rem = months % 12;
  const parts = [];
  if (years) parts.push(`${years} ${years === 1 ? 'year' : 'years'}`);
  if (rem) parts.push(`${rem} ${rem === 1 ? 'month' : 'months'}`);
  return parts.join(', ') || `${months} months`;
}

function milestoneFooter(months) {
  if (months === 1) return 'HAPPY FIRST MONTH SINCE UR FIRST PROMOTION! <3';
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years && !rem) return `HAPPY ${years} ${years === 1 ? 'YEAR' : 'YEARS'} SINCE UR FIRST PROMOTION! <3`;
  if (years) return `HAPPY ${years} ${years === 1 ? 'YEAR' : 'YEARS'} & ${rem} ${rem === 1 ? 'MONTH' : 'MONTHS'} SINCE UR FIRST PROMOTION! <3`;
  return `HAPPY ${months} MONTHS SINCE UR FIRST PROMOTION! <3`;
}

function currentEasternDate() {
  const p = easternParts();
  return { year: p.year, month: p.month, day: p.day };
}

// ---------------------------
// Description format
// ---------------------------
function splitDescription(desc) {
  const text = String(desc || '').replace(/\r/g, '');
  const formerMarker = '**Former Usernames:**';
  const markerIndex = text.indexOf(formerMarker);
  const main = markerIndex >= 0 ? text.slice(0, markerIndex).trim() : text.trim();
  const formerBlock = markerIndex >= 0 ? text.slice(markerIndex).trim() : '';
  const formerUsernames = formerBlock
    ? formerBlock.split('\n').slice(1).map((line) => line.replace(/^\s*-\s*/, '').trim()).filter(Boolean)
    : [];
  return { main, formerUsernames };
}

function parseHistoryLine(line) {
  const match = String(line || '').trim().match(/^-\s*\*\*(.+?)\*\*\s*$/);
  if (!match) return null;
  const parts = match[1].split(/\s+-\s+/).map((part) => part.trim());
  if (parts.length < 2) return null;
  if (parts[1].toLowerCase() === 'resigned') {
    return { kind: 'resigned', dateText: parts[0], rank: parts[2] || 'Unknown Rank', raw: line };
  }
  let promoters = '';
  let duration = null;
  if (parts.length >= 4) {
    promoters = parts[2] || '';
    duration = parts[3] || null;
  } else if (parts.length === 3) {
    const third = parts[2] || '';
    if (/^(current|\d+\s+(?:day|days|month|months|year|years)(?:,\s*\d+\s+(?:day|days|month|months|year|years))*)$/i.test(third)) {
      promoters = 'Unknown';
      duration = third;
    } else {
      promoters = third;
      duration = 'Current';
    }
  } else {
    promoters = 'Unknown';
    duration = 'Current';
  }
  return {
    kind: 'rank',
    dateText: parts[0],
    rank: parts[1],
    promoters,
    duration,
    raw: line,
  };
}

function prettyTextToParts(text) {
  const match = clean(text, 50).match(/^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})$/);
  if (!match) return null;
  const monthNames = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const month = monthNames.indexOf(match[1].toLowerCase()) + 1;
  if (!month) return null;
  return { year: Number(match[3]), month, day: Number(match[2]) };
}

function historyEntries(desc) {
  const { main } = splitDescription(desc);
  return main.split('\n').map(parseHistoryLine).filter(Boolean);
}

function rankEntries(desc) {
  return historyEntries(desc).filter((entry) => entry.kind === 'rank');
}

function firstPromotionParts(desc) {
  const first = rankEntries(desc)[0];
  return first ? prettyTextToParts(first.dateText) : null;
}

function currentRankEntry(desc) {
  const entries = rankEntries(desc);
  return [...entries].reverse().find((entry) => String(entry.duration || '').toLowerCase() === 'current') || entries.at(-1) || null;
}

function allPromoterNames(desc) {
  const names = [];
  for (const entry of rankEntries(desc)) {
    if (!entry.promoters || /^(demoted|system|unknown)$/i.test(entry.promoters)) continue;
    for (const name of entry.promoters.split(/\s*&\s*/).map((x) => x.trim()).filter(Boolean)) {
      if (!names.some((existing) => normalize(existing) === normalize(name))) names.push(name);
    }
  }
  return names;
}

function lineForRank(dateParts, rank, promoterNames, duration = 'Current') {
  const promoterText = Array.isArray(promoterNames) ? promoterNames.filter(Boolean).join(' & ') : clean(promoterNames, 300);
  return `- **${formatPretty(dateParts)} - ${rank} - ${promoterText || 'Unknown'} - ${duration}**`;
}

function lineForResignation(dateParts, rank) {
  return `- **${formatPretty(dateParts)} - Resigned - ${rank}**`;
}

function rebuildDescription({ entries, formerUsernames = [], totalJourney = null }) {
  const lines = entries.map((entry) => entry.line || entry.raw || '').filter(Boolean);
  if (totalJourney) {
    lines.push('', `**Total Staff Journey: ${totalJourney}**`);
  }
  const former = [...new Set(formerUsernames.map((x) => clean(x, 100)).filter(Boolean))];
  if (former.length) {
    lines.push('', '', '**Former Usernames:**', ...former.map((name) => `- ${name}`));
  }
  return lines.join('\n').trim();
}

function closeCurrentAndAppend(desc, effectiveDate, newRank, promoterNames, { demotion = false } = {}) {
  const split = splitDescription(desc);
  const parsed = historyEntries(desc);
  const rankList = parsed.filter((e) => e.kind === 'rank');
  const current = [...rankList].reverse().find((e) => String(e.duration || '').toLowerCase() === 'current') || rankList.at(-1);
  if (!current) throw new Error('The Staff Journey card has no rank history to update.');
  const start = prettyTextToParts(current.dateText);
  if (!start) throw new Error('The current Staff Journey rank date could not be read.');
  if (compareDateParts(effectiveDate, start) < 0) throw new Error('The new date cannot be before the current rank started.');
  const duration = humanDuration(calendarDuration(start, effectiveDate));
  const output = [];
  let replaced = false;
  for (const entry of parsed) {
    if (!replaced && entry === current) {
      output.push({ line: lineForRank(start, entry.rank, entry.promoters, duration) });
      replaced = true;
    } else {
      output.push({ line: entry.raw });
    }
  }
  output.push({ line: lineForRank(effectiveDate, newRank, demotion ? 'Demoted' : promoterNames, 'Current') });
  return rebuildDescription({ entries: output, formerUsernames: split.formerUsernames });
}

function buildResignedDescription(desc, resignationDate) {
  const split = splitDescription(desc);
  const parsed = historyEntries(desc);
  const first = firstPromotionParts(desc);
  let currentIndex = -1;
  for (let i = parsed.length - 1; i >= 0; i -= 1) {
    if (parsed[i].kind === 'rank' && String(parsed[i].duration || '').toLowerCase() === 'current') { currentIndex = i; break; }
  }
  if (currentIndex < 0) {
    for (let i = parsed.length - 1; i >= 0; i -= 1) {
      if (parsed[i].kind === 'rank') { currentIndex = i; break; }
    }
  }
  const current = currentIndex >= 0 ? parsed[currentIndex] : null;
  if (!current || !first) throw new Error('The Staff Journey history is incomplete.');
  const currentStart = prettyTextToParts(current.dateText);
  if (!currentStart) throw new Error('The current rank date could not be read.');
  if (compareDateParts(resignationDate, currentStart) < 0) throw new Error('The resignation date cannot be before the current rank started.');
  const output = [];
  for (let i = 0; i < parsed.length; i += 1) {
    const entry = parsed[i];
    if (entry.kind === 'resigned') continue;
    if (i === currentIndex) {
      output.push({ line: lineForRank(currentStart, entry.rank, entry.promoters, humanDuration(calendarDuration(currentStart, resignationDate))) });
    } else output.push({ line: entry.raw });
  }
  output.push({ line: lineForResignation(resignationDate, current.rank) });
  return {
    desc: rebuildDescription({
      entries: output,
      formerUsernames: split.formerUsernames,
      totalJourney: humanDuration(calendarDuration(first, resignationDate)),
    }),
    rank: current.rank,
    promoters: allPromoterNames(desc),
    first,
  };
}

function addFormerUsername(desc, username) {
  // Preserve the Staff Journey description exactly as it already exists.
  // We only append the former-name section; legacy history formatting is never rebuilt here.
  const text = String(desc || '').replace(/\r/g, '').trimEnd();
  const oldName = clean(username, 100);
  if (!oldName) return text;

  const marker = '**Former Usernames:**';
  const lines = text.split('\n');
  const markerIndex = lines.findIndex((line) => line.trim().toLowerCase() === marker.toLowerCase());

  if (markerIndex >= 0) {
    const existing = lines
      .slice(markerIndex + 1)
      .map((line) => line.replace(/^\s*-\s*/, '').trim())
      .filter(Boolean);
    if (!existing.some((name) => normalize(name) === normalize(oldName))) {
      lines.push(`- ${oldName}`);
    }
    return lines.join('\n').trim();
  }

  return `${text}${text ? '\n\n\n' : ''}${marker}\n- ${oldName}`.trim();
}
// ---------------------------
// Trello helpers
// ---------------------------
function assertBaseConfig() {
  if (!cfg.boardId) throw new Error('STAFF_JOURNEY_BOARD_ID is missing in Render.');
}

function assertRankConfig(rank) {
  if (!rank?.listId || !rank?.labelId || !cfg.TEAM_LABELS[rank.team]) {
    throw new Error(`Staff Journey list/label environment values are missing for ${rank?.display || 'that rank'}.`);
  }
}

async function allBoardCards({ includeClosed = true } = {}) {
  assertBaseConfig();
  const res = await trelloRequest(`/boards/${encodeURIComponent(cfg.boardId)}/cards`, 'GET', {
    filter: includeClosed ? 'all' : 'open',
    fields: 'id,name,desc,idList,idLabels,due,closed,shortUrl,url,pos',
  });
  if (!res.ok || !Array.isArray(res.data)) throw new Error('Trello could not load the Staff Journey board.');
  return res.data;
}

function usernameFromCardName(name) {
  return clean(name, 300).split(' - ')[0].trim();
}

async function getCardById(cardId) {
  if (!cardId) return null;
  const res = await trelloRequest(`/cards/${encodeURIComponent(cardId)}`, 'GET', {
    fields: 'id,name,desc,idList,idLabels,due,closed,shortUrl,url,pos',
  });
  return res.ok ? res.data : null;
}

async function getProfile(guildId, userId) {
  try {
    const profiles = await staffRequestStore.listProfiles(guildId);
    return profiles.find((profile) => String(profile.userId) === String(userId)) || null;
  } catch (error) {
    console.warn('[STAFF JOURNEY] Could not read Supabase staff profile:', error.message || error);
    return null;
  }
}

async function saveProfile(guildId, userId, changes, actor = null) {
  try {
    return await staffRequestStore.upsertProfile(guildId, userId, changes, actor);
  } catch (error) {
    console.warn('[STAFF JOURNEY] Could not update Supabase staff profile:', error.message || error);
    return null;
  }
}

async function findJourneyCardForMember(guild, member, { includeClosed = true } = {}) {
  const profile = await getProfile(guild.id, member.id);
  if (profile?.staffJourneyCardId) {
    const direct = await getCardById(profile.staffJourneyCardId);
    if (direct && (includeClosed || !direct.closed)) return { card: direct, profile };
  }
  const cards = await allBoardCards({ includeClosed });
  const candidates = [profile?.robloxUsername, member.displayName, member.user?.globalName, member.user?.username]
    .map(normalize).filter(Boolean);
  const card = cards.find((candidate) => candidates.includes(normalize(usernameFromCardName(candidate.name)))) || null;
  return { card, profile };
}

async function findJourneyCardByRobloxUsername(username, { includeClosed = true } = {}) {
  // Staff Journey username lookups are intentionally exact (case-insensitive).
  // Do not fall back to Discord display names or fuzzy/normalized matching here.
  const wanted = clean(username, 100).toLowerCase();
  const cards = await allBoardCards({ includeClosed });
  return cards.find((card) => clean(usernameFromCardName(card.name), 100).toLowerCase() === wanted) || null;
}

async function findProfileForJourneyCard(guildId, card, username) {
  try {
    const profiles = await staffRequestStore.listProfiles(guildId);
    const wanted = clean(username, 100).toLowerCase();
    return profiles.find((profile) => String(profile.staffJourneyCardId || '') === String(card?.id || ''))
      || profiles.find((profile) => clean(profile.robloxUsername, 100).toLowerCase() === wanted)
      || null;
  } catch (error) {
    console.warn('[STAFF JOURNEY] Could not match Supabase profile for username update:', error.message || error);
    return null;
  }
}

async function updateCard(cardId, changes) {
  const res = await trelloRequest(`/cards/${encodeURIComponent(cardId)}`, 'PUT', changes);
  if (!res.ok) throw new Error('Trello rejected the Staff Journey card update.');
  return res.data;
}

async function createCard(changes) {
  const res = await trelloRequest('/cards', 'POST', changes);
  if (!res.ok || !res.data?.id) throw new Error('Trello could not create the Staff Journey card.');
  return res.data;
}

async function addLabel(cardId, labelId) {
  if (!labelId) return;
  const res = await trelloRequest(`/cards/${encodeURIComponent(cardId)}/idLabels`, 'POST', { value: labelId });
  if (!res.ok) throw new Error('Trello could not add a Staff Journey label.');
}

async function removeLabel(cardId, labelId) {
  if (!labelId) return;
  const res = await trelloRequest(`/cards/${encodeURIComponent(cardId)}/idLabels/${encodeURIComponent(labelId)}`, 'DELETE');
  if (!res.ok && res.status !== 404) throw new Error('Trello could not remove an old Staff Journey label.');
}

async function setJourneyLabels(card, rank, { resigned = false, recentlyPromoted = false } = {}) {
  const removable = new Set([
    ...cfg.ALL_RANK_LABEL_IDS,
    ...cfg.ALL_TEAM_LABEL_IDS,
    cfg.recentlyResignedLabelId,
    cfg.recentlyPromotedLabelId,
  ].filter(Boolean));
  for (const id of card.idLabels || []) if (removable.has(id)) await removeLabel(card.id, id);
  await addLabel(card.id, rank.labelId);
  if (!resigned) await addLabel(card.id, cfg.TEAM_LABELS[rank.team]);
  if (resigned) await addLabel(card.id, cfg.recentlyResignedLabelId);
  if (recentlyPromoted && cfg.recentlyPromotedLabelId) await addLabel(card.id, cfg.recentlyPromotedLabelId);
}

// ---------------------------
// Discord/profile helpers
// ---------------------------
async function resolveTargetMember(interaction, optionName = 'member') {
  const user = interaction.options.getUser(optionName, true);
  return interaction.guild.members.fetch(user.id).catch(() => null);
}

async function robloxNameForDiscordMember(guild, user) {
  const profile = await getProfile(guild.id, user.id);
  if (profile?.robloxUsername) return clean(profile.robloxUsername, 100);
  const member = await guild.members.fetch(user.id).catch(() => null);
  return clean(member?.displayName || user.globalName || user.username, 100);
}

async function promoterInfo(guild, users) {
  const output = [];
  for (const user of users.filter(Boolean)) {
    output.push({
      id: user.id,
      user,
      robloxName: await robloxNameForDiscordMember(guild, user),
      mention: `<@${user.id}>`,
    });
  }
  return output;
}

async function resolvePromoterNamesToDisplay(guild, names) {
  let profiles = [];
  try { profiles = await staffRequestStore.listProfiles(guild.id); } catch {}
  const members = await guild.members.fetch().catch(() => guild.members.cache);
  const results = [];
  for (const name of names) {
    const profile = profiles.find((p) => normalize(p.robloxUsername) === normalize(name));
    if (profile?.userId) {
      results.push({ name, id: profile.userId, text: `<@${profile.userId}>` });
      continue;
    }
    const member = [...members.values()].find((m) => [m.displayName, m.user?.globalName, m.user?.username].some((v) => normalize(v) === normalize(name)));
    if (member) results.push({ name, id: member.id, text: `<@${member.id}>` });
    else results.push({ name, id: null, text: `**${name}**` });
  }
  return results;
}

function rankByKey(key) {
  return cfg.RANK_BY_KEY.get(clean(key, 100)) || null;
}

function rankByDisplay(display) {
  return cfg.RANK_BY_NAME.get(clean(display, 100).toLowerCase()) || null;
}

function teamEmoji(rankDisplay) {
  const rank = rankByDisplay(rankDisplay);
  return rank ? cfg.TEAM_EMOJIS[rank.team] || '' : '';
}

async function announcementChannel(client, { test = false } = {}) {
  const id = test ? cfg.STAFF_JOURNEY_TEST_CHANNEL_ID : cfg.ANNOUNCEMENT_CHANNEL_ID;
  if (!id) throw new Error('The Staff Journey announcement channel is not configured.');
  const channel = await client.channels.fetch(id).catch(() => null);
  if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
    throw new Error(`${test ? 'Staff Journey test' : 'Staff Journey announcement'} channel could not be found.`);
  }
  return channel;
}

function promotionAnnouncement({ username, rank, customMessage, promoters, memberId, cardUrl }) {
  const emoji = teamEmoji(rank);
  const promoterText = promoters.map((p) => p.text || p.mention || p).join(' & ') || 'None recorded';
  const promoterLabel = promoters.length > 1 ? 'Promoter(s)' : 'Promoter';
  return [
    `# <:GlaceHotels:1489052500341297344> **PROMOTION** <:GlaceHotels:1489052500341297344>`,
    '',
    `Please congratulate **${username}** on their promotion to ${emoji ? `${emoji} ` : ''}**${rank}**!`,
    '',
    `> ${customMessage}`,
    '> ',
    `> ${promoterLabel} - ${promoterText}`,
    '',
    `Mentions: <@${memberId}>`,
    '',
    `[${username} | Promotion Card ](${cardUrl})`,
    cfg.STAFF_PING_ROLE_ID ? `|| <@&${cfg.STAFF_PING_ROLE_ID}> ||` : '',
  ].filter((line, index, arr) => line !== '' || (index > 0 && arr[index - 1] !== '')).join('\n').trim();
}

function resignationAnnouncement({ username, rank, customMessage, promoters, memberId, cardUrl }) {
  const promoterText = promoters.map((p) => p.text || p.mention || p).join(' & ') || 'None recorded';
  return [
    `# <:former_team:1478648150028980334> **RESIGNATION** <:former_team:1478648150028980334>`,
    '',
    `**${username}** has resigned from their position, <:former_team:1478648150028980334> **${rank}**!`,
    '',
    `> ${customMessage}`,
    '',
    `**Promoter(s):** - ${promoterText}`,
    '',
    `Mentions: <@${memberId}>`,
    cardUrl,
    '',
    cfg.STAFF_PING_ROLE_ID ? `|| <@&${cfg.STAFF_PING_ROLE_ID}> ||` : '',
  ].filter((line, index, arr) => line !== '' || (index > 0 && arr[index - 1] !== '')).join('\n').trim();
}

function milestoneAnnouncement({ dateParts, entries }) {
  const separator = '-----------------------------------------------------';
  const header = `# ${cfg.GLACE_EMOJI} ***${monthLong(dateParts)} ${ordinal(dateParts.day)}, ${dateParts.year} | Monthly Milestone(s) ${cfg.GLACE_EMOJI}***`;
  const lines = entries.map((entry) => `> ${teamEmoji(entry.rank)} **${entry.username}** - | ${entry.rank} | - ${milestoneHuman(entry.months)}`.replace('>  **', '> **'));
  const footer = entries.length === 1 ? milestoneFooter(entries[0].months) : 'HAPPY MONTHLY MILESTONE(S) SINCE UR FIRST PROMOTION! <3';
  const links = entries.map((entry) => `[-Staff Journey | ${entry.username}-](${entry.cardUrl})`).join('\n');
  const mentions = entries.map((entry) => entry.memberId ? `<@${entry.memberId}>` : '').filter(Boolean).join(' ');
  return [
    header,
    separator,
    ...lines,
    separator,
    `-# ${footer}`,
    '',
    links,
    '',
    mentions ? `Mentions: ${mentions}` : '',
    '',
    cfg.STAFF_PING_ROLE_ID ? `||<@&${cfg.STAFF_PING_ROLE_ID}>||` : '',
  ].filter((line, i, arr) => line !== '' || (i > 0 && arr[i - 1] !== '')).join('\n').trim();
}

async function sendAnnouncement(client, content, { test = false, userIds = [], roleIds = [] } = {}) {
  const channel = await announcementChannel(client, { test });
  const payload = test
    ? { content, allowedMentions: { parse: [], users: [], roles: [] } }
    : { content, allowedMentions: { parse: [], users: [...new Set(userIds.filter(Boolean))], roles: [...new Set(roleIds.filter(Boolean))] } };
  return channel.send(payload);
}

// ---------------------------
// Operations
// ---------------------------
async function operationEnroll(interaction, payload, postAnnouncement) {
  assertBaseConfig();
  const liRank = rankByKey('leadership_intern');
  assertRankConfig(liRank);
  const member = await interaction.guild.members.fetch(payload.memberId).catch(() => null);
  if (!member) throw new Error('I could not find that Discord member in the server.');
  const promotionDate = parseMmDdYyyy(payload.promotionDate);
  if (!promotionDate) throw new Error('Invalid promotion date. Use MM/DD/YYYY.');
  const promoterUsers = await Promise.all(payload.promoterIds.map((id) => interaction.client.users.fetch(id).catch(() => null)));
  const promoters = await promoterInfo(interaction.guild, promoterUsers.filter(Boolean));
  if (!promoters.length) throw new Error('I could not read the promoter.');

  if (postAnnouncement) await announcementChannel(interaction.client);
  const existingProfile = await getProfile(interaction.guild.id, member.id);
  if (existingProfile?.staffJourneyCardId) {
    const existing = await getCardById(existingProfile.staffJourneyCardId);
    if (existing) throw new Error(`${member} already has an active Staff Journey card- Try looking at the staff journey or contact Mani if incorrect.`);
  }
  const duplicate = await findJourneyCardByRobloxUsername(payload.robloxUsername, { includeClosed: true });
  if (duplicate) throw new Error(`${member} already has an active Staff Journey card- Try looking at the staff journey or contact Mani if incorrect.`);

  const due = nextMilestoneAfter(promotionDate, easternParts());
  const card = await createCard({
    idList: liRank.listId,
    name: `${payload.robloxUsername} - ${payload.promotionDate}`,
    desc: lineForRank(promotionDate, liRank.display, promoters.map((p) => p.robloxName), 'Current'),
    due: zonedIso(due.parts, 0, 0, 0),
    pos: 'bottom',
  });
  const fresh = await getCardById(card.id) || { ...card, idLabels: [] };
  await setJourneyLabels(fresh, liRank, { recentlyPromoted: false });
  await saveProfile(interaction.guild.id, member.id, {
    robloxUsername: payload.robloxUsername,
    staffJourneyCardId: card.id,
    staffJourneyCardUrl: card.shortUrl || card.url,
    staffJourneyStartDate: payload.promotionDate,
    staffJourneyStatus: 'active',
  }, { id: interaction.user.id, tag: interaction.user.tag });

  if (postAnnouncement) {
    const content = promotionAnnouncement({
      username: payload.robloxUsername,
      rank: liRank.display,
      customMessage: payload.customMessage,
      promoters: promoters.map((p) => ({ ...p, text: p.mention })),
      memberId: member.id,
      cardUrl: card.shortUrl || card.url,
    });
    await sendAnnouncement(interaction.client, content, {
      userIds: [member.id, ...promoters.map((p) => p.id)],
      roleIds: cfg.STAFF_PING_ROLE_ID ? [cfg.STAFF_PING_ROLE_ID] : [],
    });
  }
  return { member, rank: liRank.display, card, postAnnouncement };
}

async function operationPromote(interaction, payload, postAnnouncement) {
  const member = await interaction.guild.members.fetch(payload.memberId).catch(() => null);
  if (!member) throw new Error('I could not find that Discord member in the server.');
  const newRank = rankByKey(payload.rankKey);
  if (!newRank) throw new Error('I could not read the new rank.');
  assertRankConfig(newRank);
  const date = parseMmDdYyyy(payload.promotionDate);
  if (!date) throw new Error('Invalid promotion date. Use MM/DD/YYYY.');
  if (postAnnouncement) await announcementChannel(interaction.client);

  const { card, profile } = await findJourneyCardForMember(interaction.guild, member, { includeClosed: false });
  if (!card) throw new Error(`I couldn't find an active Staff Journey for ${member}.`);
  const current = currentRankEntry(card.desc);
  if (!current) throw new Error('The current Staff Journey rank could not be read.');
  const currentRank = rankByDisplay(current.rank);
  if (!currentRank) throw new Error(`The current rank **${current.rank}** is not recognized.`);
  if (newRank.index <= currentRank.index) throw new Error(`Use /demote for a move from **${current.rank}** to **${newRank.display}**.`);

  const promoterUsers = await Promise.all(payload.promoterIds.map((id) => interaction.client.users.fetch(id).catch(() => null)));
  const promoters = await promoterInfo(interaction.guild, promoterUsers.filter(Boolean));
  const desc = closeCurrentAndAppend(card.desc, date, newRank.display, promoters.map((p) => p.robloxName));
  await updateCard(card.id, { idList: newRank.listId, desc, pos: 'bottom' });
  const fresh = await getCardById(card.id) || card;
  await setJourneyLabels(fresh, newRank, { recentlyPromoted: false });
  await saveProfile(interaction.guild.id, member.id, {
    robloxUsername: profile?.robloxUsername || usernameFromCardName(card.name),
    staffJourneyCardId: card.id,
    staffJourneyCardUrl: card.shortUrl || card.url,
    staffJourneyStatus: 'active',
    currentStaffJourneyRank: newRank.display,
  }, { id: interaction.user.id, tag: interaction.user.tag });

  if (postAnnouncement) {
    const username = profile?.robloxUsername || usernameFromCardName(card.name);
    const content = promotionAnnouncement({
      username,
      rank: newRank.display,
      customMessage: payload.customMessage,
      promoters: promoters.map((p) => ({ ...p, text: p.mention })),
      memberId: member.id,
      cardUrl: card.shortUrl || card.url,
    });
    await sendAnnouncement(interaction.client, content, {
      userIds: [member.id, ...promoters.map((p) => p.id)],
      roleIds: cfg.STAFF_PING_ROLE_ID ? [cfg.STAFF_PING_ROLE_ID] : [],
    });
  }
  return { member, oldRank: current.rank, rank: newRank.display, card, postAnnouncement };
}

async function operationResign(interaction, payload, postAnnouncement) {
  if (!cfg.recentlyResignedListId || !cfg.recentlyResignedLabelId) throw new Error('Recently Resigned list/label env values are missing.');
  const member = await interaction.guild.members.fetch(payload.memberId).catch(() => null);
  if (!member) throw new Error('I could not find that Discord member in the server.');
  const date = parseMmDdYyyy(payload.resignationDate);
  if (!date) throw new Error('Invalid resignation date. Use MM/DD/YYYY.');
  if (postAnnouncement) await announcementChannel(interaction.client);
  const { card, profile } = await findJourneyCardForMember(interaction.guild, member, { includeClosed: false });
  if (!card) throw new Error(`I couldn't find an active Staff Journey for ${member}.`);
  const result = buildResignedDescription(card.desc, date);
  const rank = rankByDisplay(result.rank);
  if (!rank) throw new Error(`The final rank **${result.rank}** is not recognized.`);
  const archiveDue = addCalendarDays(date, 7);
  await updateCard(card.id, {
    idList: cfg.recentlyResignedListId,
    desc: result.desc,
    due: zonedIso(archiveDue, 0, 0, 0),
    pos: 'bottom',
  });
  const fresh = await getCardById(card.id) || card;
  await setJourneyLabels(fresh, rank, { resigned: true });
  await saveProfile(interaction.guild.id, member.id, {
    robloxUsername: profile?.robloxUsername || usernameFromCardName(card.name),
    staffJourneyCardId: card.id,
    staffJourneyCardUrl: card.shortUrl || card.url,
    staffJourneyStatus: 'recently_resigned',
    resignedAt: payload.resignationDate,
  }, { id: interaction.user.id, tag: interaction.user.tag });

  if (postAnnouncement) {
    const resolved = await resolvePromoterNamesToDisplay(interaction.guild, result.promoters);
    const username = profile?.robloxUsername || usernameFromCardName(card.name);
    const content = resignationAnnouncement({
      username,
      rank: result.rank,
      customMessage: payload.customMessage,
      promoters: resolved,
      memberId: member.id,
      cardUrl: card.shortUrl || card.url,
    });
    await sendAnnouncement(interaction.client, content, {
      userIds: [member.id, ...resolved.map((p) => p.id).filter(Boolean)],
      roleIds: cfg.STAFF_PING_ROLE_ID ? [cfg.STAFF_PING_ROLE_ID] : [],
    });
  }
  return { member, rank: result.rank, card, postAnnouncement };
}

function replaceExactUsername(value, oldName, newName) {
  if (typeof value === 'string') return normalize(value) === normalize(oldName) ? newName : value;
  if (Array.isArray(value)) return value.map((item) => replaceExactUsername(item, oldName, newName));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const newKey = normalize(key) === normalize(oldName) ? newName : key;
      out[newKey] = replaceExactUsername(item, oldName, newName);
    }
    return out;
  }
  return value;
}

function updateLocalJsonUsername(oldName, newName) {
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) return 0;
  let changedFiles = 0;
  for (const file of fs.readdirSync(dataDir).filter((name) => name.endsWith('.json'))) {
    const full = path.join(dataDir, file);
    try {
      const originalText = fs.readFileSync(full, 'utf8');
      const parsed = JSON.parse(originalText || '{}');
      const updated = replaceExactUsername(parsed, oldName, newName);
      const nextText = `${JSON.stringify(updated, null, 2)}\n`;
      if (nextText !== `${JSON.stringify(parsed, null, 2)}\n`) {
        fs.writeFileSync(full, nextText, 'utf8');
        changedFiles += 1;
      }
    } catch (error) {
      console.warn(`[STAFF JOURNEY] Username update skipped ${file}:`, error.message || error);
    }
  }
  return changedFiles;
}

async function operationUpdateUser(interaction, payload) {
  const requestedOldUsername = clean(payload.oldUsername, 100);
  const newUsername = clean(payload.newUsername, 100);
  if (!/^[A-Za-z0-9_]{3,20}$/.test(requestedOldUsername)) throw new Error('That current Roblox username does not look valid.');
  if (!/^[A-Za-z0-9_]{3,20}$/.test(newUsername)) throw new Error('That new Roblox username does not look valid.');
  if (requestedOldUsername.toLowerCase() === newUsername.toLowerCase()) throw new Error('The new Roblox username is the same as the current username.');

  // Card-first lookup: the FULL current Roblox username must match the username
  // at the start of the Trello card title. No Discord-member lookup is used.
  const card = await findJourneyCardByRobloxUsername(requestedOldUsername, { includeClosed: true });
  if (!card) {
    throw new Error(`I couldn't find a Staff Journey card beginning with the exact Roblox username **${requestedOldUsername}**. Check the card title and try again.`);
  }

  const oldUsername = usernameFromCardName(card.name);
  const currentTitle = String(card.name || '');

  // IMPORTANT: do NOT parse or rebuild the title. Preserve every character after
  // the old username exactly, whether the card uses a new or legacy title format.
  const suffix = currentTitle.slice(oldUsername.length);
  const newTitle = `${newUsername}${suffix}`;
  const desc = addFormerUsername(card.desc, oldUsername);
  await updateCard(card.id, { name: newTitle, desc });

  // Keep a linked Supabase profile synchronized when one exists. A Trello card
  // without a linked Discord/Supabase profile is still a successful username update.
  const profile = await findProfileForJourneyCard(interaction.guild.id, card, oldUsername);
  if (profile?.userId) {
    const changes = {
      ...profile,
      robloxUsername: newUsername,
      formerRobloxUsernames: [...new Set([...(profile.formerRobloxUsernames || []), oldUsername])],
      staffJourneyCardId: card.id,
      staffJourneyCardUrl: card.shortUrl || card.url,
    };

    // Preserve an existing stored journey date. If it is missing, use the first
    // readable promotion row when possible, but NEVER fail /updateuser over a date.
    if (!changes.staffJourneyStartDate) {
      const firstPromotion = firstPromotionParts(card.desc);
      if (firstPromotion) changes.staffJourneyStartDate = formatMmDdYyyy(firstPromotion);
    }

    await saveProfile(interaction.guild.id, profile.userId, changes, { id: interaction.user.id, tag: interaction.user.tag });
  }

  const localFiles = updateLocalJsonUsername(oldUsername, newUsername);
  return { oldUsername, newUsername, localFiles, profileUpdated: Boolean(profile?.userId) };
}
async function operationDemote(interaction, payload) {
  const member = await interaction.guild.members.fetch(payload.memberId).catch(() => null);
  if (!member) throw new Error('I could not find that Discord member in the server.');
  const newRank = rankByKey(payload.rankKey);
  if (!newRank) throw new Error('I could not read the new rank.');
  assertRankConfig(newRank);
  const date = parseMmDdYyyy(payload.date);
  if (!date) throw new Error('Invalid demotion date. Use MM/DD/YYYY.');
  const { card, profile } = await findJourneyCardForMember(interaction.guild, member, { includeClosed: false });
  if (!card) throw new Error(`I couldn't find an active Staff Journey for ${member}.`);
  const current = currentRankEntry(card.desc);
  const currentRank = rankByDisplay(current?.rank);
  if (!currentRank) throw new Error('The current rank could not be recognized.');
  if (newRank.index >= currentRank.index) throw new Error(`Use /promote for a move from **${current.rank}** to **${newRank.display}**.`);
  const desc = closeCurrentAndAppend(card.desc, date, newRank.display, [], { demotion: true });
  await updateCard(card.id, { idList: newRank.listId, desc, pos: 'bottom' });
  const fresh = await getCardById(card.id) || card;
  await setJourneyLabels(fresh, newRank, { recentlyPromoted: false });
  await saveProfile(interaction.guild.id, member.id, {
    robloxUsername: profile?.robloxUsername || usernameFromCardName(card.name),
    staffJourneyCardId: card.id,
    staffJourneyCardUrl: card.shortUrl || card.url,
    staffJourneyStatus: 'active',
    currentStaffJourneyRank: newRank.display,
  }, { id: interaction.user.id, tag: interaction.user.tag });
  return { member, oldRank: current.rank, rank: newRank.display, card };
}

async function operationStaffJourneyPost(interaction, payload) {
  const member = await interaction.guild.members.fetch(payload.memberId).catch(() => null);
  if (!member) throw new Error('I could not find that Discord member in the server.');
  await announcementChannel(interaction.client);
  const { card, profile } = await findJourneyCardForMember(interaction.guild, member, { includeClosed: true });
  if (!card) throw new Error(`I couldn't find a Staff Journey for ${member}.`);
  const username = profile?.robloxUsername || usernameFromCardName(card.name);
  if (payload.announcementType === 'resignation') {
    const entries = historyEntries(card.desc);
    const resigned = [...entries].reverse().find((entry) => entry.kind === 'resigned');
    const rank = resigned?.rank || currentRankEntry(card.desc)?.rank;
    const promoters = await resolvePromoterNamesToDisplay(interaction.guild, allPromoterNames(card.desc));
    const content = resignationAnnouncement({ username, rank, customMessage: payload.customMessage, promoters, memberId: member.id, cardUrl: card.shortUrl || card.url });
    await sendAnnouncement(interaction.client, content, { userIds: [member.id, ...promoters.map((p) => p.id).filter(Boolean)], roleIds: cfg.STAFF_PING_ROLE_ID ? [cfg.STAFF_PING_ROLE_ID] : [] });
    return { member, type: 'resignation' };
  }
  let selectedEntry = null;
  if (payload.announcementType === 'enrollment') {
    selectedEntry = rankEntries(card.desc).find((entry) => normalize(entry.rank) === normalize('Leadership Intern'));
  } else if (payload.rankKey) {
    const wanted = rankByKey(payload.rankKey);
    selectedEntry = [...rankEntries(card.desc)].reverse().find((entry) => normalize(entry.rank) === normalize(wanted?.display));
  }
  selectedEntry ||= currentRankEntry(card.desc);
  if (!selectedEntry) throw new Error('I could not find a promotion entry to announce.');
  const promoterNames = selectedEntry.promoters && !/^(demoted|system|unknown)$/i.test(selectedEntry.promoters)
    ? selectedEntry.promoters.split(/\s*&\s*/).filter(Boolean)
    : [];
  const promoters = await resolvePromoterNamesToDisplay(interaction.guild, promoterNames);
  const content = promotionAnnouncement({ username, rank: selectedEntry.rank, customMessage: payload.customMessage, promoters, memberId: member.id, cardUrl: card.shortUrl || card.url });
  await sendAnnouncement(interaction.client, content, { userIds: [member.id, ...promoters.map((p) => p.id).filter(Boolean)], roleIds: cfg.STAFF_PING_ROLE_ID ? [cfg.STAFF_PING_ROLE_ID] : [] });
  return { member, type: payload.announcementType, rank: selectedEntry.rank };
}

// ---------------------------
// Confirmation system
// ---------------------------
function token() {
  return crypto.randomBytes(8).toString('hex');
}

function prunePending() {
  const now = Date.now();
  for (const [id, item] of pending) if (now - item.createdAt > PENDING_TTL_MS) pending.delete(id);
}

function queuePending(interaction, operation) {
  prunePending();
  const id = token();
  pending.set(id, { ...operation, initiatorId: interaction.user.id, createdAt: Date.now() });
  return id;
}

function confirmationComponents(id, { canPost = false, destructiveLabel = 'Confirm' } = {}) {
  const row = new ActionRowBuilder();
  if (canPost) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`sj:${id}:post`).setLabel(`${destructiveLabel} + Post`).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`sj:${id}:silent`).setLabel(`${destructiveLabel} Only`).setStyle(ButtonStyle.Primary),
    );
  } else {
    row.addComponents(new ButtonBuilder().setCustomId(`sj:${id}:confirm`).setLabel(destructiveLabel).setStyle(ButtonStyle.Primary));
  }
  row.addComponents(new ButtonBuilder().setCustomId(`sj:${id}:cancel`).setLabel('Cancel').setStyle(ButtonStyle.Secondary));
  return [row];
}

async function beginConfirmation(interaction, operation, message, opts = {}) {
  const id = queuePending(interaction, operation);
  await interaction.reply({
    content: message,
    components: confirmationComponents(id, opts),
    ephemeral: true,
  });
}

async function handleStaffJourneyInteraction(interaction) {
  if (!interaction.isButton() || !String(interaction.customId || '').startsWith('sj:')) return false;
  const [, id, action] = interaction.customId.split(':');
  prunePending();
  const item = pending.get(id);
  if (!item) {
    await interaction.reply({ content: '\u274C This Staff Journey confirmation expired. Please run the command again.', ephemeral: true }).catch(() => null);
    return true;
  }
  if (String(item.initiatorId) !== String(interaction.user.id)) {
    await interaction.reply({ content: '\u274C Only the person who ran this Staff Journey command can confirm it.', ephemeral: true }).catch(() => null);
    return true;
  }
  if (action === 'cancel') {
    pending.delete(id);
    await interaction.update({ content: '\u274C Staff Journey action cancelled. Nothing was changed.', components: [] });
    return true;
  }
  pending.delete(id);
  const post = action === 'post';
  const processing = item.processingMessage || '\u23F3 Updating Staff Journey, this may take a bit...';
  await interaction.update({ content: processing, components: [] });
  try {
    let result;
    if (item.type === 'enroll') result = await operationEnroll(interaction, item.payload, post);
    else if (item.type === 'promote') result = await operationPromote(interaction, item.payload, post);
    else if (item.type === 'resign') result = await operationResign(interaction, item.payload, post);
    else if (item.type === 'updateuser') result = await operationUpdateUser(interaction, item.payload);
    else if (item.type === 'demote') result = await operationDemote(interaction, item.payload);
    else if (item.type === 'staffjourneypost') result = await operationStaffJourneyPost(interaction, item.payload);
    else throw new Error('Unknown Staff Journey action.');

    let success = '\u2705 Staff Journey updated successfully.';
    if (item.type === 'enroll') {
      success = `\u2705 ${result.member} has been enrolled into Staff Journey as Leadership Intern!! WOO, ${post ? 'the promotion announcement has also been posted.' : 'you may now create the staff journey announcement.'}`;
    } else if (item.type === 'promote') {
      success = `\u2705 Promotion complete!\n${result.member} has been promoted to **${result.rank}**. Their Staff Journey card, rank history, and labels have been updated.${post ? ' The announcement has also been posted.' : ' No announcement was posted.'}`;
    } else if (item.type === 'resign') {
      success = `\u2705 Resignation complete!\n${result.member}\u2019s Staff Journey has been closed as a resignation. Their history has been preserved. Staff Journey card, rank history, and labels have been updated.${post ? ' The resignation announcement has also been posted.' : ' No announcement was posted.'}`;
    } else if (item.type === 'updateuser') {
      success = `\u2705 Staff Journey updated from **${result.oldUsername}** to **${result.newUsername}**.`;
    } else if (item.type === 'demote') {
      success = `\u2705 Demotion complete!\n${result.member}\u2019s Staff Journey has been moved from **${result.oldRank}** to **${result.rank}**. No public announcement was posted.`;
    } else if (item.type === 'staffjourneypost') {
      success = `\u2705 Staff Journey ${result.type} announcement posted for ${result.member}.`;
    }
    await interaction.editReply({ content: success, components: [] });
  } catch (error) {
    console.error(`[STAFF JOURNEY ${String(item.type).toUpperCase()}]`, error);
    const message = error.message || 'That Staff Journey action failed safely.';
    await interaction.editReply({ content: `\u274C ${message}\n\nNo announcement was posted if the Staff Journey update failed.`, components: [] }).catch(() => null);
  }
  return true;
}

// ---------------------------
// Automatic milestones + archive
// ---------------------------
async function archiveExpiredResignations(client) {
  if (!cfg.recentlyResignedListId) return;
  try {
    const res = await trelloRequest(`/lists/${encodeURIComponent(cfg.recentlyResignedListId)}/cards`, 'GET', {
      filter: 'open', fields: 'id,name,due,closed', limit: '1000',
    });
    if (!res.ok || !Array.isArray(res.data)) return;
    const now = Date.now();
    for (const card of res.data) {
      if (!card.due || new Date(card.due).getTime() > now) continue;
      await updateCard(card.id, { closed: true });
      console.log(`[STAFF JOURNEY] Archived resigned card after 7 days: ${card.name}`);
    }
  } catch (error) {
    console.error('[STAFF JOURNEY] Recently Resigned archive failed:', error);
  }
}

async function archiveOldMilestoneCards() {
  if (!cfg.monthlyMilestonesListId) return;
  const res = await trelloRequest(`/lists/${encodeURIComponent(cfg.monthlyMilestonesListId)}/cards`, 'GET', {
    filter: 'open', fields: 'id,name,closed', limit: '1000',
  });
  if (!res.ok || !Array.isArray(res.data)) return;
  for (const card of res.data) await updateCard(card.id, { closed: true });
}

async function memberForJourneyCard(guild, card) {
  try {
    const profiles = await staffRequestStore.listProfiles(guild.id);
    const profile = profiles.find((p) => String(p.staffJourneyCardId || '') === String(card.id));
    if (profile?.userId) return guild.members.fetch(profile.userId).catch(() => null);
  } catch {}
  const username = usernameFromCardName(card.name);
  const members = await guild.members.fetch().catch(() => guild.members.cache);
  return [...members.values()].find((m) => [m.displayName, m.user?.globalName, m.user?.username].some((v) => normalize(v) === normalize(username))) || null;
}

async function runMilestoneAutomation(client, { force = false } = {}) {
  if (!client?.isReady?.()) return { posted: 0 };
  if (!cfg.boardId || !cfg.monthlyMilestonesListId || !cfg.happyMonthsLabelId) {
    if (force) console.warn('[STAFF JOURNEY] Milestone automation disabled: missing board/list/label env values.');
    return { posted: 0, disabled: true };
  }
  const nowPartsFull = easternParts();
  const today = { year: nowPartsFull.year, month: nowPartsFull.month, day: nowPartsFull.day };
  const todayKey = dateKey(today);
  if (!force && lastMilestoneRunDate === todayKey) return { posted: 0, skipped: true };

  try {
    // Preflight the destination before changing any milestone cards.
    await announcementChannel(client);
    await archiveOldMilestoneCards();
    const cards = (await allBoardCards({ includeClosed: false })).filter((card) => cfg.ACTIVE_LIST_IDS.includes(card.idList));
    const dueToday = [];
    for (const card of cards) {
      const first = firstPromotionParts(card.desc);
      if (!first) continue;
      const dueParts = isoToEasternDateParts(card.due);
      if (!dueParts) {
        const next = nextMilestoneAfter(first, nowPartsFull);
        await updateCard(card.id, { due: zonedIso(next.parts) });
        continue;
      }
      const cmp = compareDateParts(dueParts, today);
      if (cmp < 0) {
        // Do not spam late milestones. Repair the card to the next future monthly milestone.
        const next = nextMilestoneAfter(first, nowPartsFull);
        await updateCard(card.id, { due: zonedIso(next.parts) });
        console.log(`[STAFF JOURNEY] Repaired overdue milestone date for ${card.name}.`);
        continue;
      }
      if (cmp !== 0) continue;
      const months = milestoneNumberForDate(first, dueParts);
      if (months < 1) continue;
      dueToday.push({ card, first, months });
    }

    lastMilestoneRunDate = todayKey;
    if (!dueToday.length) return { posted: 0 };

    const guildId = String(process.env.GUILD_ID || '').trim();
    const guild = guildId ? (client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null)) : client.guilds.cache.first();
    if (!guild) throw new Error('The Glace guild could not be found for milestone mentions.');
    const announcementEntries = [];

    for (const item of dueToday) {
      try {
        const current = currentRankEntry(item.card.desc);
        const username = usernameFromCardName(item.card.name);
        const milestoneCard = await createCard({
          idList: cfg.monthlyMilestonesListId,
          name: `${username} - ${milestoneHuman(item.months)} - ${current?.rank || 'Unknown Rank'}`,
          desc: item.card.desc || '',
          due: zonedIso(today),
          pos: 'bottom',
        });
        await addLabel(milestoneCard.id, cfg.happyMonthsLabelId);
        const next = nextMilestoneAfter(item.first, { ...today, hour: 0, minute: 0, second: 0 });
        await updateCard(item.card.id, { due: zonedIso(next.parts) });
        const member = await memberForJourneyCard(guild, item.card);
        announcementEntries.push({
          username,
          rank: current?.rank || 'Unknown Rank',
          months: item.months,
          cardUrl: milestoneCard.shortUrl || milestoneCard.url,
          memberId: member?.id || null,
        });
      } catch (cardError) {
        console.error(`[STAFF JOURNEY] Milestone failed for ${item.card.name}:`, cardError);
      }
    }

    if (!announcementEntries.length) return { posted: 0 };
    const content = milestoneAnnouncement({ dateParts: today, entries: announcementEntries });
    await sendAnnouncement(client, content, {
      userIds: announcementEntries.map((e) => e.memberId).filter(Boolean),
      roleIds: cfg.STAFF_PING_ROLE_ID ? [cfg.STAFF_PING_ROLE_ID] : [],
    });
    return { posted: announcementEntries.length };
  } catch (error) {
    console.error('[STAFF JOURNEY] Monthly milestone automation failed:', error);
    return { posted: 0, error };
  }
}

function startStaffJourneyAutomation(client) {
  if (automationTimer || archiveTimer) return () => stopStaffJourneyAutomation();
  // Catch today's milestone if Render restarted after midnight.
  runMilestoneAutomation(client, { force: true }).catch(() => null);
  archiveExpiredResignations(client).catch(() => null);
  automationTimer = setInterval(() => {
    const p = easternParts();
    if (p.hour === 0 && p.minute <= 2) runMilestoneAutomation(client).catch(() => null);
  }, 60 * 1000);
  archiveTimer = setInterval(() => archiveExpiredResignations(client).catch(() => null), 60 * 60 * 1000);
  automationTimer.unref?.();
  archiveTimer.unref?.();
  console.log('[STAFF JOURNEY] Automatic midnight milestones + resigned-card archiving started.');
  return () => stopStaffJourneyAutomation();
}

function stopStaffJourneyAutomation() {
  if (automationTimer) clearInterval(automationTimer);
  if (archiveTimer) clearInterval(archiveTimer);
  automationTimer = null;
  archiveTimer = null;
}

// ---------------------------
// Test previews (NO MUTATION / NO PINGS)
// ---------------------------
async function runStaffJourneyTest(interaction, input) {
  const channel = await announcementChannel(interaction.client, { test: true });
  const member = await interaction.guild.members.fetch(input.memberId).catch(() => null);
  if (!member) throw new Error('I could not find that member.');
  const { card, profile } = await findJourneyCardForMember(interaction.guild, member, { includeClosed: true }).catch(() => ({ card: null, profile: null }));
  const username = profile?.robloxUsername || (card ? usernameFromCardName(card.name) : member.displayName);
  const current = card ? currentRankEntry(card.desc) : null;
  const promoterUsers = await Promise.all((input.promoterIds || [interaction.user.id]).map((id) => interaction.client.users.fetch(id).catch(() => null)));
  const promoterInfos = await promoterInfo(interaction.guild, promoterUsers.filter(Boolean));
  const message = input.customMessage || 'This is a Staff Journey test message so we can make sure everything looks right!';
  const fakeUrl = card?.shortUrl || card?.url || 'https://trello.com/';
  const noPingPromoters = promoterInfos.map((p) => ({ ...p, text: p.mention }));
  const selectedRank = rankByKey(input.rankKey)?.display || current?.rank || 'Leadership Intern';
  const types = input.command === 'all'
    ? ['enroll', 'promote', 'resign', 'updateuser', 'demote', 'staffjourneypost', 'monthly_milestone']
    : [input.command];

  const posted = [];
  for (const type of types) {
    let confirmation = '';
    let success = '';
    let publicPreview = '';
    if (type === 'enroll') {
      confirmation = `Are you sure you want to enroll ${member} into Staff Journey as **Leadership Intern**?`;
      success = `\u2705 ${member} has been enrolled into Staff Journey as Leadership Intern!! WOO, you may now create the staff journey announcement.`;
      publicPreview = promotionAnnouncement({ username, rank: 'Leadership Intern', customMessage: message, promoters: noPingPromoters, memberId: member.id, cardUrl: fakeUrl });
    } else if (type === 'promote') {
      confirmation = `Are you sure you want to promote ${member} from **${current?.rank || 'Supervisor'}** to **${selectedRank}**?`;
      success = `\u2705 Promotion complete!\n${member} has been promoted to **${selectedRank}**. Their Staff Journey card, rank history, labels, and announcement have been updated.`;
      publicPreview = promotionAnnouncement({ username, rank: selectedRank, customMessage: message, promoters: noPingPromoters, memberId: member.id, cardUrl: fakeUrl });
    } else if (type === 'resign') {
      confirmation = `Are you sure you want to archive ${member}\u2019s Staff Journey from **${current?.rank || selectedRank}** as resigned?`;
      success = `\u2705 Resignation complete!\n${member}\u2019s Staff Journey has been closed as a resignation. Their history has been preserved.`;
      const promoterNames = card ? allPromoterNames(card.desc) : promoterInfos.map((p) => p.robloxName);
      const resolved = card ? await resolvePromoterNamesToDisplay(interaction.guild, promoterNames) : noPingPromoters.map((p) => ({ ...p, text: p.mention }));
      publicPreview = resignationAnnouncement({ username, rank: current?.rank || selectedRank, customMessage: message, promoters: resolved, memberId: member.id, cardUrl: fakeUrl });
    } else if (type === 'updateuser') {
      confirmation = `Are you sure you want to update the Staff Journey card for **${username}** to **${input.newUsername || `${username}_NEW`}**?`;
      success = `\u2705 Staff Journey updated from **${username}** to **${input.newUsername || `${username}_NEW`}**.`;
      publicPreview = '*No public announcement is posted by /updateuser.*';
    } else if (type === 'demote') {
      confirmation = `Are you sure you want to demote ${member} from **${current?.rank || 'Assistant Manager'}** to **${selectedRank}**?`;
      success = `\u2705 Demotion complete! No public announcement was posted.`;
      publicPreview = '*No public announcement is posted by /demote.*';
    } else if (type === 'staffjourneypost') {
      confirmation = `Are you sure you want to post a **${input.announcementType || 'promotion'}** Staff Journey announcement for ${member}?`;
      success = `\u2705 Staff Journey ${input.announcementType || 'promotion'} announcement posted for ${member}.`;
      if ((input.announcementType || 'promotion') === 'resignation') {
        const promoterNames = card ? allPromoterNames(card.desc) : promoterInfos.map((p) => p.robloxName);
        const resolved = card ? await resolvePromoterNamesToDisplay(interaction.guild, promoterNames) : noPingPromoters.map((p) => ({ ...p, text: p.mention }));
        publicPreview = resignationAnnouncement({ username, rank: current?.rank || selectedRank, customMessage: message, promoters: resolved, memberId: member.id, cardUrl: fakeUrl });
      } else publicPreview = promotionAnnouncement({ username, rank: selectedRank, customMessage: message, promoters: noPingPromoters, memberId: member.id, cardUrl: fakeUrl });
    } else if (type === 'monthly_milestone') {
      confirmation = '*Automatic at 12:00 AM Eastern \u2014 no confirmation in live mode.*';
      success = '\u2705 Test milestone preview generated. Live automation posts nothing when nobody has a milestone.';
      publicPreview = milestoneAnnouncement({ dateParts: currentEasternDate(), entries: [{ username, rank: current?.rank || selectedRank, months: Number(input.months || 1), cardUrl: fakeUrl, memberId: member.id }] });
    } else continue;

    const header = `## <:GlaceHotels:1489052500341297344> STAFF JOURNEY TEST \u2014 /${type === 'monthly_milestone' ? 'automatic milestone' : type}\n**Nothing below changes Trello, Supabase, roles, or real Staff Journey data. Pings are disabled in this channel.**`;
    await channel.send({ content: `${header}\n\n**Confirmation Preview**\n${confirmation}\n\n**Success Reply Preview**\n${success}`, allowedMentions: { parse: [], users: [], roles: [] } });
    await channel.send({ content: `**Public Announcement Preview**\n\n${publicPreview}`, allowedMentions: { parse: [], users: [], roles: [] } });
    posted.push(type);
  }
  return { posted, channel };
}

module.exports = {
  parseMmDdYyyy,
  rankByKey,
  rankByDisplay,
  resolveTargetMember,
  beginConfirmation,
  handleStaffJourneyInteraction,
  startStaffJourneyAutomation,
  stopStaffJourneyAutomation,
  runMilestoneAutomation,
  runStaffJourneyTest,
  currentRankEntry,
  findJourneyCardForMember,
  promotionAnnouncement,
  resignationAnnouncement,
  milestoneAnnouncement,
  __test: { parseHistoryLine, historyEntries, firstPromotionParts, closeCurrentAndAppend, buildResignedDescription, addFormerUsername, calendarDuration, humanDuration, nextMilestoneAfter, zonedIso, isoToEasternDateParts },
};

