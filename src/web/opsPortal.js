'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');
const {
  getTier,
  getTierLabel,
  getOpsLevel,
  outranks,
  normalizeRoleName,
  getMemberRoleNames,
} = require('../utils/permissions');
const { TIERS, WEBSITE_CAPABILITIES } = require('../config/access');
const { listLoaHistory } = require('../utils/loaStore');
const { listCurrentLoasForPortal } = require('../utils/loaManager');
const staffOps = require('../utils/staffOpsStore');
const promotionStore = require('../utils/promotionStore');
const staffRequestStore = require('../utils/staffRequestStore');
const staffRequestSystem = require('../utils/staffRequestSystem');
const {
  getUserActivity, getQuotaProfileForMember, getWeekRange, summarizeActivity,
  hasMetQuota, formatRangeLabel, getQuotaSource,
} = require('../utils/activityTracker');
const { listRobloxStaff, alignWithDiscord } = require('../utils/robloxStaffDirectory');
const { hasCurrentBoardMembers, routeNewPromotion, syncPromotionDiscord, postStageMessage } = require('../utils/promotionDiscord');
const { sendOperationsLog } = require('../utils/operationsLog');
const { listAudit: listCommandAudit } = require('../utils/operationsAudit');

const sessions = new Map();
const oauthStates = new Map();
const SESSION_COOKIE = 'gh_ops_session';
const STATE_COOKIE = 'gh_ops_oauth_state';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 1_000_000;
const ASSET_DIR = path.join(__dirname, 'assets');

function cleanExpired() {
  const now = Date.now();
  for (const [key, value] of sessions) if (!value || value.expiresAt <= now) sessions.delete(key);
  for (const [key, value] of oauthStates) if (!value || value.expiresAt <= now) oauthStates.delete(key);
}
setInterval(cleanExpired, 10 * 60 * 1000).unref?.();

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function parseCookies(req) {
  const result = {};
  const raw = String(req.headers.cookie || '');
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

function isHttps(req) {
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function appendSetCookie(res, cookie) {
  const existing = typeof res.getHeader === 'function' ? res.getHeader('Set-Cookie') : null;
  if (!existing) return res.setHeader('Set-Cookie', cookie);
  const values = Array.isArray(existing) ? existing : [existing];
  return res.setHeader('Set-Cookie', [...values, cookie]);
}

function setSessionCookie(req, res, value, maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000)) {
  const secure = isHttps(req) ? '; Secure' : '';
  appendSetCookie(res, `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/ops; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`);
}
function clearSessionCookie(req, res) {
  const secure = isHttps(req) ? '; Secure' : '';
  appendSetCookie(res, `${SESSION_COOKIE}=; Path=/ops; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}
function setOAuthStateCookie(req, res, value) {
  const secure = isHttps(req) ? '; Secure' : '';
  appendSetCookie(res, `${STATE_COOKIE}=${encodeURIComponent(value)}; Path=/ops; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(STATE_TTL_MS / 1000)}${secure}`);
}
function clearOAuthStateCookie(req, res) {
  const secure = isHttps(req) ? '; Secure' : '';
  appendSetCookie(res, `${STATE_COOKIE}=; Path=/ops; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function securityHeaders(res, contentType) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https://cdn.discordapp.com data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self' https://discord.com");
}
function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  securityHeaders(res, contentType);
  res.writeHead(status);
  res.end(text);
}
function sendJson(res, status, body) {
  securityHeaders(res, 'application/json; charset=utf-8');
  res.writeHead(status);
  res.end(JSON.stringify(body));
}
function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

function getBaseUrl(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (configured) return configured;
  const proto = isHttps(req) ? 'https' : 'http';
  return `${proto}://${req.headers.host}`;
}
function getOAuthConfig(req) {
  const clientId = process.env.DISCORD_CLIENT_ID || process.env.CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const redirectUri = process.env.OPS_REDIRECT_URI || `${getBaseUrl(req)}/ops/callback`;
  return { clientId, clientSecret, redirectUri };
}

async function readJsonBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function getSession(req) {
  cleanExpired();
  const id = parseCookies(req)[SESSION_COOKIE];
  if (!id) return null;
  const session = sessions.get(id);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(id);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return { id, ...session };
}

async function resolveGuildMember(client, userId) {
  const guildId = process.env.GUILD_ID || process.env.MAIN_GUILD_ID;
  if (!guildId) return { guild: null, member: null, error: 'GUILD_ID is not configured.' };
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { guild: null, member: null, error: 'The bot could not access the main Glace server.' };
  const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
  if (!member) return { guild, member: null, error: 'You are not a member of the main Glace server.' };
  return { guild, member, error: null };
}

async function requireFreshSession(req, res, client, minTier = WEBSITE_CAPABILITIES.viewDashboard) {
  const session = getSession(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'Not signed in.' });
    return null;
  }
  const { guild, member, error } = await resolveGuildMember(client, session.user.id);
  if (!guild || !member) {
    sessions.delete(session.id);
    clearSessionCookie(req, res);
    sendJson(res, 403, { ok: false, error: error || 'Your Glace server access could not be verified.' });
    return null;
  }
  const currentTier = getTier(member);
  if (currentTier < WEBSITE_CAPABILITIES.viewDashboard) {
    sessions.delete(session.id);
    clearSessionCookie(req, res);
    sendJson(res, 403, { ok: false, error: 'Your current Glace role no longer has portal access.' });
    return null;
  }
  session.guildId = guild.id;
  session.memberDisplayName = member.displayName;
  session.tier = currentTier;
  session.opsLevel = getOpsLevel(member);
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  const stored = sessions.get(session.id);
  if (stored) Object.assign(stored, session);
  if (currentTier < minTier) {
    sendJson(res, 403, { ok: false, error: `Requires ${getTierLabel(minTier)} or higher.` });
    return null;
  }
  return session;
}

function requireCsrf(req, res, session) {
  const received = String(req.headers['x-csrf-token'] || '');
  if (!received || received !== session.csrf) {
    sendJson(res, 403, { ok: false, error: 'Security token mismatch. Refresh the page and try again.' });
    return false;
  }
  return true;
}

