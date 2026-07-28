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
const { listActiveLoas, listLoaHistory } = require('../utils/loaStore');
const staffOps = require('../utils/staffOpsStore');
const promotionStore = require('../utils/promotionStore');
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#061426"><title>Glace Hotels Management Portal</title><link rel="stylesheet" href="/ops/assets/ops.css"></head><body>
  <main class="login-shell">
    <section class="login-hero">
      <div class="logo-lockup"><div class="logo-mark">❄</div><div class="logo-copy"><strong>GLACE HOTELS</strong><span>MANAGEMENT PORTAL</span></div></div>
      <div class="hero-content"><div class="hero-kicker">One secure operations hub</div><h1 class="hero-title"><span class="gradient">Elevate every stay.</span>Empower every team.</h1><p class="hero-copy">A polished home for Glace Hotels staff operations—promotion submissions, approvals, watch records, restricted documentation, schedules, updates, LOAs, and permanent audit history.</p>
        <div class="feature-grid">
          <article class="feature-tile role-intern"><div class="feature-icon">♛</div><strong>Promotion Workflow</strong><p>Corporate submits after due diligence; Board and Presidential approve.</p></article>
          <article class="feature-tile role-management"><div class="feature-icon">◇</div><strong>Staff Records</strong><p>Keep formal actions organized without dozens of Discord log channels.</p></article>
          <article class="feature-tile role-senior"><div class="feature-icon">◉</div><strong>Watch Records</strong><p>Private expectations, review dates, outcomes, and escalation history.</p></article>
          <article class="feature-tile role-corporate"><div class="feature-icon">◆</div><strong>Restricted Records</strong><p>Board-level confidentiality with a permanent access and edit trail.</p></article>
          <article class="feature-tile role-board"><div class="feature-icon">▥</div><strong>Synced Access</strong><p>Tabs and actions change automatically with current Discord roles.</p></article>
          <article class="feature-tile role-presidential"><div class="feature-icon">✦</div><strong>Executive Oversight</strong><p>Final promotion decisions, completion tracking, and full audit visibility.</p></article>
        </div>
        <div class="access-ladder"><h3>Role-based access</h3><div class="access-row"><span class="role-chip role-intern">Intern Team</span><span class="role-chip role-management">Management</span><span class="role-chip role-senior">Senior Management</span><span class="role-chip role-corporate">Corporate</span><span class="role-chip role-board">Corporate Board</span><span class="role-chip role-presidential">Presidential</span></div></div>
      </div>
      <footer class="login-footer"><span>© 2026 Glace Hotels & Resorts</span><span>Private staff system</span></footer>
    </section>
    <section class="login-panel"><article class="login-card glass"><div class="logo-lockup"><div class="logo-mark">❄</div><div class="logo-copy"><strong>GLACE HOTELS</strong><span>MANAGEMENT PORTAL</span></div></div><h1>Welcome back.</h1><p class="lead">Sign in securely with the Discord account connected to the Glace server.</p>
      ${ready ? '<a class="discord-button" href="/ops/login"><span>◈</span> Sign in with Discord</a>' : '<div class="oauth-error">OAuth setup is incomplete. Add <b>DISCORD_CLIENT_SECRET</b>, confirm <b>CLIENT_ID</b>, and set the redirect URL before opening the portal.</div>'}
      <div class="access-note"><div class="feature-icon role-senior">✓</div><div><strong>Access is synced to your Glace server rank.</strong><span>The server re-checks your membership and permissions before every protected action. A demotion, resignation, or server departure immediately changes portal access.</span></div></div>
    </article></section>
  </main></body></html>`;
}

function portalPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#061426"><title>Glace Hotels Management Portal</title><link rel="stylesheet" href="/ops/assets/ops.css"><script defer src="/ops/assets/ops.js"></script></head><body>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="logo-lockup"><div class="logo-mark">❄</div><div class="logo-copy"><strong>GLACE HOTELS</strong><span>MANAGEMENT PORTAL</span></div></div>
      <div class="sidebar-profile"><div class="profile-line"><div id="profileAvatar"></div><div class="profile-copy"><strong id="profileName">Loading…</strong><span id="profileRole"></span></div></div></div>
      <div class="sidebar-section">Workspace</div>
      <nav class="nav">
        <button class="active" data-tab="dashboard" data-title="Staff Hub Dashboard" data-subtitle="A bright, role-aware view of the tools available to your current Glace tier."><span class="nav-icon">⌂</span><span>Dashboard</span></button>
        <button data-tab="promotions" data-capability="viewPromotions" data-title="Promotion Submissions" data-subtitle="Corporate owns the submission from due diligence through verified completion."><span class="nav-icon">♛</span><span>Promotions</span></button>
        <button data-tab="cases" data-capability="viewStaffCases" data-title="Staff Actions" data-subtitle="Permanent coaching, warning, suspension, demotion, and termination records."><span class="nav-icon">◇</span><span>Staff Actions</span></button>
        <button data-tab="watch" data-capability="viewWatchRecords" data-title="Watch Records" data-subtitle="Private monitoring records, expectations, review dates, and outcomes."><span class="nav-icon">◉</span><span>Watch Records</span></button>
        <button data-tab="restricted" data-capability="viewRestrictedRecords" data-title="Restricted Records" data-subtitle="Confidential Board-level investigations and leadership decisions."><span class="nav-icon">◆</span><span>Restricted</span></button>
        <button data-tab="documents" data-capability="viewDocuments" data-title="Documentation" data-subtitle="Policies and internal resources filtered to your access tier."><span class="nav-icon">▤</span><span>Documents</span></button>
        <button data-tab="posts" data-capability="viewPosts" data-title="Schedules & Updates" data-subtitle="Website records paired with clean Discord announcements."><span class="nav-icon">✦</span><span>Updates</span></button>
        <button data-tab="loas" data-capability="viewLoas" data-title="Leave of Absence" data-subtitle="Current LOAs and permanent ended history from the Discord workflow."><span class="nav-icon">◔</span><span>LOAs</span></button>
        <button data-tab="audit" data-capability="viewAudit" data-title="System Audit" data-subtitle="A permanent trail of protected bot and portal activity."><span class="nav-icon">⌁</span><span>Audit Log</span></button>
      </nav>
      <div class="sidebar-bottom"><a href="/ops/logout"><span>Sign out</span></a></div>
    </aside>
    <main class="app-main">
      <header class="topbar"><div class="topbar-title"><strong>Glace Hotels Staff Hub</strong><span>Discord-synced management portal</span></div><div class="search"><input id="globalSearch" type="search" placeholder="Search this section…"></div><div class="top-actions"><div id="previewControl" class="preview-control" hidden><label for="previewTier">Preview as</label><select id="previewTier"><option value="8">Presidential</option><option value="7">Corporate Board</option><option value="6">Corporate</option><option value="5">Senior Management</option><option value="4">Management</option><option value="3">Intern Team</option></select></div><span id="opsBadge" class="role-chip"></span><button class="icon-btn" type="button" aria-label="Portal status">❄</button></div></header>
      <div id="loading" class="loading-screen"><div><div class="loading-orb"></div><div id="loadingMessage">Verifying your Glace server rank…</div></div></div>
      <div id="app" hidden class="content">
        <div id="previewBanner" class="preview-banner" hidden><div><strong id="previewBannerTitle">Preview mode</strong><span id="previewBannerCopy"></span></div><button id="exitPreview" class="btn small ghost" type="button">Exit Preview</button></div><div class="page-head"><div><span id="pageEyebrow" class="page-eyebrow">YOUR STAFF HUB</span><h1 id="pageTitle">Staff Hub Dashboard</h1><p id="pageSubtitle">Your Glace management workspace.</p></div><div class="page-tier-card"><span>Current view</span><strong id="pageTierLabel">Loading…</strong></div></div>

        <section id="section-dashboard" class="section active">
          <div id="dashboardStats" class="dashboard-grid"></div>
          <div class="panel-grid">
            <div class="panel-stack"><article class="panel"><div class="panel-head"><h2>Staff Journey</h2><button class="panel-link" data-go="posts">View updates</button></div><div id="journeyFeed" class="activity-list"></div></article><article class="panel"><div class="panel-head"><h2>Role Access System</h2></div><div id="rankOverview" class="rank-ladder"></div></article></div>
            <article class="panel"><div class="panel-head"><h2>Approval & Completion Queue</h2><button class="panel-link" data-go="promotions">Open queue</button></div><div id="approvalPreview" class="activity-list"></div></article>
            <div class="panel-stack"><article class="panel"><div class="panel-head"><h2>Quick Actions</h2></div><div id="quickActions" class="quick-grid"></div></article><article class="panel"><div class="panel-head"><h2>Workflow Standard</h2></div><div class="record-body">Corporate investigates → submits → Corporate Board reviews → Presidential approves → assigned Corporate member carries it out → the portal verifies the Discord rank → Staff Journey announcement.</div></article></div>
          </div>
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
            <article class="list-card"><div class="toolbar"><div><h2>Promotion Queue</h2><p>Approval and completion are tracked separately.</p></div></div><div id="promotionList" class="record-list"></div></article>
          </div>
        </section>

        <section id="section-cases" class="section"><div class="workspace"><article class="form-card" data-capability="createRoutineCase"><h2>New Staff Action</h2><p>Routine actions save immediately. Serious actions remain pending until Corporate Board decides.</p><form id="caseForm" class="form-grid"><div class="field"><label>Discord ID</label><input name="targetId"></div><div class="field"><label>Username</label><input name="targetUsername" required></div><div class="field"><label>Current Rank</label><input name="targetRank" required></div><div class="field"><label>Action Type</label><select name="actionType"><option value="staff_note">Staff Note</option><option value="coaching">Coaching</option><option value="staff_warning">Staff Warning</option><option value="suspension">Suspension</option><option value="demotion">Demotion</option><option value="termination">Termination</option><option value="appeal">Appeal</option></select></div><div class="field"><label>Warning Count</label><input name="staffWarningCount" type="number" min="0"></div><div class="field"><label>Length</label><input name="length" placeholder="Example: 7 days"></div><div class="field"><label>Start Date</label><input name="startDate" type="date"></div><div class="field"><label>End Date</label><input name="endDate" type="date"></div><div class="field full"><label>Reason</label><textarea name="reason" required></textarea></div><div class="field full"><label>Evidence / Message / Trello Link</label><input name="evidence"></div><button class="btn primary full" type="submit">Save Staff Action</button></form></article><article class="list-card"><h2>Staff Action Records</h2><p>Permanent punishment and coaching history.</p><div id="caseList" class="record-list"></div></article></div></section>

        <section id="section-watch" class="section"><div class="workspace"><article class="form-card" data-capability="manageWatchRecords"><h2>New Watch Record</h2><p>Watch records never post publicly in Discord.</p><form id="watchForm" class="form-grid"><div class="field"><label>Discord ID</label><input name="targetId"></div><div class="field"><label>Username</label><input name="targetUsername" required></div><div class="field full"><label>Current Rank</label><input name="targetRank" required></div><div class="field full"><label>Reason for Monitoring</label><textarea name="reason" required></textarea></div><div class="field full"><label>Expected Improvements</label><textarea name="expectations" required></textarea></div><div class="field"><label>Start Date</label><input name="startDate" type="date" required></div><div class="field"><label>Review Date</label><input name="reviewDate" type="date" required></div><button class="btn green full" type="submit">Create Watch Record</button></form></article><article class="list-card"><h2>Watch Records</h2><p>Active, improving, escalated, cleared, and archived monitoring history.</p><div id="watchList" class="record-list"></div></article></div></section>

        <section id="section-restricted" class="section"><div class="workspace"><article class="form-card" data-capability="manageRestrictedRecords"><h2>New Restricted Record</h2><p>For major investigations, executive complaints, severe misconduct, and do-not-rehire documentation. Access and changes are audited.</p><form id="restrictedForm" class="form-grid"><div class="field"><label>Subject Discord ID</label><input name="subjectId"></div><div class="field"><label>Subject Name</label><input name="subjectName" required></div><div class="field full"><label>Category</label><select name="category"><option>Major Investigation</option><option>Executive Complaint</option><option>Severe Misconduct</option><option>Leadership Decision</option><option>Do Not Rehire</option><option>Other Confidential</option></select></div><div class="field full"><label>Confidential Summary</label><textarea name="summary" required></textarea></div><div class="field full"><label>Evidence / Protected Links</label><textarea name="evidence"></textarea></div><button class="btn orange full" type="submit">Create Restricted Record</button></form></article><article class="list-card"><h2>Restricted Records</h2><p>Visible only to Corporate Board and Presidential access.</p><div id="restrictedList" class="record-list"></div></article></div></section>

        <section id="section-documents" class="section"><div class="workspace"><article class="form-card" data-capability="manageDocuments"><h2>Publish Documentation</h2><p>Visibility is enforced by current Discord tier on every load.</p><form id="documentForm" class="form-grid"><div class="field full"><label>Title</label><input name="title" required></div><div class="field"><label>Category</label><input name="category" value="General" required></div><div class="field"><label>Minimum Tier</label><select name="visibilityTier"><option value="4">Management+</option><option value="5">Senior Management+</option><option value="6">Corporate+</option><option value="7">Corporate Board+</option><option value="8">Presidential only</option></select></div><div class="field full"><label>Content</label><textarea name="content" required style="min-height:200px"></textarea></div><button class="btn primary full" type="submit">Publish Document</button></form></article><article class="list-card"><h2>Documentation Library</h2><p>Only documents available to your rank are shown.</p><div id="documentList" class="record-list"></div></article></div></section>

        <section id="section-posts" class="section"><div class="workspace"><article class="form-card" data-capability="publishUpdate"><h2>Publish Schedule or Update</h2><p>The website stores the permanent version and the bot posts the clean Discord display.</p><form id="postForm" class="form-grid"><div class="field"><label>Post Type</label><select name="type"><option value="update">Staff Update</option><option value="schedule">Staff Schedule</option></select></div><div class="field"><label>Title</label><input name="title" required></div><div class="field full"><label>Content</label><textarea name="content" required style="min-height:190px"></textarea></div><button class="btn pink full" type="submit">Save & Post to Discord</button></form></article><article class="list-card"><h2>Schedules & Updates</h2><p>Inactivity notices, time-zone changes, resignations, schedules, and operational updates.</p><div id="postList" class="record-list"></div></article></div></section>

        <section id="section-loas" class="section"><div class="panel"><div class="panel-head"><h2>Current LOAs</h2></div><div id="loaList" class="record-list"></div></div><div class="panel" style="margin-top:14px"><div class="panel-head"><h2>Ended LOA History</h2></div><div id="loaHistoryList" class="record-list"></div></div></section>
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

function buildFeed({ posts, loas, completedPromotions }) {
  const feed = [];
  for (const item of completedPromotions.slice(0, 20)) {
    feed.push({ icon: '♛', tier: item.proposedTier, title: 'Promotion completed', detail: `${item.candidateUsername || item.candidateId} → ${item.proposedRank}`, createdAt: item.completedAt || item.updatedAt });
  }
  for (const item of posts.slice(0, 20)) {
    feed.push({ icon: item.type === 'schedule' ? '▤' : '✦', tier: item.type === 'schedule' ? TIERS.MANAGEMENT : TIERS.INTERN, title: item.title, detail: `${item.type === 'schedule' ? 'Schedule' : 'Staff update'} by ${item.createdByTag || 'Unknown'}`, createdAt: item.createdAt });
  }
  for (const item of loas.slice(0, 20)) {
    feed.push({ icon: '◔', tier: TIERS.SENIOR_MANAGEMENT, title: 'Active LOA', detail: `${item.originalDisplayName || item.staffCardName || item.userId} • through ${item.officialEndDate || 'unknown'}`, createdAt: item.createdAt || item.startedAt || new Date().toISOString() });
  }
  return feed.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, 30);
}

async function bootstrap(session) {
  const capabilities = viewerCapabilities(session.tier);
  const allPromotions = promotionStore.list({ guildId: session.guildId, limit: 500 });
  const documents = capabilities.viewDocuments
    ? staffOps.listDocuments({ guildId: session.guildId }).filter((doc) => session.tier >= Number(doc.visibilityTier || TIERS.MANAGEMENT))
    : [];
  const posts = capabilities.viewPosts ? staffOps.listPosts({ guildId: session.guildId }) : [];
  const loas = capabilities.viewLoas ? listActiveLoas(session.guildId) : [];
  const loaHistory = capabilities.viewLoas ? listLoaHistory(session.guildId, 100) : [];
  const audit = capabilities.viewAudit ? [
    ...staffOps.listAudit({ limit: 200 }),
    ...promotionStore.listAudit({ limit: 200 }),
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
    cases: capabilities.viewStaffCases ? staffOps.listCases({ guildId: session.guildId }) : [],
    watchRecords: capabilities.viewWatchRecords ? staffOps.listWatchRecords({ guildId: session.guildId }) : [],
    restrictedRecords: capabilities.viewRestrictedRecords ? staffOps.listRestrictedRecords({ guildId: session.guildId }) : [],
    documents,
    posts,
    audit,
    loas,
    loaHistory,
    feed: buildFeed({ posts, loas, completedPromotions: allPromotions.filter((entry) => entry.status === 'completed') }),
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

function promotionColor(tier) {
  return ({ 3: 0xec4899, 4: 0x8b5cf6, 5: 0x22c55e, 6: 0xef4444, 7: 0xf59e0b, 8: 0xfacc15 })[Number(tier)] || 0x5cb8ff;
}

async function publishPromotionAnnouncement(client, entry) {
  const channelId = process.env.STAFF_JOURNEY_CHANNEL_ID || process.env.STAFF_UPDATES_CHANNEL_ID || process.env.STAFF_POSTS_CHANNEL_ID;
  if (!channelId) return { messageId: null, warning: 'Promotion completed, but STAFF_JOURNEY_CHANNEL_ID is not configured.' };
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return { messageId: null, warning: 'Promotion completed, but the Staff Journey channel could not be found.' };
  const board = entry.boardDecisionByTag || 'Corporate Board';
  const presidential = (entry.presidentialApprovals || []).map((approval) => approval.tag).join(', ') || 'Presidential Team';
  const embed = new EmbedBuilder()
    .setTitle('❄ Staff Journey • Promotion')
    .setDescription(`Please congratulate **${entry.candidateUsername || `<@${entry.candidateId}>`}** on their promotion to **${entry.proposedRank}**!`)
    .addFields(
      { name: 'Promotion Owner', value: entry.completedByTag || entry.submittedByTag || 'Corporate Team', inline: true },
      { name: 'Board Approval', value: board, inline: true },
      { name: 'Presidential Approval', value: presidential, inline: false },
    )
    .setColor(promotionColor(entry.proposedTier))
    .setFooter({ text: `Glace Hotels • ${entry.submissionNumber}` })
    .setTimestamp(new Date());
  const message = await channel.send({ content: entry.candidateId ? `<@${entry.candidateId}>` : undefined, embeds: [embed], allowedMentions: { users: entry.candidateId ? [entry.candidateId] : [] } });
  promotionStore.setAnnouncementMessage(entry.id, message.id);
  return { messageId: message.id, warning: null };
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
    const entry = promotionStore.create({ ...body, guildId: session.guildId }, { id: session.user.id, tag: session.memberDisplayName });
    await sendOperationsLog(client, hierarchy.guild, {
      title: `Promotion Submission ${entry.submissionNumber}`,
      fields: [
        { name: 'Candidate', value: `${entry.candidateUsername} (${entry.candidateId})` },
        { name: 'Promotion', value: `${entry.currentRank} → ${entry.proposedRank}` },
        { name: 'Corporate Owner', value: entry.submittedByTag },
        { name: 'Status', value: 'Corporate Board Review' },
      ],
    });
    sendJson(res, 201, { ok: true, entry });
    return true;
  }

  const match = url.pathname.match(/^\/ops\/api\/promotions\/([^/]+)$/);
  if (!match || method !== 'PATCH') return false;
  const body = await readJsonBody(req);
  const id = decodeURIComponent(match[1]);
  const current = promotionStore.get(id);
  if (!current) return sendJson(res, 404, { ok: false, error: 'Promotion submission not found.' }) || true;

  if (body.action === 'board_decision') {
    const session = await requireFreshSession(req, res, client, WEBSITE_CAPABILITIES.reviewPromotionBoard);
    if (!session || !requireCsrf(req, res, session)) return true;
    if (String(current.guildId) !== String(session.guildId)) return sendJson(res, 404, { ok: false, error: 'Promotion submission not found.' }) || true;
    if (String(current.submittedById) === String(session.user.id)) return sendJson(res, 403, { ok: false, error: 'You cannot provide Board approval for a promotion you submitted.' }) || true;
    const entry = promotionStore.boardDecision(id, body.decision, body.reason, { id: session.user.id, tag: session.memberDisplayName });
    sendJson(res, 200, { ok: true, entry });
    return true;
  }

  if (body.action === 'presidential_decision') {
    const session = await requireFreshSession(req, res, client, WEBSITE_CAPABILITIES.approvePromotionPresidential);
    if (!session || !requireCsrf(req, res, session)) return true;
    if (String(current.guildId) !== String(session.guildId)) return sendJson(res, 404, { ok: false, error: 'Promotion submission not found.' }) || true;
    if (String(current.submittedById) === String(session.user.id)) return sendJson(res, 403, { ok: false, error: 'You cannot provide final approval for a promotion you submitted.' }) || true;
    const entry = promotionStore.presidentialDecision(id, body.decision, body.reason, { id: session.user.id, tag: session.memberDisplayName });
    sendJson(res, 200, { ok: true, entry });
    return true;
  }

  if (body.action === 'resubmit') {
    const session = await requireFreshSession(req, res, client, WEBSITE_CAPABILITIES.submitPromotion);
    if (!session || !requireCsrf(req, res, session)) return true;
    if (String(current.guildId) !== String(session.guildId)) return sendJson(res, 404, { ok: false, error: 'Promotion submission not found.' }) || true;
    if (!body.diligenceConfirmed) return sendJson(res, 400, { ok: false, error: 'Reconfirm due diligence before resubmitting.' }) || true;
    const entry = promotionStore.resubmit(id, body, { id: session.user.id, tag: session.memberDisplayName });
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
    const entry = promotionStore.reassign(id, { id: assigneeId, tag: assigneeTag }, body.reason, { id: session.user.id, tag: session.memberDisplayName });
    sendJson(res, 200, { ok: true, entry });
    return true;
  }

  if (body.action === 'complete') {
    const session = await requireFreshSession(req, res, client, WEBSITE_CAPABILITIES.completePromotion);
    if (!session || !requireCsrf(req, res, session)) return true;
    if (String(current.guildId) !== String(session.guildId)) return sendJson(res, 404, { ok: false, error: 'Promotion submission not found.' }) || true;
    const verification = await verifyPromotionCompletion(client, current);
    if (!verification.ok) return sendJson(res, 409, { ok: false, error: verification.error }) || true;
    const entry = promotionStore.complete(id, verification, { id: session.user.id, tag: session.memberDisplayName });
    const announcement = await publishPromotionAnnouncement(client, entry);
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
    sendJson(res, 200, { ok: true, entry, warning: announcement.warning });
    return true;
  }

  sendJson(res, 400, { ok: false, error: 'Unknown promotion action.' });
  return true;
}

async function handleApi(req, res, url, client) {
  const method = String(req.method || 'GET').toUpperCase();
  if (url.pathname === '/ops/api/bootstrap' && method === 'GET') {
    const session = await requireFreshSession(req, res, client);
    if (!session) return true;
    return sendJson(res, 200, { ok: true, data: await bootstrap(session) }) || true;
  }

  if (url.pathname.startsWith('/ops/api/promotions')) {
    const handled = await handlePromotionApi(req, res, url, client, method);
    if (handled) return true;
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

  if (url.pathname === '/ops/api/watch' && method === 'POST') {
    const session = await requireFreshSession(req, res, client, WEBSITE_CAPABILITIES.manageWatchRecords);
    if (!session || !requireCsrf(req, res, session)) return true;
    const body = await readJsonBody(req);
    if (!String(body.targetUsername || body.targetId || '').trim() || !String(body.reason || '').trim() || !String(body.expectations || '').trim()) return sendJson(res, 400, { ok: false, error: 'Target, reason, and expected improvements are required.' }) || true;
    const hierarchy = await canActOnWebsiteTarget(client, session, body.targetId);
    if (!hierarchy.ok) return sendJson(res, 403, { ok: false, error: hierarchy.error }) || true;
    const entry = staffOps.createWatchRecord({ ...body, guildId: session.guildId }, { id: session.user.id, tag: session.memberDisplayName });
    return sendJson(res, 201, { ok: true, entry }) || true;
  }
  const watchMatch = url.pathname.match(/^\/ops\/api\/watch\/([^/]+)$/);
  if (watchMatch && method === 'PATCH') {
    const session = await requireFreshSession(req, res, client, WEBSITE_CAPABILITIES.manageWatchRecords);
    if (!session || !requireCsrf(req, res, session)) return true;
    const body = await readJsonBody(req);
    const current = staffOps.getWatchRecord(decodeURIComponent(watchMatch[1]), session.guildId);
    if (!current) return sendJson(res, 404, { ok: false, error: 'Watch record not found.' }) || true;
    const entry = staffOps.updateWatchRecord(current.id, body, { id: session.user.id, tag: session.memberDisplayName });
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
  const allowed = { 'ops.css': 'text/css; charset=utf-8', 'ops.js': 'application/javascript; charset=utf-8' };
  if (!allowed[fileName]) { sendText(res, 404, 'Not found.'); return true; }
  const fullPath = path.join(ASSET_DIR, fileName);
  let content;
  try { content = fs.readFileSync(fullPath, 'utf8'); } catch { sendText(res, 404, 'Not found.'); return true; }
  securityHeaders(res, allowed[fileName]);
  res.setHeader('Cache-Control', 'public, max-age=300');
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