async function discordOAuthCallback(req, res, url, client) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieState = parseCookies(req)[STATE_COOKIE];
  const savedState = state ? oauthStates.get(state) : null;
  if (state) oauthStates.delete(state);
  clearOAuthStateCookie(req, res);
  if (!code || !state || cookieState !== state || !savedState || savedState.expiresAt <= Date.now()) {
    return sendText(res, 400, 'The login link expired or was invalid. Return to /ops and try again.');
  }
  const { clientId, clientSecret, redirectUri } = getOAuthConfig(req);
  if (!clientId || !clientSecret) return sendText(res, 503, 'Discord OAuth is not configured.');
  const tokenBody = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: tokenBody });
  if (!tokenResponse.ok) {
    console.error('[OPS WEB] OAuth token exchange failed:', tokenResponse.status, await tokenResponse.text());
    return sendText(res, 502, 'Discord login failed while exchanging the authorization code.');
  }
  const token = await tokenResponse.json();
  const userResponse = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } });
  if (!userResponse.ok) return sendText(res, 502, 'Discord login failed while reading your account.');
  const user = await userResponse.json();
  const { guild, member, error } = await resolveGuildMember(client, user.id);
  if (!member) return sendText(res, 403, error || 'You do not have access.');
  const tier = getTier(member);
  if (tier < WEBSITE_CAPABILITIES.viewDashboard) return sendText(res, 403, `The portal requires ${getTierLabel(WEBSITE_CAPABILITIES.viewDashboard)} or higher.`);
  const sessionId = randomToken(32);
  sessions.set(sessionId, {
    user: {
      id: String(user.id),
      username: String(user.username || member.displayName || 'Unknown'),
      globalName: String(user.global_name || member.displayName || user.username || 'Unknown'),
      avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : null,
    },
    memberDisplayName: member.displayName,
    guildId: guild.id,
    tier,
    opsLevel: getOpsLevel(member),
    csrf: randomToken(24),
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  setSessionCookie(req, res, sessionId);
  redirect(res, '/ops');
}

function publicLoginPage(req) {
  const { clientId, clientSecret } = getOAuthConfig(req);
  const ready = Boolean(clientId && clientSecret);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#fffaf3"><title>Glace Hotels Management Portal</title><link rel="stylesheet" href="/ops/assets/ops.css?v=2.8.0"></head><body class="public-portal">
  <main class="login-shell resort-login">
    <section class="login-hero resort-hero">
      <div class="logo-lockup resort-logo"><div class="logo-mark">★</div><div class="logo-copy"><strong>GLACE HOTELS</strong><span>MANAGEMENT PORTAL</span></div></div>
      <div class="hero-content resort-hero-content">
        <div class="motto-block">
          <h1 class="resort-motto">The future is<br>what <em>YOU</em> create.</h1>
          <div class="motto-divider"><span></span><b>★</b><span></span></div>
          <p class="confidential-alert"><strong>** This system is used for CURRENT Interns+ employed at Glace Hotels. Confidential access restricted.</strong></p>
        </div>
        <section class="tier-showcase" aria-label="Glace Hotels leadership tiers">
          <div class="tier-showcase-title"><span></span><strong>BUILT FOR EVERY LEVEL OF LEADERSHIP</strong><span></span></div>
          <div class="tier-card-grid">
            <article class="tier-info-card presidential-card"><div class="tier-medallion crown-only">♛</div><h2>Presidential</h2><p>Keeps the team together, manages the entirety of the group, and supports the Board and Corporates. Makes the final decisions for the group, and works 70% behind the scenes.</p><i></i></article>
            <article class="tier-info-card board-card"><div class="tier-medallion">★★★★</div><h2>Corporate Board</h2><p>Manages the Corporate and lower teams to ensure a smooth operation, and makes important decisions for the group. You work 50% behind the scenes.</p><i></i></article>
            <article class="tier-info-card corporate-card"><div class="tier-medallion">★★★★</div><h2>Corporate</h2><p>Manages the lower teams, and manages staff, promotions, events, and more. You work 30% behind the scenes.</p><i></i></article>
            <article class="tier-info-card senior-card"><div class="tier-medallion">★★★</div><h2>Senior Management</h2><p>Supports the Management team and ensure communication between the two reaches higher level. In charge of higher level actions, and responsibilities. You work 20% behind the scenes.</p><i></i></article>
            <article class="tier-info-card management-card"><div class="tier-medallion">★★</div><h2>Management</h2><p>Supports the interns into growing into managements, working towards growth, learning, and leading. You work 10% Behind the scenes.</p><i></i></article>
            <article class="tier-info-card intern-card"><div class="tier-medallion">★</div><h2>Intern Team</h2><p>Growth, consistency, and working towards completing your internship and being promoted to Supervisor! You work 5% behind the scenes.</p><i></i></article>
          </div>
        </section>
      </div>
      <footer class="login-footer resort-footer"><span></span><b>THE FUTURE IS WHAT YOU CREATE.</b><span></span></footer>
    </section>
    <section class="login-panel resort-login-panel">
      <article class="login-card resort-login-card">
        <div class="welcome-star">★</div>
        <h1>Welcome back.</h1>
        <div class="welcome-divider"><span></span><b>★</b><span></span></div>
        <p class="lead">Sign in securely with your Discord account to access the Glace Hotels Management Portal.</p>
        ${ready ? '<a class="discord-button" href="/ops/login"><span>◈</span> Sign in with Discord</a>' : '<div class="oauth-error">OAuth setup is incomplete. Add <b>DISCORD_CLIENT_SECRET</b>, confirm <b>CLIENT_ID</b>, and set the redirect URL before opening the portal.</div>'}
        <div class="protected-line"><span></span><b>Protected. Private. Professional.</b><span></span></div>
        <div class="access-note privacy-note"><div class="privacy-shield">★</div><div><strong>This system is linked to Discord, and created by Man9ixe, our sign in process does not reveal anything more than your discord username and server roles.</strong></div></div>
      </article>
    </section>
  </main></body></html>`;
}

function portalPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#fffaf3"><title>Glace Hotels Management Portal</title><link rel="stylesheet" href="/ops/assets/ops.css?v=2.8.0"><script defer src="/ops/assets/ops.js?v=2.8.0"></script></head><body>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="logo-lockup"><div class="logo-mark">★</div><div class="logo-copy"><strong>GLACE HOTELS</strong><span>MANAGEMENT PORTAL</span></div></div>
      <div class="sidebar-profile"><div class="profile-line"><div id="profileAvatar"></div><div class="profile-copy"><strong id="profileName">Loading…</strong><span id="profileRole"></span></div></div></div>
      <div class="sidebar-section">Workspace</div>
      <nav class="nav">
        <button class="active" data-tab="dashboard" data-title="Staff Hub Dashboard" data-subtitle="A bright, role-aware view of the tools available to your current Glace tier."><span class="nav-icon">⌂</span><span>Dashboard</span></button>
        <button data-tab="requests" data-capability="viewStaffRequests" data-title="Staff Request Center" data-subtitle="Submit resignations, username updates, LOAs, LOA removals, and timezone changes; then follow each review."><span class="nav-icon">✉</span><span>Requests</span></button>
        <button data-tab="activity" data-capability="viewActivity" data-title="LI+ Activity" data-subtitle="Live quota activity pulled from the existing Discord session tracking system."><span class="nav-icon">◫</span><span>Activity</span></button>
        <button data-tab="staff" data-capability="viewStaffDirectory" data-title="Glace Staff Directory" data-subtitle="Current Intern+ staff aligned from the Roblox community ranks into Glace teams."><span class="nav-icon">♚</span><span>Staff List</span></button>
        <button data-tab="promotions" data-capability="viewPromotions" data-title="Promotion Submissions" data-subtitle="Corporate owns the submission from due diligence through verified completion."><span class="nav-icon">♛</span><span>Promotions</span></button>
        <button data-tab="cases" data-capability="viewStaffCases" data-title="Staff Actions" data-subtitle="Permanent coaching, warning, suspension, demotion, and termination records."><span class="nav-icon">◇</span><span>Staff Actions</span></button>
        <button data-tab="restricted" data-capability="viewRestrictedRecords" data-title="Restricted Records" data-subtitle="Confidential Board-level investigations and leadership decisions."><span class="nav-icon">◆</span><span>Restricted</span></button>
        <button data-tab="documents" data-capability="viewDocuments" data-title="Documentation" data-subtitle="Policies and internal resources filtered to your access tier."><span class="nav-icon">▤</span><span>Documents</span></button>
        <button data-tab="posts" data-capability="viewPosts" data-title="Schedules & Updates" data-subtitle="Website records paired with clean Discord announcements."><span class="nav-icon">✦</span><span>Updates</span></button>
        <button data-tab="loas" data-capability="viewLoas" data-title="Leave of Absence" data-subtitle="Current LOAs and permanent ended history from the Discord workflow."><span class="nav-icon">◔</span><span>LOAs</span></button>
        <button data-tab="audit" data-capability="viewAudit" data-title="System Audit" data-subtitle="A permanent trail of protected bot and portal activity."><span class="nav-icon">⌁</span><span>Audit Log</span></button>
      </nav>
      <div class="sidebar-bottom"><a href="/ops/logout"><span>Sign out</span></a></div>
    </aside>
    <main class="app-main">
      <header class="topbar"><div class="topbar-title"><strong>Glace Hotels Staff Hub</strong><span>The future is what YOU create.</span></div><div class="search"><input id="globalSearch" type="search" placeholder="Search this section…"></div><div class="top-actions"><span id="opsBadge" class="role-chip"></span><button class="icon-btn" type="button" aria-label="Portal status">★</button></div></header>
      <div id="loading" class="loading-screen"><div><div class="loading-orb"></div><div id="loadingMessage">Verifying your Glace server rank…</div></div></div>
      <div id="app" hidden class="content">
        <div id="previewBanner" class="preview-banner" hidden><div><strong id="previewBannerTitle">Preview mode</strong><span id="previewBannerCopy"></span></div><button id="exitPreview" class="btn small ghost" type="button">Exit Preview</button></div><div class="brand-motto-strip"><span class="brand-motto-star">★</span><span class="brand-motto-copy">The future is what <strong>YOU</strong> create.</span><span class="brand-confidential">CURRENT Interns+ · Confidential access restricted</span></div><div class="page-head"><div class="page-heading-copy"><span id="pageEyebrow" class="page-eyebrow">GLACE STAFF HUB</span><h1 id="pageTitle">Staff Hub Dashboard</h1><p id="pageSubtitle">Your Glace management workspace.</p></div><aside class="page-tier-card"><span class="access-view-kicker">Access view</span><strong id="pageTierLabel">Loading…</strong><div id="previewControl" class="preview-control" hidden><label for="previewTier">Preview another tier</label><select id="previewTier" aria-label="Preview another staff tier"><option value="8">Presidential</option><option value="7">Corporate Board</option><option value="6">Corporate</option><option value="5">Senior Management</option><option value="4">Management</option><option value="3">Intern Team</option></select></div></aside></div>

        <section id="section-dashboard" class="section active">
          <div id="dashboardStats" class="dashboard-grid"></div>
          <div class="panel-grid dashboard-panels">
            <article id="approvalPanel" class="panel queue-panel"><div class="panel-head"><div><span class="panel-kicker">Your action center</span><h2 id="approvalPanelTitle">Items Requiring Attention</h2></div><button id="approvalOpenButton" class="panel-link" data-go="promotions">Open</button></div><div id="approvalPreview" class="activity-list"></div></article>
            <div class="panel-stack dashboard-side"><article class="panel quick-panel"><div class="panel-head"><div><span class="panel-kicker">Available to you</span><h2>Quick Actions</h2></div></div><div id="quickActions" class="quick-grid"></div></article><article class="panel access-panel"><div class="panel-head"><div><span class="panel-kicker">Your current workspace</span><h2 id="workspaceTitle">What You Can Access</h2></div></div><div id="rankOverview" class="workspace-access-list"></div></article></div>
            <article class="panel journey-panel"><div class="panel-head"><div><span class="panel-kicker">Recent staff communications</span><h2>Staff Updates</h2></div><button class="panel-link" data-go="posts">View updates</button></div><div id="journeyFeed" class="activity-list journey-grid"></div></article>
            <article class="panel workflow-panel" data-capability="viewPromotions"><div class="panel-head"><div><span class="panel-kicker">Your promotion workspace</span><h2>Submission Workflow</h2></div></div><div class="workflow-steps"><span>1</span><p><b>Corporate completes due diligence</b> before submitting.</p><span>2</span><p><b>Corporate Board reviews</b> the completed submission, unless Presidential uses a documented override.</p><span>3</span><p><b>Presidential provides final approval</b> or may approve directly when an override is needed.</p><span>4</span><p><b>The assigned Corporate member carries it out</b> and confirms completion.</p></div></article>
          </div>
        </section>

        <section id="section-requests" class="section">
          <div class="request-header panel"><div><span class="panel-kicker">Self-service for current Interns+</span><h2>Staff Request Center</h2><p>Submit your own request. The bot sends it to the correct private review channel and sends status receipts by DM.</p></div><button id="postRequestPanel" class="btn gold" type="button" data-capability="postStaffRequestPanel">Post Discord Request Panel</button></div>
          <div class="request-policy panel"><strong>Review routing:</strong> Corporate+ reviews Intern through Senior Management requests. Presidential reviews Corporate+ requests. Resignations route to Corporate Board. Only one reviewer may claim and complete each request.</div>
          <div class="workspace request-workspace">
            <article class="form-card request-form-card" data-capability="submitStaffRequest"><h2>Resignation</h2><p>Corporate Board receives resignation submissions.</p><form id="resignationRequestForm" data-request-type="resignation" class="form-grid"><div class="field"><label>Username</label><input name="username" required></div><div class="field"><label>Former Rank</label><input name="formerRank" required></div><div class="field"><label>New Rank</label><input name="newRank" required placeholder="Example: Former Staff"></div><div class="field full"><label>Notes</label><textarea name="notes"></textarea></div><button class="btn danger full" type="submit">Submit Resignation</button></form></article>
            <article class="form-card request-form-card" data-capability="submitStaffRequest"><h2>Username Update</h2><p>You may submit a new one whenever your username changes.</p><form id="usernameRequestForm" data-request-type="username_update" class="form-grid"><div class="field"><label>Former Username</label><input name="formerUsername" required></div><div class="field"><label>New Username</label><input name="newUsername" required></div><div class="field full"><label>Rank</label><input name="rank" required></div><button class="btn purple full" type="submit">Submit Username Update</button></form></article>
            <article class="form-card request-form-card" data-capability="submitStaffRequest"><h2>Leave of Absence</h2><p>Must start on Monday and end on Sunday. Returning midweek does not remove that week's quota.</p><form id="loaRequestForm" data-request-type="loa" class="form-grid"><div class="field"><label>Username</label><input name="username" required></div><div class="field"><label>Rank</label><input name="rank" required></div><div class="field"><label>Start Date — Monday</label><input name="startDate" placeholder="MM/DD/YYYY" required></div><div class="field"><label>End Date — Sunday</label><input name="endDate" placeholder="MM/DD/YYYY" required></div><div class="field full"><label>Reason</label><textarea name="reason" required></textarea></div><button class="btn primary full" type="submit">Submit LOA Request</button></form></article>
            <article class="form-card request-form-card" data-capability="submitStaffRequest"><h2>LOA Removal</h2><p>Submit this when you are ready to come off your current LOA.</p><form id="loaRemovalRequestForm" data-request-type="loa_removal" class="form-grid"><div class="field"><label>Username</label><input name="username" required></div><div class="field"><label>Rank</label><input name="rank" required></div><div class="field full"><label>Week(s) on LOA</label><input name="weeksOnLoa" required placeholder="Example: 2 weeks"></div><button class="btn gold full" type="submit">Submit LOA Removal</button></form></article>
            <article class="form-card request-form-card" data-capability="submitStaffRequest"><h2>Timezone Update</h2><p>You may submit a new one whenever your timezone changes.</p><form id="timezoneRequestForm" data-request-type="timezone_change" class="form-grid"><div class="field"><label>Username</label><input name="username" required></div><div class="field"><label>Timezone</label><input name="timezone" required placeholder="Example: EST or America/New_York"></div><button class="btn gold full" type="submit">Submit Timezone Update</button></form></article>
          </div>
          <article id="staffRequestReviewPanel" class="list-card" data-capability="reviewStaffRequestsCorporate"><div class="toolbar"><div><h2>Requests Routed to Your Team</h2><p>Buttons are permission checked. The first reviewer is recorded; other reviewers are blocked until the review is released.</p></div><span id="requestStorageBadge" class="storage-badge"></span></div><div id="staffRequestReviewList" class="record-list"></div></article>
          <article class="list-card" style="margin-top:16px"><h2>My Requests</h2><p>You will also receive Discord DMs when a request changes.</p><div id="myRequestList" class="record-list"></div></article>
        </section>

        <section id="section-activity" class="section">
          <div id="myActivitySummary" class="activity-summary-grid"></div>
          <article class="list-card"><div class="toolbar"><div><h2>Current Activity</h2><p>Live data is pulled from the bot's existing Discord session-log tracker.</p></div><span id="activitySourceBadge" class="storage-badge ready">Discord session logs</span></div><div id="activityBreakdown" class="activity-breakdown"></div></article>
          <article class="list-card" style="margin-top:16px" data-capability="viewAllActivity"><h2>LI+ Activity Directory</h2><p>Current-week quota progress for active Leadership Intern+ Discord members.</p><div id="activityDirectory" class="record-list"></div></article>
        </section>

        <section id="section-staff" class="section">
          <article class="list-card"><div class="toolbar"><div><h2>Roblox Community Staff List</h2><p>Current Intern+ community ranks aligned into the Glace team hierarchy.</p></div><button id="refreshStaffDirectory" class="btn small ghost" type="button">Refresh</button></div><div id="staffDirectoryStatus" class="directory-status"></div><div id="staffDirectory" class="staff-directory-grid"></div></article>
        </section>

        <section id="section-promotions" class="section">
          <div class="workspace">
            <article class="form-card" data-capability="submitPromotion"><h2 id="promotionFormTitle">New Promotion Submission</h2><p>This is not an investigation request. Complete all due diligence before submitting. The original Corporate submitter remains responsible for carrying out the approved promotion.</p>
              <form id="promotionForm" class="form-grid"><input id="promotionId" type="hidden">
                <div class="field"><label>Candidate Discord ID</label><input name="candidateId" required placeholder="Required for final verification"></div>
                <div class="field"><label>Candidate Username</label><input name="candidateUsername" required></div>
                <div class="field"><label>Current Rank</label><input name="currentRank" required></div>
                <div class="field"><label>Proposed Rank</label><input name="proposedRank" required placeholder="Example: Supervisor"></div>
                <div class="field full"><label>Proposed Access Tier</label><select name="proposedTier" required><option value="3">Intern Team — Pink</option><option value="4">Management — Purple</option><option value="5">Senior Management — Green</option><option value="6">Corporate — Red</option><option value="7">Corporate Board — Orange</option><option value="8">Presidential — Gold</option></select></div>
                <div class="field full"><label>Promotion Recommendation</label><textarea name="reason" required placeholder="Explain why this person is ready now."></textarea></div>
                <div class="field full"><label>Due-Diligence Evidence</label><textarea name="evidence" required placeholder="Activity, quota, time in rank, sessions, conduct checks, links, and any relevant records reviewed."></textarea></div>
                <div class="field full"><label>Strengths & Readiness</label><textarea name="strengths" required></textarea></div>
                <div class="field full"><label>Concerns Disclosed</label><textarea name="concerns" placeholder="Enter none if no concerns were found."></textarea></div>
                <label class="checkline full"><input type="checkbox" name="diligenceConfirmed" required><span>I confirm that I reviewed this staff member’s activity, conduct, eligibility, time in rank, LOAs, and relevant records before submitting.</span></label>
                <div class="full" style="display:flex;gap:9px"><button id="promotionSubmit" class="btn primary" type="submit">Submit for Board Review</button><button id="promotionReset" class="btn ghost" type="button">Reset</button></div>
              </form>
            </article>
            <article class="list-card"><div class="toolbar"><div><h2>Promotion Queue</h2><p>Approval and completion are tracked separately. Public Staff Journey announcements remain manual.</p></div><span id="promotionStorageBadge" class="storage-badge"></span></div><div id="promotionList" class="record-list"></div></article>
          </div>
        </section>

        <section id="section-cases" class="section"><div class="workspace"><article class="form-card" data-capability="createRoutineCase"><h2>New Staff Action</h2><p>Routine actions save immediately. Serious actions remain pending until Corporate Board decides.</p><form id="caseForm" class="form-grid"><div class="field"><label>Discord ID</label><input name="targetId"></div><div class="field"><label>Username</label><input name="targetUsername" required></div><div class="field"><label>Current Rank</label><input name="targetRank" required></div><div class="field"><label>Action Type</label><select name="actionType"><option value="staff_note">Staff Note</option><option value="coaching">Coaching</option><option value="staff_warning">Staff Warning</option><option value="suspension">Suspension</option><option value="demotion">Demotion</option><option value="termination">Termination</option><option value="appeal">Appeal</option></select></div><div class="field"><label>Warning Count</label><input name="staffWarningCount" type="number" min="0"></div><div class="field"><label>Length</label><input name="length" placeholder="Example: 7 days"></div><div class="field"><label>Start Date</label><input name="startDate" type="date"></div><div class="field"><label>End Date</label><input name="endDate" type="date"></div><div class="field full"><label>Reason</label><textarea name="reason" required></textarea></div><div class="field full"><label>Evidence / Message / Trello Link</label><input name="evidence"></div><button class="btn primary full" type="submit">Save Staff Action</button></form></article><article class="list-card"><h2>Staff Action Records</h2><p>Permanent punishment and coaching history.</p><div id="caseList" class="record-list"></div></article></div></section>

        <section id="section-restricted" class="section"><div class="workspace"><article class="form-card" data-capability="manageRestrictedRecords"><h2>New Restricted Record</h2><p>For major investigations, executive complaints, severe misconduct, and do-not-rehire documentation. Access and changes are audited.</p><form id="restrictedForm" class="form-grid"><div class="field"><label>Subject Discord ID</label><input name="subjectId"></div><div class="field"><label>Subject Name</label><input name="subjectName" required></div><div class="field full"><label>Category</label><select name="category"><option>Major Investigation</option><option>Executive Complaint</option><option>Severe Misconduct</option><option>Leadership Decision</option><option>Do Not Rehire</option><option>Other Confidential</option></select></div><div class="field full"><label>Confidential Summary</label><textarea name="summary" required></textarea></div><div class="field full"><label>Evidence / Protected Links</label><textarea name="evidence"></textarea></div><button class="btn orange full" type="submit">Create Restricted Record</button></form></article><article class="list-card"><h2>Restricted Records</h2><p>Visible only to Corporate Board and Presidential access.</p><div id="restrictedList" class="record-list"></div></article></div></section>

        <section id="section-documents" class="section"><div class="workspace"><article class="form-card" data-capability="manageDocuments"><h2>Publish Documentation</h2><p>Visibility is enforced by current Discord tier on every load.</p><form id="documentForm" class="form-grid"><div class="field full"><label>Title</label><input name="title" required></div><div class="field"><label>Category</label><input name="category" value="General" required></div><div class="field"><label>Minimum Tier</label><select name="visibilityTier"><option value="4">Management+</option><option value="5">Senior Management+</option><option value="6">Corporate+</option><option value="7">Corporate Board+</option><option value="8">Presidential only</option></select></div><div class="field full"><label>Content</label><textarea name="content" required style="min-height:200px"></textarea></div><button class="btn primary full" type="submit">Publish Document</button></form></article><article class="list-card"><h2>Documentation Library</h2><p>Only documents available to your rank are shown.</p><div id="documentList" class="record-list"></div></article></div></section>

        <section id="section-posts" class="section"><div class="workspace"><article class="form-card" data-capability="publishUpdate"><h2>Publish Schedule or Update</h2><p>The website stores the permanent version and the bot posts the clean Discord display.</p><form id="postForm" class="form-grid"><div class="field"><label>Post Type</label><select name="type"><option value="update">Staff Update</option><option value="schedule">Staff Schedule</option></select></div><div class="field"><label>Title</label><input name="title" required></div><div class="field full"><label>Content</label><textarea name="content" required style="min-height:190px"></textarea></div><button class="btn pink full" type="submit">Save & Post to Discord</button></form></article><article class="list-card"><h2>Schedules & Updates</h2><p>Inactivity notices, time-zone changes, resignations, schedules, and operational updates.</p><div id="postList" class="record-list"></div></article></div></section>

        <section id="section-loas" class="section"><div class="panel"><div class="panel-head"><div><span class="panel-kicker">LIVE DISCORD SYNC</span><h2>Current LOAs</h2><p>Synced from the active LOA system and current LOA channel.</p></div></div><div id="loaList" class="record-list"></div></div><div class="panel" style="margin-top:14px"><div class="panel-head"><h2>Ended LOA History</h2></div><div id="loaHistoryList" class="record-list"></div></div></section>
        <section id="section-audit" class="section"><article class="list-card"><h2>Protected Audit Trail</h2><p>Website actions and high-impact Discord commands are preserved here.</p><div id="auditList" class="record-list"></div></article></section>
      </div>
    </main>
  </div>
  <div id="notice" class="notice"></div>
  <dialog id="decisionDialog" class="dialog"><div class="dialog-head"><h3 id="decisionTitle">Update Record</h3><button id="decisionCancel" class="btn small ghost" type="button">Close</button></div><div class="dialog-body"><p id="decisionCopy" style="color:var(--muted);font-size:12px;line-height:1.55"></p><div id="decisionStatusWrap" class="field" hidden><label>New Status</label><select id="decisionStatus"></select></div><div class="field" style="margin-top:12px"><label>Decision / Outcome Note</label><textarea id="decisionReason" required></textarea></div></div><div class="dialog-actions"><button id="decisionSubmit" class="btn primary" type="button">Save Decision</button></div></dialog>
  <dialog id="reassignDialog" class="dialog"><div class="dialog-head"><h3>Reassign Promotion Completion</h3><button id="reassignCancel" class="btn small ghost" type="button">Close</button></div><form id="reassignForm"><input id="reassignId" type="hidden"><div class="dialog-body"><div class="form-grid"><div class="field"><label>New Corporate Discord ID</label><input name="assigneeId" required></div><div class="field"><label>Display Name</label><input name="assigneeTag" required></div><div class="field full"><label>Reason for Reassignment</label><textarea name="reason" required></textarea></div></div></div><div class="dialog-actions"><button class="btn primary" type="submit">Reassign</button></div></form></dialog>
  </body></html>`;
}

function viewerCapabilities(tier) {
  return Object.fromEntries(Object.entries(WEBSITE_CAPABILITIES).map(([key, required]) => [key, tier >= required]));
}

function buildFeed({ posts, loas }) {
  const feed = [];
  for (const item of posts.slice(0, 20)) {
    feed.push({ icon: item.type === 'schedule' ? '▤' : '✦', tier: item.type === 'schedule' ? TIERS.MANAGEMENT : TIERS.INTERN, title: item.title, detail: `${item.type === 'schedule' ? 'Schedule' : 'Staff update'} by ${item.createdByTag || 'Unknown'}`, createdAt: item.createdAt });
  }
  for (const item of loas.slice(0, 20)) {
    feed.push({ icon: '◔', tier: TIERS.SENIOR_MANAGEMENT, title: 'Active LOA', detail: `${item.originalDisplayName || item.staffCardName || item.userId} • through ${item.officialEndDate || 'unknown'}`, createdAt: item.createdAt || item.startedAt || new Date().toISOString() });
  }
  return feed.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 30);
}

async function activitySnapshot(client, member, guildId) {
  const profile = getQuotaProfileForMember(member);
  if (!profile) return null;
  const currentRange = getWeekRange(0);
  const lastRange = getWeekRange(-1);
  const activity = await getUserActivity(client, member.id, { guildId });
  const currentSummary = summarizeActivity(activity, currentRange);
  const lastSummary = summarizeActivity(activity, lastRange);
  const currentSource = getQuotaSource(currentSummary, profile);
  const lastSource = getQuotaSource(lastSummary, profile);
  return {
    userId: member.id,
    displayName: member.displayName || member.user?.globalName || member.user?.username,
    username: member.user?.username || '',
    tier: getTier(member),
    tierLabel: getTierLabel(getTier(member)),
    quotaProfile: {
      key: profile.key,
      label: profile.label,
      quota: profile.quota || {},
      visibleRoleKeys: profile.visibleRoleKeys || [],
    },
    current: {
      rangeLabel: formatRangeLabel(currentRange),
      met: hasMetQuota(currentSummary, profile),
      source: currentSource,
      hosted: currentSummary.hosted || {},
      support: currentSummary.support || {},
    },
    last: {
      rangeLabel: formatRangeLabel(lastRange),
      met: hasMetQuota(lastSummary, profile),
      source: lastSource,
      hosted: lastSummary.hosted || {},
      support: lastSummary.support || {},
    },
  };
}

async function buildPortalActivity(client, session, capabilities) {
  if (!capabilities.viewActivity) return { self: null, directory: [] };
  const { guild, member } = await resolveGuildMember(client, session.user.id);
  if (!guild || !member) return { self: null, directory: [] };
  const self = await activitySnapshot(client, member, session.guildId);
  if (!capabilities.viewAllActivity) return { self, directory: [] };
  const members = await guild.members.fetch().catch(() => guild.members.cache);
  const tracked = [...members.values()]
    .filter((item) => !item.user?.bot && getTier(item) >= TIERS.INTERN)
    .sort((a, b) => getTier(b) - getTier(a) || a.displayName.localeCompare(b.displayName))
    .slice(0, 250);
  const directory = [];
  for (const item of tracked) {
    const snapshot = await activitySnapshot(client, item, session.guildId);
    if (snapshot) directory.push(snapshot);
  }
  return { self, directory };
}

async function buildRobloxDirectory(client, session, capabilities) {
  if (!capabilities.viewStaffDirectory) return { configured: false, members: [], roles: [], error: null };
  const result = await listRobloxStaff();
  if (!result.configured || result.error) return result;
  const { guild } = await resolveGuildMember(client, session.user.id);
  const members = guild ? await guild.members.fetch().catch(() => guild.members.cache) : new Map();
  const profiles = await staffRequestStore.listProfiles(session.guildId).catch(() => []);
  return { ...result, members: alignWithDiscord(result.members, [...members.values()], profiles) };
}

function visibleStaffRequests(all, session) {
  if (session.tier >= TIERS.PRESIDENTIAL) return all;
  if (session.tier >= TIERS.CORPORATE_BOARD) {
    return all.filter((item) => item.status === 'pending_board' || Number(item.requesterTier) < TIERS.CORPORATE || String(item.requesterId) === String(session.user.id));
  }
  if (session.tier >= TIERS.CORPORATE) {
    return all.filter((item) => Number(item.requesterTier) < TIERS.CORPORATE || String(item.requesterId) === String(session.user.id));
  }
  return all.filter((item) => String(item.requesterId) === String(session.user.id));
}

async function bootstrap(session, client) {
  const capabilities = viewerCapabilities(session.tier);
  const [allPromotions, allStaffRequests, activity, staffDirectory] = await Promise.all([
    promotionStore.list({ guildId: session.guildId, limit: 500 }),
    staffRequestStore.list({ guildId: session.guildId, limit: 500 }),
    buildPortalActivity(client, session, capabilities),
    buildRobloxDirectory(client, session, capabilities),
  ]);
  const documents = capabilities.viewDocuments
    ? staffOps.listDocuments({ guildId: session.guildId }).filter((doc) => session.tier >= Number(doc.visibilityTier || TIERS.MANAGEMENT))
    : [];
  const posts = capabilities.viewPosts ? staffOps.listPosts({ guildId: session.guildId }) : [];
  const loas = capabilities.viewLoas ? await listCurrentLoasForPortal(client, session.guildId) : [];
  const loaHistory = capabilities.viewLoas ? listLoaHistory(session.guildId, 100) : [];
  const visibleRequests = visibleStaffRequests(allStaffRequests, session);
  const reviewRequests = session.tier >= TIERS.PRESIDENTIAL
    ? allStaffRequests.filter((item) => ['pending_presidential', 'pending_board', 'pending_corporate'].includes(item.status))
    : session.tier >= TIERS.CORPORATE_BOARD
      ? allStaffRequests.filter((item) => ['pending_board', 'pending_corporate'].includes(item.status))
      : session.tier >= TIERS.CORPORATE
        ? allStaffRequests.filter((item) => item.status === 'pending_corporate')
        : [];
  const audit = capabilities.viewAudit ? [
    ...staffOps.listAudit({ limit: 200 }),
    ...await promotionStore.listAudit({ limit: 200, guildId: session.guildId }),
    ...await staffRequestStore.listAudit({ limit: 200, guildId: session.guildId }),
    ...listCommandAudit({ limit: 200, guildId: session.guildId }).map((entry) => ({
      id: entry.id,
      action: `/${entry.command || 'unknown'} • ${entry.status || 'executed'}`,
      actorId: entry.actorId,
      actorTag: entry.actorTag,
      details: entry.options || {},
      createdAt: entry.timestamp,
    })),
  ].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 300) : [];

  return {
    viewer: {
      id: session.user.id,
      username: session.user.username,
      displayName: session.memberDisplayName || session.user.globalName,
      avatar: session.user.avatar,
      tier: session.tier,
      tierLabel: getTierLabel(session.tier),
      opsLevel: session.opsLevel,
      canPreviewTiers: session.tier >= TIERS.PRESIDENTIAL,
    },
    capabilities,
    capabilityMinimums: WEBSITE_CAPABILITIES,
    promotions: capabilities.viewPromotions ? allPromotions : [],
    staffRequests: capabilities.viewStaffRequests ? visibleRequests : [],
    reviewStaffRequests: reviewRequests,
    requestStorage: staffRequestStore.storageMode(),
    activity,
    staffDirectory,
    cases: capabilities.viewStaffCases ? staffOps.listCases({ guildId: session.guildId }) : [],
    restrictedRecords: capabilities.viewRestrictedRecords ? staffOps.listRestrictedRecords({ guildId: session.guildId }) : [],
    documents,
    posts,
    audit,
    loas,
    loaHistory,
    feed: buildFeed({ posts, loas }),
    promotionStorage: promotionStore.storageMode(),
    csrf: session.csrf,
  };
}

async function canActOnWebsiteTarget(client, session, targetId, { allowEqual = false } = {}) {
  const cleanId = String(targetId || '').trim();
  if (!cleanId) return { ok: true };
  const { guild, member: actor } = await resolveGuildMember(client, session.user.id);
  if (!guild || !actor) return { ok: false, error: 'Your current Glace role could not be verified.' };
  const target = guild.members.cache.get(cleanId) || await guild.members.fetch(cleanId).catch(() => null);
  if (!target) return { ok: true };
  if (!outranks(actor, target, { allowEqual })) return { ok: false, error: allowEqual ? 'You cannot submit this action for someone above your current tier.' : 'You cannot create or decide a record for someone at your current tier or above it.' };
  return { ok: true, target, guild, actor };
}

async function publishDiscordPost(client, session, input) {
  const channelId = input.type === 'schedule'
    ? (process.env.STAFF_SCHEDULE_CHANNEL_ID || process.env.STAFF_POSTS_CHANNEL_ID)
    : (process.env.STAFF_UPDATES_CHANNEL_ID || process.env.STAFF_POSTS_CHANNEL_ID);
  if (!channelId) return { posted: false, channelId: null, messageId: null, warning: 'Saved, but the Discord post channel is not configured.' };
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return { posted: false, channelId, messageId: null, warning: 'Saved, but the configured Discord channel could not be found.' };
  const embed = new EmbedBuilder()
    .setTitle(String(input.title || (input.type === 'schedule' ? 'Staff Schedule' : 'Staff Update')).slice(0, 256))
    .setDescription(String(input.content || '').slice(0, 4096))
    .setColor(input.type === 'schedule' ? 0x8b5cf6 : 0xec4899)
    .setFooter({ text: `Glace Hotels • Published by ${session.memberDisplayName || session.user.username}` })
    .setTimestamp(new Date());
  const message = await channel.send({ embeds: [embed] });
  return { posted: true, channelId: channel.id, messageId: message.id, warning: null };
}

async function verifyPromotionCompletion(client, entry) {
  const guildId = entry.guildId || process.env.GUILD_ID || process.env.MAIN_GUILD_ID;
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { ok: false, error: 'The Glace server could not be accessed for verification.' };
  const candidate = guild.members.cache.get(entry.candidateId) || await guild.members.fetch(entry.candidateId).catch(() => null);
  if (!candidate) return { ok: false, error: 'The candidate is not currently in the Glace server.' };
  const verifiedTier = getTier(candidate);
  const roleNames = getMemberRoleNames(candidate);
  const proposed = normalizeRoleName(entry.proposedRank);
  const rankMatched = proposed && roleNames.some((name) => name === proposed || name.includes(proposed) || proposed.includes(name));
  if (verifiedTier < Number(entry.proposedTier)) {
    return { ok: false, error: `The candidate still appears as ${getTierLabel(verifiedTier)}. Apply the approved Discord rank before completing.` };
  }
  if (!rankMatched) {
    return { ok: false, error: `The candidate does not appear to have a Discord role matching “${entry.proposedRank}”. Current detected roles: ${roleNames.slice(0, 10).join(', ') || 'none'}.` };
  }
  return { ok: true, discordVerified: true, verifiedTier, matchedRole: roleNames.find((name) => name === proposed || name.includes(proposed) || proposed.includes(name)) };
}

async function handlePromotionApi(req, res, url, client, method) {
  if (url.pathname === '/ops/api/promotions' && method === 'POST') {
    const session = await requireFreshSession(req, res, client, WEBSITE_CAPABILITIES.submitPromotion);
    if (!session || !requireCsrf(req, res, session)) return true;
    const body = await readJsonBody(req);
    const required = ['candidateId', 'candidateUsername', 'currentRank', 'proposedRank', 'reason', 'evidence', 'strengths'];
    if (required.some((key) => !String(body[key] || '').trim()) || body.diligenceConfirmed !== true) {
      sendJson(res, 400, { ok: false, error: 'Complete every required field and confirm due diligence before submitting.' });
      return true;
    }
    const hierarchy = await canActOnWebsiteTarget(client, session, body.candidateId, { allowEqual: true });
    if (!hierarchy.ok) return sendJson(res, 403, { ok: false, error: hierarchy.error }) || true;
    const resolved = hierarchy.guild ? { guild: hierarchy.guild } : await resolveGuildMember(client, session.user.id);
    const boardAvailable = await hasCurrentBoardMembers(resolved.guild);
    let entry = await promotionStore.create({
      ...body,
      guildId: session.guildId,
      initialStatus: boardAvailable ? 'board_review' : 'presidential_review',
      boardAutoSkipped: !boardAvailable,
      boardAutoSkipReason: boardAvailable ? '' : 'No current Corporate Board members were detected when this request was submitted.',
    }, { id: session.user.id, tag: session.memberDisplayName });
    try { entry = await routeNewPromotion(client, resolved.guild, entry); }
    catch (error) { console.error('[PROMOTION ROUTING] Submission routing failed:', error); }
    await sendOperationsLog(client, resolved.guild, {
      title: `Promotion Submission ${entry.submissionNumber}`,
      fields: [
        { name: 'Candidate', value: `${entry.candidateUsername} (${entry.candidateId})` },
        { name: 'Promotion', value: `${entry.currentRank} → ${entry.proposedRank}` },
        { name: 'Corporate Owner', value: entry.submittedByTag },
        { name: 'Status', value: boardAvailable ? 'Corporate Board Review' : 'Presidential Review — Board unavailable' },
      ],
    });
    sendJson(res, 201, { ok: true, entry, warning: boardAvailable ? null : 'No current Corporate Board members were detected, so this was routed directly to Presidential review.' });
    return true;
  }

  const match = url.pathname.match(/^\/ops\/api\/promotions\/([^/]+)$/);
  if (!match || method !== 'PATCH') return false;
  const body = await readJsonBody(req);
  const id = decodeURIComponent(match[1]);
  const current = await promotionStore.get(id);
  if (!current) return sendJson(res, 404, { ok: false, error: 'Promotion submission not found.' }) || true;

  if (body.action === 'board_decision') {
    const session = await requireFreshSession(req, res, client, WEBSITE_CAPABILITIES.reviewPromotionBoard);
    if (!session || !requireCsrf(req, res, session)) return true;
    if (String(current.guildId) !== String(session.guildId)) return sendJson(res, 404, { ok: false, error: 'Promotion submission not found.' }) || true;
    if (String(current.submittedById) === String(session.user.id)) return sendJson(res, 403, { ok: false, error: 'You cannot provide Board approval for a promotion you submitted.' }) || true;
    const actor = { id: session.user.id, tag: session.memberDisplayName };
    let entry = await promotionStore.boardDecision(id, body.decision, body.reason, actor);
    entry = await syncPromotionDiscord(client, entry, `board_${body.decision}`, actor);
    sendJson(res, 200, { ok: true, entry });
    return true;
  }

  if (body.action === 'presidential_override') {
    const session = await requireFreshSession(req, res, client, WEBSITE_CAPABILITIES.approvePromotionPresidential);
    if (!session || !requireCsrf(req, res, session)) return true;
    if (String(current.guildId) !== String(session.guildId)) return sendJson(res, 404, { ok: false, error: 'Promotion submission not found.' }) || true;
    if (!String(body.reason || '').trim()) return sendJson(res, 400, { ok: false, error: 'A Presidential override reason is required for the audit record.' }) || true;
    const actor = { id: session.user.id, tag: session.memberDisplayName };
    let entry = await promotionStore.presidentialOverride(id, body.reason, actor);
    entry = await syncPromotionDiscord(client, entry, 'presidential_override', actor);
    const { guild } = await resolveGuildMember(client, session.user.id);
    await sendOperationsLog(client, guild, {
      title: `${entry.submissionNumber} Presidential Override`,
      fields: [
        { name: 'Candidate', value: entry.candidateUsername || entry.candidateId },
        { name: 'Promotion', value: `${entry.currentRank} → ${entry.proposedRank}` },
        { name: 'Override By', value: session.memberDisplayName || session.user.username },
        { name: 'Status', value: entry.status.replaceAll('_', ' ') },
        { name: 'Reason', value: String(body.reason).slice(0, 1024) },
      ],
    });
    sendJson(res, 200, { ok: true, entry });
    return true;
  }

  if (body.action === 'presidential_decision') {
    const session = await requireFreshSession(req, res, client, WEBSITE_CAPABILITIES.approvePromotionPresidential);
    if (!session || !requireCsrf(req, res, session)) return true;
    if (String(current.guildId) !== String(session.guildId)) return sendJson(res, 404, { ok: false, error: 'Promotion submission not found.' }) || true;
    const actor = { id: session.user.id, tag: session.memberDisplayName };
    let entry = await promotionStore.presidentialDecision(id, body.decision, body.reason, actor);
    entry = await syncPromotionDiscord(client, entry, `presidential_${body.decision}`, actor);
    sendJson(res, 200, { ok: true, entry });
    return true;
  }

  if (body.action === 'resubmit') {
    const session = await requireFreshSession(req, res, client, WEBSITE_CAPABILITIES.submitPromotion);
    if (!session || !requireCsrf(req, res, session)) return true;
    if (String(current.guildId) !== String(session.guildId)) return sendJson(res, 404, { ok: false, error: 'Promotion submission not found.' }) || true;
    if (!body.diligenceConfirmed) return sendJson(res, 400, { ok: false, error: 'Reconfirm due diligence before resubmitting.' }) || true;
    let entry = await promotionStore.resubmit(id, body, { id: session.user.id, tag: session.memberDisplayName });
    try {
      entry = await postStageMessage(client, entry, entry.status === 'presidential_review' ? 'presidential' : 'board');
    } catch (error) { console.error('[PROMOTION ROUTING] Resubmission routing failed:', error); }
    sendJson(res, 200, { ok: true, entry });
    return true;
  }

  if (body.action === 'reassign') {
    const session = await requireFreshSession(req, res, client, WEBSITE_CAPABILITIES.reviewPromotionBoard);
    if (!session || !requireCsrf(req, res, session)) return true;
    if (String(current.guildId) !== String(session.guildId)) return sendJson(res, 404, { ok: false, error: 'Promotion submission not found.' }) || true;
    const assigneeId = String(body.assigneeId || '').trim();
    const assigneeTag = String(body.assigneeTag || '').trim();
    if (!assigneeId || !assigneeTag || !String(body.reason || '').trim()) return sendJson(res, 400, { ok: false, error: 'Assignee ID, display name, and reassignment reason are required.' }) || true;
    const { member } = await resolveGuildMember(client, assigneeId);
    if (!member || getTier(member) < TIERS.CORPORATE) return sendJson(res, 400, { ok: false, error: 'The new completion owner must currently be Corporate or higher in Glace.' }) || true;
    const entry = await promotionStore.reassign(id, { id: assigneeId, tag: assigneeTag }, body.reason, { id: session.user.id, tag: session.memberDisplayName });
    sendJson(res, 200, { ok: true, entry });
    return true;
  }

  if (body.action === 'complete') {
    const session = await requireFreshSession(req, res, client, WEBSITE_CAPABILITIES.completePromotion);
    if (!session || !requireCsrf(req, res, session)) return true;
    if (String(current.guildId) !== String(session.guildId)) return sendJson(res, 404, { ok: false, error: 'Promotion submission not found.' }) || true;
    const verification = await verifyPromotionCompletion(client, current);
    if (!verification.ok) return sendJson(res, 409, { ok: false, error: verification.error }) || true;
    const actor = { id: session.user.id, tag: session.memberDisplayName };
    let entry = await promotionStore.complete(id, verification, actor);
    entry = await syncPromotionDiscord(client, entry, 'completed', actor);
    const { guild } = await resolveGuildMember(client, session.user.id);
    await sendOperationsLog(client, guild, {
      title: `${entry.submissionNumber} Completed`,
      fields: [
        { name: 'Candidate', value: entry.candidateUsername || entry.candidateId },
        { name: 'New Rank', value: entry.proposedRank },
        { name: 'Completed By', value: entry.completedByTag || 'Unknown' },
        { name: 'Discord Verification', value: `Matched ${verification.matchedRole}` },
      ],
    });
    sendJson(res, 200, { ok: true, entry, warning: 'Completion verified. Staff Journey posting is manual and was not sent.' });
    return true;
  }

  sendJson(res, 400, { ok: false, error: 'Unknown promotion action.' });
  return true;
}

async function websiteInteraction(client, session) {
  const { guild, member, error } = await resolveGuildMember(client, session.user.id);
  if (!guild || !member) throw new Error(error || 'Your current Glace membership could not be verified.');
  return { client, guild, guildId: guild.id, member, user: member.user };
}

async function handleApi(req, res, url, client) {
  const method = String(req.method || 'GET').toUpperCase();
  if (url.pathname === '/ops/api/bootstrap' && method === 'GET') {
    const session = await requireFreshSession(req, res, client);
    if (!session) return true;
    return sendJson(res, 200, { ok: true, data: await bootstrap(session, client) }) || true;
  }

  if (url.pathname.startsWith('/ops/api/promotions')) {
    const handled = await handlePromotionApi(req, res, url, client, method);
    if (handled) return true;
  }

  if (url.pathname === '/ops/api/staff-requests/panel' && method === 'POST') {
    const session = await requireFreshSession(req, res, client, WEBSITE_CAPABILITIES.postStaffRequestPanel);
    if (!session || !requireCsrf(req, res, session)) return true;
    const result = await staffRequestSystem.postRequestPanel(client, process.env.STAFF_REQUEST_PANEL_CHANNEL_ID);
    return sendJson(res, 201, { ok: true, result }) || true;
  }

  if (url.pathname === '/ops/api/staff-requests' && method === 'POST') {
    const session = await requireFreshSession(req, res, client, WEBSITE_CAPABILITIES.submitStaffRequest);
    if (!session || !requireCsrf(req, res, session)) return true;
    const body = await readJsonBody(req);
    if (!staffRequestSystem.REQUEST_TYPES.includes(String(body.type))) return sendJson(res, 400, { ok: false, error: 'That staff request type is not supported.' }) || true;
    const interaction = await websiteInteraction(client, session);
    const entry = await staffRequestSystem.createFromDiscord(interaction, body.type, body.requestData || {});
    return sendJson(res, 201, { ok: true, entry }) || true;
  }

  const staffRequestMatch = url.pathname.match(/^\/ops\/api\/staff-requests\/([^/]+)$/);
  if (staffRequestMatch && method === 'PATCH') {
    const session = await requireFreshSession(req, res, client, WEBSITE_CAPABILITIES.viewStaffRequests);
    if (!session || !requireCsrf(req, res, session)) return true;
    const body = await readJsonBody(req);
    const requestId = decodeURIComponent(staffRequestMatch[1]);
    const current = await staffRequestStore.get(requestId, session.guildId);
    if (!current) return sendJson(res, 404, { ok: false, error: 'Staff request not found.' }) || true;
    const interaction = await websiteInteraction(client, session);
    if (['approve', 'return', 'deny'].includes(String(body.action))) {
      const entry = await staffRequestSystem.decideRequest(interaction, current, body.action, body.note || '');
      return sendJson(res, 200, { ok: true, entry }) || true;
    }
    if (body.action === 'resubmit') {
      if (String(current.requesterId) !== String(session.user.id)) return sendJson(res, 403, { ok: false, error: 'Only the original requester can resubmit this request.' }) || true;
      const validation = staffRequestSystem.validateRequestData(current.type, body.requestData || {});
      if (!validation.ok) return sendJson(res, 400, { ok: false, error: validation.error }) || true;
      let entry = await staffRequestStore.resubmit(current.id, validation.data, { id: session.user.id, tag: session.memberDisplayName }, staffRequestSystem.requestStatusFor(current.type, session.tier));
      entry = await staffRequestSystem.routeRequestToDiscord(client, entry);
      return sendJson(res, 200, { ok: true, entry }) || true;
    }
    return sendJson(res, 400, { ok: false, error: 'Unknown staff request action.' }) || true;
  }

  if (url.pathname === '/ops/api/staff-directory/refresh' && method === 'POST') {
    const session = await requireFreshSession(req, res, client, WEBSITE_CAPABILITIES.viewStaffDirectory);
    if (!session || !requireCsrf(req, res, session)) return true;
    const result = await listRobloxStaff({ force: true });
    const { guild } = await resolveGuildMember(client, session.user.id);
    const members = guild ? await guild.members.fetch().catch(() => guild.members.cache) : new Map();
    const profiles = await staffRequestStore.listProfiles(session.guildId).catch(() => []);
    return sendJson(res, 200, { ok: true, directory: { ...result, members: alignWithDiscord(result.members, [...members.values()], profiles) } }) || true;
  }

  if (url.pathname === '/ops/api/cases' && method === 'POST') {
    const session = await requireFreshSession(req, res, client, WEBSITE_CAPABILITIES.createRoutineCase);
    if (!session || !requireCsrf(req, res, session)) return true;
    const body = await readJsonBody(req);
    if (!String(body.targetUsername || body.targetId || '').trim() || !String(body.reason || '').trim()) return sendJson(res, 400, { ok: false, error: 'Username/Discord ID and reason are required.' }) || true;
    const hierarchy = await canActOnWebsiteTarget(client, session, body.targetId);
    if (!hierarchy.ok) return sendJson(res, 403, { ok: false, error: hierarchy.error }) || true;
    const entry = staffOps.createCase({ ...body, guildId: session.guildId }, { id: session.user.id, tag: session.memberDisplayName });
    const { guild } = await resolveGuildMember(client, session.user.id);
    await sendOperationsLog(client, guild, { title: `Staff Action ${entry.caseNumber}`, fields: [{ name: 'Target', value: `${entry.targetUsername || 'Unknown'}${entry.targetId ? ` (${entry.targetId})` : ''}` }, { name: 'Action', value: entry.actionType.replaceAll('_', ' '), inline: true }, { name: 'Status', value: entry.status.replaceAll('_', ' '), inline: true }, { name: 'Issued By', value: session.memberDisplayName || session.user.username }, { name: 'Reason', value: entry.reason }] });
    return sendJson(res, 201, { ok: true, entry }) || true;
  }

  const caseMatch = url.pathname.match(/^\/ops\/api\/cases\/([^/]+)$/);
  if (caseMatch && method === 'PATCH') {
    const session = await requireFreshSession(req, res, client, WEBSITE_CAPABILITIES.approveSeriousCase);
    if (!session || !requireCsrf(req, res, session)) return true;
    const body = await readJsonBody(req);
    const current = staffOps.getCase(decodeURIComponent(caseMatch[1]), session.guildId);
    if (!current) return sendJson(res, 404, { ok: false, error: 'Case not found.' }) || true;
    const hierarchy = await canActOnWebsiteTarget(client, session, current.targetId);
    if (!hierarchy.ok) return sendJson(res, 403, { ok: false, error: hierarchy.error }) || true;
    const entry = staffOps.updateCase(current.id, body, { id: session.user.id, tag: session.memberDisplayName });
    return sendJson(res, 200, { ok: true, entry }) || true;
  }


  if (url.pathname === '/ops/api/restricted' && method === 'POST') {
    const session = await requireFreshSession(req, res, client, WEBSITE_CAPABILITIES.manageRestrictedRecords);
    if (!session || !requireCsrf(req, res, session)) return true;
    const body = await readJsonBody(req);
    if (!String(body.subjectName || body.subjectId || '').trim() || !String(body.summary || '').trim()) return sendJson(res, 400, { ok: false, error: 'Subject and confidential summary are required.' }) || true;
    const entry = staffOps.createRestrictedRecord({ ...body, guildId: session.guildId }, { id: session.user.id, tag: session.memberDisplayName });
    return sendJson(res, 201, { ok: true, entry }) || true;
  }
  const restrictedMatch = url.pathname.match(/^\/ops\/api\/restricted\/([^/]+)$/);
  if (restrictedMatch && method === 'PATCH') {
    const session = await requireFreshSession(req, res, client, WEBSITE_CAPABILITIES.manageRestrictedRecords);
    if (!session || !requireCsrf(req, res, session)) return true;
    const body = await readJsonBody(req);
    const current = staffOps.getRestrictedRecord(decodeURIComponent(restrictedMatch[1]), session.guildId);
    if (!current) return sendJson(res, 404, { ok: false, error: 'Restricted record not found.' }) || true;
    const entry = staffOps.updateRestrictedRecord(current.id, body, { id: session.user.id, tag: session.memberDisplayName });
    return sendJson(res, 200, { ok: true, entry }) || true;
  }

  if (url.pathname === '/ops/api/documents' && method === 'POST') {
    const session = await requireFreshSession(req, res, client, WEBSITE_CAPABILITIES.manageDocuments);
    if (!session || !requireCsrf(req, res, session)) return true;
    const body = await readJsonBody(req);
    if (!String(body.title || '').trim() || !String(body.content || '').trim()) return sendJson(res, 400, { ok: false, error: 'Title and content are required.' }) || true;
    const visibilityTier = Math.max(TIERS.MANAGEMENT, Number(body.visibilityTier) || TIERS.MANAGEMENT);
    if (visibilityTier > session.tier) return sendJson(res, 403, { ok: false, error: 'You cannot publish a document above your own access tier.' }) || true;
    const entry = staffOps.createDocument({ ...body, visibilityTier, guildId: session.guildId }, { id: session.user.id, tag: session.memberDisplayName });
    return sendJson(res, 201, { ok: true, entry }) || true;
  }

  if (url.pathname === '/ops/api/posts' && method === 'POST') {
    const session = await requireFreshSession(req, res, client, WEBSITE_CAPABILITIES.publishSchedule);
    if (!session || !requireCsrf(req, res, session)) return true;
    const body = await readJsonBody(req);
    if (!['schedule', 'update'].includes(String(body.type)) || !String(body.title || '').trim() || !String(body.content || '').trim()) return sendJson(res, 400, { ok: false, error: 'Post type, title, and content are required.' }) || true;
    const result = await publishDiscordPost(client, session, body);
    const entry = staffOps.createPost({ ...body, guildId: session.guildId, posted: result.posted, channelId: result.channelId, messageId: result.messageId }, { id: session.user.id, tag: session.memberDisplayName });
    return sendJson(res, result.posted ? 201 : 202, { ok: true, entry, warning: result.warning }) || true;
  }

  sendJson(res, 404, { ok: false, error: 'API route not found.' });
  return true;
}

function serveAsset(res, fileName) {
  const allowed = { 'ops.css': 'text/css; charset=utf-8', 'ops.js': 'application/javascript; charset=utf-8', 'resort-scene.svg': 'image/svg+xml; charset=utf-8' };
  if (!allowed[fileName]) { sendText(res, 404, 'Not found.'); return true; }
  const fullPath = path.join(ASSET_DIR, fileName);
  let content;
  try { content = fs.readFileSync(fullPath, 'utf8'); } catch { sendText(res, 404, 'Not found.'); return true; }
  securityHeaders(res, allowed[fileName]);
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.writeHead(200);
  res.end(content);
  return true;
}

async function handleOpsWebRequest(req, res, client) {
  const url = new URL(req.url, getBaseUrl(req));
  if (!url.pathname.startsWith('/ops')) return false;
  try {
    if (url.pathname === '/ops/assets/ops.css') return serveAsset(res, 'ops.css');
    if (url.pathname === '/ops/assets/ops.js') return serveAsset(res, 'ops.js');
    if (url.pathname === '/ops/assets/resort-scene.svg') return serveAsset(res, 'resort-scene.svg');
    if (url.pathname.startsWith('/ops/api/')) return await handleApi(req, res, url, client);
    if (url.pathname === '/ops/login') {
      const { clientId, clientSecret, redirectUri } = getOAuthConfig(req);
      if (!clientId || !clientSecret) return sendText(res, 503, 'Discord OAuth is not configured. Add CLIENT_ID and DISCORD_CLIENT_SECRET.') || true;
      const state = randomToken(24);
      oauthStates.set(state, { expiresAt: Date.now() + STATE_TTL_MS });
      setOAuthStateCookie(req, res, state);
      const params = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirectUri, scope: 'identify', state });
      redirect(res, `https://discord.com/oauth2/authorize?${params.toString()}`);
      return true;
    }
    if (url.pathname === '/ops/callback') {
      await discordOAuthCallback(req, res, url, client);
      return true;
    }
    if (url.pathname === '/ops/logout') {
      const sessionId = parseCookies(req)[SESSION_COOKIE];
      if (sessionId) sessions.delete(sessionId);
      clearSessionCookie(req, res);
      redirect(res, '/ops');
      return true;
    }
    if (url.pathname === '/ops' || url.pathname === '/ops/') {
      const session = getSession(req);
      sendText(res, 200, session ? portalPage() : publicLoginPage(req), 'text/html; charset=utf-8');
      return true;
    }
    sendText(res, 404, 'Not found.');
    return true;
  } catch (error) {
    console.error('[OPS WEB] Request failed:', error);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : 'The portal encountered an unexpected error.' });
    else res.end();
    return true;
  }
}

module.exports = { handleOpsWebRequest };
