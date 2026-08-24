'use strict';

const state = { data: null, csrf: null, activeTab: 'dashboard', decision: null, promotionMode: 'create', staffRequestResubmit: null, previewTier: null, viewCapabilities: null, initialTab: new URLSearchParams(location.search).get('tab') };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}

function formatDate(value, dateOnly = false) {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return escapeHtml(value);
  return dateOnly
    ? parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : parsed.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function relativeTime(value) {
  if (!value) return '';
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return '';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function prettify(value) {
  return String(value || 'unknown')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function roleClass(tier) {
  return `tier-${Number(tier) || 3}`;
}

function roleName(tier) {
  return ({ 3: 'Intern Team', 4: 'Management', 5: 'Senior Management', 6: 'Corporate', 7: 'Corporate Board', 8: 'Presidential' })[Number(tier)] || 'Staff';
}

const TIER_THEMES = Object.freeze({
  3: 'intern',
  4: 'management',
  5: 'senior',
  6: 'corporate',
  7: 'board',
  8: 'presidential',
});

function effectiveTier() {
  return Number(state.previewTier || state.data?.viewer?.tier || 3);
}

function isPreviewing() {
  return Boolean(state.data?.viewer?.canPreviewTiers && state.previewTier && Number(state.previewTier) !== Number(state.data.viewer.tier));
}

function capabilitiesForTier(tier) {
  const minimums = state.data?.capabilityMinimums || {};
  return Object.fromEntries(Object.entries(minimums).map(([key, minimum]) => [key, Number(tier) >= Number(minimum)]));
}

function currentCapabilities() {
  return state.viewCapabilities || state.data?.capabilities || {};
}

function applyTheme(tier) {
  const cleanTier = Number(tier) || 3;
  document.body.dataset.theme = TIER_THEMES[cleanTier] || 'intern';
  document.body.dataset.tier = String(cleanTier);
}

function statusChip(value) {
  const clean = String(value || 'unknown');
  return `<span class="status-chip status-${escapeHtml(clean)}">${escapeHtml(prettify(clean))}</span>`;
}

function notify(message, type = 'info') {
  const node = $('#notice');
  node.textContent = message;
  node.dataset.type = type;
  node.classList.add('show');
  clearTimeout(window.__glaceNotice);
  window.__glaceNotice = setTimeout(() => node.classList.remove('show'), 4200);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (state.csrf) headers['X-CSRF-Token'] = state.csrf;
  const response = await fetch(path, { ...options, headers });
  const body = await response.json().catch(() => ({ ok: false, error: 'The portal returned an invalid response.' }));
  if (!response.ok || body.ok === false) throw new Error(body.error || 'Request failed.');
  return body;
}

function blockPreviewSubmit(event) {
  if (!isPreviewing()) return false;
  event.preventDefault();
  notify('Exit Preview mode before submitting or changing records.', 'error');
  return true;
}

function formDataObject(form) {
  const output = Object.fromEntries(new FormData(form).entries());
  $$('input[type="checkbox"]', form).forEach((input) => { output[input.name] = input.checked; });
  return output;
}

function navAllowed(button) {
  const capability = button.dataset.capability;
  return !capability || Boolean(currentCapabilities()[capability]);
}

function showTab(tab) {
  const button = $(`[data-tab="${tab}"]`);
  if (!button || !navAllowed(button)) tab = 'dashboard';
  state.activeTab = tab;
  $$('[data-tab]').forEach((item) => item.classList.toggle('active', item.dataset.tab === tab));
  $$('.section').forEach((section) => section.classList.toggle('active', section.id === `section-${tab}`));
  const active = $(`[data-tab="${tab}"]`);
  $('#pageTitle').textContent = active?.dataset.title || active?.textContent?.trim() || 'Staff Hub Dashboard';
  $('#pageSubtitle').textContent = active?.dataset.subtitle || 'Your Glace operations workspace.';
  history.replaceState(null, '', `#${tab}`);
}

function applyPreviewLock() {
  const previewing = isPreviewing();
  document.body.classList.toggle('preview-mode', previewing);
  const banner = $('#previewBanner');
  if (banner) banner.hidden = !previewing;
  if (previewing) {
    $('#previewBannerTitle').textContent = `Previewing ${roleName(effectiveTier())}`;
    $('#previewBannerCopy').textContent = 'This is a visual permissions preview. All forms and record actions are locked until you exit preview mode.';
  }
  $$('form input, form select, form textarea, form button').forEach((control) => {
    control.disabled = previewing;
  });
}

function renderViewer() {
  const viewer = state.data?.viewer || {};
  const realTier = Math.min(8, Math.max(3, Number(viewer.tier) || 3));
  const canPreview = Boolean(viewer.canPreviewTiers) || realTier >= 8;
  const viewTier = Math.min(8, Math.max(3, effectiveTier()));
  const previewing = canPreview && viewTier !== realTier;

  state.viewCapabilities = previewing ? capabilitiesForTier(viewTier) : { ...(state.data?.capabilities || {}) };
  applyTheme(viewTier);

  const displayName = viewer.displayName || viewer.username || 'Glace Staff';
  const realLabel = viewer.tierLabel || roleName(realTier);
  const viewLabel = roleName(viewTier);

  const profileName = $('#profileName');
  const profileRole = $('#profileRole');
  const opsBadge = $('#opsBadge');
  const pageTierLabel = $('#pageTierLabel');
  const pageEyebrow = $('#pageEyebrow');
  if (profileName) profileName.textContent = displayName;
  if (profileRole) profileRole.textContent = previewing ? `${realLabel} \u2022 previewing ${viewLabel}` : realLabel;
  if (opsBadge) {
    opsBadge.textContent = previewing ? `${viewLabel} Preview` : realLabel;
    opsBadge.className = `role-chip ${roleClass(viewTier)}`;
  }
  if (pageTierLabel) {
    pageTierLabel.textContent = previewing ? `${viewLabel} preview` : `${viewLabel} access`;
    pageTierLabel.className = roleClass(viewTier);
  }
  if (pageEyebrow) pageEyebrow.textContent = previewing ? 'PRESIDENTIAL PREVIEW MODE' : `${viewLabel.toUpperCase()} STAFF HUB`;

  const previewControl = $('#previewControl');
  const previewTier = $('#previewTier');
  if (previewControl) {
    previewControl.hidden = !canPreview;
    previewControl.classList.toggle('visible', canPreview);
  }
  if (canPreview && previewTier) previewTier.value = String(viewTier);

  const avatar = $('#profileAvatar');
  if (avatar) {
    if (viewer.avatar) avatar.innerHTML = `<img src="${escapeHtml(viewer.avatar)}" alt="" class="avatar">`;
    else avatar.innerHTML = `<div class="avatar">${escapeHtml(displayName[0].toUpperCase())}</div>`;
  }

  $$('[data-tab]').forEach((button) => { button.hidden = !navAllowed(button); });
  $$('[data-capability]').forEach((node) => {
    const capability = node.dataset.capability;
    if (node.matches('[data-tab]')) return;
    node.hidden = !currentCapabilities()[capability];
  });
}

function statCard(label, value, meta, color, symbol) {
  return `<article class="stat-card ${color}">
    <div class="stat-top"><span>${escapeHtml(label)}</span><span class="stat-icon">${symbol}</span></div>
    <strong class="stat-value">${escapeHtml(value)}</strong>
    <span class="stat-meta">${escapeHtml(meta)}</span>
  </article>`;
}

function renderDashboard() {
  const d = state.data;
  const capabilities = currentCapabilities();
  const pendingPromotions = d.promotions.filter((x) => ['board_review', 'presidential_review', 'returned_to_corporate'].includes(x.status)).length;
  const awaitingCompletion = d.promotions.filter((x) => x.status === 'approved_awaiting_completion').length;
  const openCases = d.cases.filter((x) => !['closed', 'denied', 'reversed'].includes(x.status)).length;
  const myPendingRequests = (d.staffRequests || []).filter((x) => String(x.requesterId) === String(d.viewer.id) && x.status.startsWith('pending_')).length;
  const requestQueue = effectiveTier() >= 8
    ? (d.staffRequests || []).filter((x) => x.status === 'pending_presidential')
    : effectiveTier() >= 6
      ? (d.staffRequests || []).filter((x) => x.status === 'pending_corporate')
      : [];

  const stats = [];
  if (capabilities.viewPosts) stats.push(['Staff Updates', d.posts.length, `${d.feed.length} recent staff items`, 'role-intern', '\u2726']);
  if (capabilities.viewStaffRequests) stats.push(['My Requests', myPendingRequests, `${requestQueue.length} routed to your review level`, 'role-board', '\u2709']);
  if (capabilities.viewActivity) stats.push(['Current Activity', d.activity?.self?.current?.source?.total || 0, d.activity?.self?.current?.met ? 'Current quota met' : 'Current quota in progress', 'role-management', '\u25EB']);
  if (capabilities.viewLoas) stats.push(['Current LOAs', d.loas.length, `${d.loaHistory.length} recent ended records`, 'role-senior', '\u25D4']);
  if (capabilities.viewDocuments) stats.push(['Documents', d.documents.length, 'Resources available to your role', 'role-management', '\u25A4']);
  if (capabilities.viewStaffCases) stats.push(['Staff Actions', openCases, `${d.cases.filter((x) => x.status === 'pending_approval').length} awaiting review`, 'role-management', '\u25C7']);
  if (capabilities.viewPromotions) stats.push(['Promotion Submissions', pendingPromotions, `${awaitingCompletion} awaiting completion`, 'role-corporate', '\u265B']);
  if (capabilities.viewRestrictedRecords) stats.push(['Restricted Records', d.restrictedRecords.filter((x) => x.status !== 'archived').length, 'Confidential records available to you', 'role-board', '\u25C6']);
  if (capabilities.viewAudit) stats.push(['Audit Activity', d.audit.length, 'Protected actions in your view', 'role-presidential', '\u2301']);

  const dashboardStats = $('#dashboardStats');
  if (dashboardStats) dashboardStats.innerHTML = stats.map((item) => statCard(...item)).join('');

  const feed = d.feed.slice(0, 7);
  const journeyFeed = $('#journeyFeed');
  if (journeyFeed) journeyFeed.innerHTML = feed.length ? feed.map((entry) => `
    <div class="activity-item">
      <div class="activity-icon ${roleClass(entry.tier || 3)}">${escapeHtml(entry.icon || '\u2605')}</div>
      <div class="activity-copy"><strong>${escapeHtml(entry.title)}</strong><span>${escapeHtml(entry.detail || '')}</span></div>
      <span class="activity-time">${escapeHtml(relativeTime(entry.createdAt))}</span>
    </div>`).join('') : '<div class="empty-state"><strong>No recent updates</strong>Your available staff updates and LOA activity will appear here.</div>';

  const canViewPromotions = Boolean(capabilities.viewPromotions);
  const canViewCases = Boolean(capabilities.viewStaffCases);
  const canReviewRequests = requestQueue.length > 0 || Boolean(capabilities.reviewStaffRequestsCorporate || capabilities.reviewStaffRequestsPresidential);
  const canViewQueue = canViewPromotions || canViewCases || canReviewRequests;
  const approvalPanel = $('#approvalPanel');
  const dashboardPanels = $('.dashboard-panels');
  if (approvalPanel) approvalPanel.hidden = !canViewQueue;
  if (dashboardPanels) dashboardPanels.classList.toggle('no-action-queue', !canViewQueue);

  const approvalTitle = $('#approvalPanelTitle');
  const approvalOpenButton = $('#approvalOpenButton');
  if (approvalTitle) approvalTitle.textContent = [canViewPromotions, canViewCases, canReviewRequests].filter(Boolean).length > 1
    ? 'Approval & Completion Queue'
    : canViewPromotions ? 'Promotion Queue' : canViewCases ? 'Staff Action Queue' : 'Staff Request Queue';
  if (approvalOpenButton) {
    const destination = canViewPromotions ? 'promotions' : canViewCases ? 'cases' : 'requests';
    approvalOpenButton.dataset.go = destination;
    approvalOpenButton.textContent = destination === 'promotions' ? 'Open promotions' : destination === 'cases' ? 'Open staff actions' : 'Open requests';
  }

  const approvals = [
    ...(canViewPromotions ? d.promotions.filter((x) => ['board_review', 'returned_to_corporate', 'presidential_review', 'approved_awaiting_completion'].includes(x.status)).map((x) => ({
      title: `${x.candidateUsername || x.candidateId}: ${x.currentRank} \u2192 ${x.proposedRank}`,
      meta: `${x.submissionNumber} \u2022 ${prettify(x.status)}`,
      tier: x.proposedTier,
      tab: 'promotions',
      promotion: x,
    })) : []),
    ...(canViewCases ? d.cases.filter((x) => x.status === 'pending_approval').map((x) => ({
      title: `${x.caseNumber}: ${x.targetUsername || x.targetId}`,
      meta: `${prettify(x.actionType)} \u2022 awaiting review`,
      tier: effectiveTier(),
      tab: 'cases',
    })) : []),
    ...requestQueue.map((x) => ({
      title: `${x.requestNumber}: ${x.requesterTag || x.requesterId}`,
      meta: `${requestTypeLabel(x.type)} \u2022 ${prettify(x.status)}`,
      tier: x.requesterTier,
      tab: 'requests',
      staffRequest: x,
    })),
  ].slice(0, 9);
  const approvalPreview = $('#approvalPreview');
  if (approvalPreview && canViewQueue) approvalPreview.innerHTML = approvals.length ? approvals.map((item) => `
    <div class="dashboard-queue-item">
      <button class="activity-item" data-go="${item.tab}" style="width:100%;color:inherit;text-align:left;cursor:pointer">
        <div class="activity-icon ${roleClass(item.tier)}">\u2197</div>
        <div class="activity-copy"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.meta)}</span></div>
        <span class="tiny-chip ${roleClass(item.tier)}">Open</span>
      </button>
      ${item.promotion ? `<div class="dashboard-queue-actions">${promotionActions(item.promotion)}</div>` : item.staffRequest ? `<div class="dashboard-queue-actions">${staffRequestActions(item.staffRequest)}</div>` : ''}
    </div>`).join('') : '<div class="empty-state"><strong>You are all caught up</strong>No items are waiting in the queues available to your role.</div>';

  const availableTools = [
    ['\u2302', 'Dashboard', true],
    ['\u2709', 'Staff Request Center', capabilities.viewStaffRequests],
    ['\u25EB', 'LI+ Activity', capabilities.viewActivity],
    ['\u265A', 'Staff List', capabilities.viewStaffDirectory],
    ['\u2605', 'Staff Updates', capabilities.viewPosts],
    ['\u25D4', 'Leave of Absence', capabilities.viewLoas],
    ['\u25A4', 'Documentation', capabilities.viewDocuments],
    ['\u25C7', 'Staff Actions', capabilities.viewStaffCases],
    ['\u265B', 'Promotion Submissions', capabilities.viewPromotions],
    ['\u25C6', 'Restricted Records', capabilities.viewRestrictedRecords],
    ['\u2301', 'Audit Log', capabilities.viewAudit],
  ].filter(([, , allowed]) => allowed);
  const rankOverview = $('#rankOverview');
  if (rankOverview) rankOverview.innerHTML = availableTools.map(([icon, label]) => `
    <div class="workspace-access-item">
      <span class="workspace-access-icon">${icon}</span>
      <strong>${escapeHtml(label)}</strong>
      <span class="workspace-access-check">\u2713</span>
    </div>`).join('');
  const workspaceTitle = $('#workspaceTitle');
  if (workspaceTitle) workspaceTitle.textContent = `${roleName(effectiveTier())} Workspace`;

  const quickActions = $('#quickActions');
  if (quickActions) quickActions.innerHTML = [
    ['requests', 'submitStaffRequest', '\u2709', 'Submit Request'],
    ['activity', 'viewActivity', '\u25EB', 'View Activity'],
    ['staff', 'viewStaffDirectory', '\u265A', 'Staff List'],
    ['promotions', 'submitPromotion', '\u265B', 'Submit Promotion'],
    ['cases', 'createRoutineCase', '\u25C7', 'Staff Action'],
    ['restricted', 'manageRestrictedRecords', '\u25C6', 'Restricted Record'],
    ['posts', 'publishUpdate', '\u2726', 'Post Update'],
    ['loas', 'viewLoas', '\u25D4', 'View LOAs'],
    ['documents', 'viewDocuments', '\u25A4', 'Open Documents'],
  ].filter(([, cap]) => capabilities[cap]).map(([tab,, icon,label]) => `<button class="quick-action" data-go="${tab}"><b>${icon}</b><span>${label}</span></button>`).join('') || '<div class="empty-state"><strong>Your workspace is ready</strong>Use the navigation to open the pages assigned to your role.</div>';
}

function promotionStepCount(status) {
  return ({ board_review: 1, returned_to_corporate: 1, presidential_review: 2, approved_awaiting_completion: 4, completed: 5, denied: 2 })[status] || 1;
}

function promotionActions(item) {
  const c = currentCapabilities();
  const viewer = state.data.viewer;
  if (isPreviewing()) return '<span class="preview-lock-note">Preview only</span>';
  const actions = [];
  if (item.status === 'board_review' && c.reviewPromotionBoard && String(item.submittedById) !== String(viewer.id)) {
    actions.push(`<button class="btn small green" data-promotion-action="board:approve" data-id="${escapeHtml(item.id)}">Board Approve</button>`);
    actions.push(`<button class="btn small ghost" data-promotion-action="board:return" data-id="${escapeHtml(item.id)}">Return</button>`);
    actions.push(`<button class="btn small danger" data-promotion-action="board:deny" data-id="${escapeHtml(item.id)}">Deny</button>`);
  }
  if (['board_review', 'returned_to_corporate'].includes(item.status) && c.approvePromotionPresidential) {
    actions.push(`<button class="btn small gold presidential-override-btn" data-promotion-action="presidential:override" data-id="${escapeHtml(item.id)}">Approve Now \u00B7 Skip Board</button>`);
  }
  if (item.status === 'presidential_review' && c.approvePromotionPresidential) {
    actions.push(`<button class="btn small gold" data-promotion-action="presidential:approve" data-id="${escapeHtml(item.id)}">Presidential Approve</button>`);
    actions.push(`<button class="btn small ghost" data-promotion-action="presidential:return" data-id="${escapeHtml(item.id)}">Return</button>`);
    actions.push(`<button class="btn small danger" data-promotion-action="presidential:deny" data-id="${escapeHtml(item.id)}">Deny</button>`);
  }
  if (item.status === 'returned_to_corporate' && String(item.submittedById) === String(viewer.id)) {
    actions.push(`<button class="btn small primary" data-promotion-edit="${escapeHtml(item.id)}">Revise & Resubmit</button>`);
  }
  if (item.status === 'approved_awaiting_completion' && c.completePromotion && String(item.assignedCompletionId) === String(viewer.id)) {
    actions.push(`<button class="btn small green" data-promotion-complete="${escapeHtml(item.id)}">Verify & Complete</button>`);
  }
  if (item.status === 'approved_awaiting_completion' && c.reviewPromotionBoard) {
    actions.push(`<button class="btn small ghost" data-promotion-reassign="${escapeHtml(item.id)}">Reassign Completion</button>`);
  }
  return actions.join('');
}

function renderPromotions() {
  const list = state.data.promotions;
  const storageBadge = $('#promotionStorageBadge');
  if (storageBadge) {
    const permanent = state.data.promotionStorage === 'supabase';
    storageBadge.textContent = permanent ? 'Permanent Supabase storage' : 'Temporary local storage';
    storageBadge.classList.toggle('ready', permanent);
    storageBadge.classList.toggle('warning', !permanent);
  }
  $('#promotionList').innerHTML = list.length ? list.map((item) => {
    const done = promotionStepCount(item.status);
    const approvals = (item.presidentialApprovals || []).map((x) => x.tag).join(', ') || 'None yet';
    return `<article class="record-card">
      <div class="record-head">
        <div class="record-title"><h3>${escapeHtml(item.submissionNumber)} \u2014 ${escapeHtml(item.candidateUsername || item.candidateId)}</h3>
          <div class="meta">${escapeHtml(item.currentRank)} \u2192 <span class="${roleClass(item.proposedTier)}">${escapeHtml(item.proposedRank)}</span> \u2022 Submitted ${formatDate(item.submittedAt)}</div>
        </div>${statusChip(item.status)}
      </div>
      <div class="flow-track">${[1,2,3,4,5].map((n) => `<span class="flow-step ${n <= done ? 'done' : ''}"></span>`).join('')}</div>
      <div class="record-body"><strong>Recommendation</strong>\n${escapeHtml(item.reason || 'No recommendation statement provided.')}</div>
      ${item.strengths ? `<div class="record-body"><strong>Strengths</strong>\n${escapeHtml(item.strengths)}</div>` : ''}
      ${item.concerns ? `<div class="record-body"><strong>Concerns disclosed</strong>\n${escapeHtml(item.concerns)}</div>` : ''}
      <div class="record-details">
        <span>Corporate owner: ${escapeHtml(item.submittedByTag || 'Unknown')}</span>
        <span>Board: ${escapeHtml(item.boardDecisionByTag || 'Pending')}</span>
        <span>Presidential approvals: ${escapeHtml(approvals)}</span>
        <span>Completion owner: ${escapeHtml(item.assignedCompletionTag || item.submittedByTag || 'Unknown')}</span>
        ${item.completionDeadline ? `<span>Deadline: ${formatDate(item.completionDeadline)}</span>` : ''}
      </div>
      ${item.boardDecisionReason ? `<div class="record-body"><strong>${item.overrideUsed ? 'Presidential override note' : 'Board note'}</strong>\n${escapeHtml(item.boardDecisionReason)}</div>` : ''}
      ${item.presidentialDecisionReason ? `<div class="record-body"><strong>Presidential note</strong>\n${escapeHtml(item.presidentialDecisionReason)}</div>` : ''}
      <div class="record-actions">${promotionActions(item)}</div>
    </article>`;
  }).join('') : '<div class="empty-state"><strong>No promotion submissions</strong>Corporate submissions will appear here after due diligence is completed.</div>';
}


function requestTypeLabel(type) {
  const labels = {
    resignation: 'Resignation',
    username_update: 'Username Update',
    loa: 'Leave of Absence',
    loa_removal: 'LOA Removal',
    timezone_change: 'Timezone Change',
  };
  return labels[type] || prettify(type);
}

function requestDetails(item) {
  const data = item.requestData || {};
  if (item.type === 'resignation') {
    return `<div class="record-details"><span>Username: ${escapeHtml(data.username || 'Not provided')}</span><span>Former Rank: ${escapeHtml(data.formerRank || 'Not provided')}</span><span>New Rank: ${escapeHtml(data.newRank || 'Not provided')}</span></div>${data.notes ? `<div class="record-body"><strong>Notes</strong>\n${escapeHtml(data.notes)}</div>` : ''}`;
  }
  if (item.type === 'username_update') {
    return `<div class="record-details"><span>Former Username: ${escapeHtml(data.formerUsername || 'Not provided')}</span><span>New Username: ${escapeHtml(data.newUsername || 'Not provided')}</span><span>Rank: ${escapeHtml(data.rank || 'Not provided')}</span></div>`;
  }
  if (item.type === 'timezone_change') {
    return `<div class="record-details"><span>Username: ${escapeHtml(data.username || item.requesterTag || 'Not provided')}</span><span>Timezone: ${escapeHtml(data.timezone || data.requestedTimezone || 'Not provided')}</span></div>`;
  }
  if (item.type === 'loa_removal') {
    return `<div class="record-details"><span>Username: ${escapeHtml(data.username || 'Not provided')}</span><span>Rank: ${escapeHtml(data.rank || 'Not provided')}</span><span>Week(s) on LOA: ${escapeHtml(data.weeksOnLoa || 'Not provided')}</span></div>`;
  }
  return `<div class="record-details"><span>Username: ${escapeHtml(data.username || item.requesterTag || 'Not provided')}</span><span>Rank: ${escapeHtml(data.rank || item.requesterTierLabel || 'Not provided')}</span><span>Starts: ${escapeHtml(data.startDate || 'Not provided')} (Monday)</span><span>Ends: ${escapeHtml(data.endDate || 'Not provided')} (Sunday)</span></div><div class="record-body"><strong>Reason</strong>\n${escapeHtml(data.reason || 'Not provided')}</div>`;
}

function staffRequestActions(item) {
  if (isPreviewing()) return '<span class="preview-lock-note">Preview only</span>';
  const c = currentCapabilities();
  const actions = [];
  const tier = effectiveTier();
  const canReview = (item.status === 'pending_corporate' && c.reviewStaffRequestsCorporate)
    || (item.status === 'pending_board' && tier >= 7)
    || (item.status === 'pending_presidential' && c.reviewStaffRequestsPresidential);
  const claimedByOther = item.reviewClaimedById && String(item.reviewClaimedById) !== String(state.data.viewer.id);
  if (canReview && !claimedByOther) {
    actions.push(`<button class="btn small green" data-staff-request-action="approve" data-id="${escapeHtml(item.id)}">Approve</button>`);
    actions.push(`<button class="btn small ghost" data-staff-request-action="return" data-id="${escapeHtml(item.id)}">Return</button>`);
    actions.push(`<button class="btn small danger" data-staff-request-action="deny" data-id="${escapeHtml(item.id)}">Deny</button>`);
  } else if (claimedByOther) {
    actions.push(`<span class="preview-lock-note">Claimed by ${escapeHtml(item.reviewClaimedByTag || 'another reviewer')}</span>`);
  }
  if (item.status === 'returned' && String(item.requesterId) === String(state.data.viewer.id)) {
    actions.push(`<button class="btn small primary" data-staff-request-resubmit="${escapeHtml(item.id)}">Revise & Resubmit</button>`);
  }
  return actions.join('');
}

function requestRouteLabel(item) {
  if (item.status === 'pending_presidential') return 'Presidential';
  if (item.status === 'pending_board') return 'Corporate Board';
  if (item.status === 'pending_corporate') return 'Corporate+';
  return 'Completed review';
}

function staffRequestCard(item) {
  return `<article class="record-card" id="request-${escapeHtml(item.id)}">
    <div class="record-head"><div class="record-title"><h3>${escapeHtml(item.requestNumber)} \u2014 ${escapeHtml(requestTypeLabel(item.type))}</h3><div class="meta">${escapeHtml(item.requesterTag || item.requesterId)} \u2022 ${escapeHtml(item.requesterTierLabel || roleName(item.requesterTier))} \u2022 ${formatDate(item.submittedAt || item.createdAt)}</div></div>${statusChip(item.status)}</div>
    ${requestDetails(item)}
    ${item.reviewClaimedByTag && item.status.startsWith('pending_') ? `<div class="review-claim"><strong>Current reviewer:</strong> ${escapeHtml(item.reviewClaimedByTag)}</div>` : ''}
    ${item.decisionNote ? `<div class="record-body"><strong>Decision note</strong>\n${escapeHtml(item.decisionNote)}</div>` : ''}
    <div class="record-details"><span>Review route: ${requestRouteLabel(item)}</span>${item.reviewedByTag ? `<span>Reviewed by ${escapeHtml(item.reviewedByTag)}</span>` : ''}</div>
    <div class="record-actions">${staffRequestActions(item)}</div>
  </article>`;
}

function renderStaffRequests() {
  const all = state.data.staffRequests || [];
  const mine = all.filter((item) => String(item.requesterId) === String(state.data.viewer.id));
  const tier = effectiveTier();
  const review = tier >= 8
    ? all.filter((item) => ['pending_presidential', 'pending_board', 'pending_corporate'].includes(item.status))
    : tier >= 7
      ? all.filter((item) => ['pending_board', 'pending_corporate'].includes(item.status))
      : tier >= 6
        ? all.filter((item) => item.status === 'pending_corporate')
        : [];
  const badge = $('#requestStorageBadge');
  if (badge) {
    const permanent = state.data.requestStorage === 'supabase';
    badge.textContent = permanent ? 'Permanent Supabase storage' : 'Temporary local storage';
    badge.classList.toggle('ready', permanent);
    badge.classList.toggle('warning', !permanent);
  }
  const reviewPanel = $('#staffRequestReviewPanel');
  const canReview = tier >= 6;
  if (reviewPanel) reviewPanel.hidden = !canReview;
  const reviewList = $('#staffRequestReviewList');
  if (reviewList && canReview) reviewList.innerHTML = review.length ? review.map(staffRequestCard).join('') : '<div class="empty-state"><strong>No requests waiting</strong>There are no requests routed to your review level.</div>';
  const myList = $('#myRequestList');
  if (myList) myList.innerHTML = mine.length ? mine.map(staffRequestCard).join('') : '<div class="empty-state"><strong>No requests submitted</strong>Your staff requests will appear here.</div>';
}

function prefillRequestForms() {
  if (!state.data?.viewer) return;
  const username = state.data.viewer.displayName || state.data.viewer.username || '';
  const rank = state.data.viewer.tierLabel || roleName(state.data.viewer.tier);
  $$('form[data-request-type]').forEach((form) => {
    if (form.elements.username && !form.elements.username.value) form.elements.username.value = username;
    if (form.elements.formerUsername && !form.elements.formerUsername.value) form.elements.formerUsername.value = username;
    if (form.elements.rank && !form.elements.rank.value) form.elements.rank.value = rank;
    if (form.elements.formerRank && !form.elements.formerRank.value) form.elements.formerRank.value = rank;
  });
}

function activityMetric(label, value, note = '') {
  return `<article class="activity-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${note ? `<small>${escapeHtml(note)}</small>` : ''}</article>`;
}

function renderActivity() {
  const self = state.data.activity?.self;
  const summary = $('#myActivitySummary');
  const breakdown = $('#activityBreakdown');
  const directory = $('#activityDirectory');
  if (!self) {
    if (summary) summary.innerHTML = '<div class="empty-state"><strong>Activity profile unavailable</strong>Your current Discord rank does not match an activity quota profile.</div>';
    if (breakdown) breakdown.innerHTML = '';
    if (directory) directory.innerHTML = '';
    return;
  }
  const current = self.current || {};
  const last = self.last || {};
  if (summary) summary.innerHTML = [
    activityMetric('Current total', current.source?.total || 0, current.rangeLabel || ''),
    activityMetric('Quota status', current.met ? 'Met' : 'In progress', self.quotaProfile?.label || ''),
    activityMetric('Last week', last.source?.total || 0, last.met ? 'Quota met' : 'Quota not met'),
  ].join('');
  const src = current.source || {};
  const metrics = [
    ['Interviews', src.interview || 0], ['Trainings', src.training || 0], ['Mass shifts', src.shift || 0],
    ['Hosted', src.hostedTotal || 0], ['Co-hosted', src.cohostTotal || 0], ['Overseer', src.overseerTotal || 0],
  ];
  if (breakdown) breakdown.innerHTML = metrics.map(([label, value]) => activityMetric(label, value)).join('');
  if (directory) {
    const rows = state.data.activity?.directory || [];
    directory.innerHTML = rows.length ? rows.map((item) => `<article class="record-card activity-directory-card"><div class="record-head"><div class="record-title"><h3>${escapeHtml(item.displayName || item.username)}</h3><div class="meta">${escapeHtml(item.tierLabel)} \u2022 ${escapeHtml(item.quotaProfile?.label || 'Activity profile')}</div></div><span class="status-chip ${item.current?.met ? 'status-approved' : 'status-pending_corporate'}">${item.current?.met ? 'Quota Met' : 'In Progress'}</span></div><div class="record-details"><span>Total: ${escapeHtml(item.current?.source?.total || 0)}</span><span>Interview: ${escapeHtml(item.current?.source?.interview || 0)}</span><span>Training: ${escapeHtml(item.current?.source?.training || 0)}</span><span>Shift: ${escapeHtml(item.current?.source?.shift || 0)}</span></div></article>`).join('') : '<div class="empty-state"><strong>No tracked LI+ activity</strong>Activity appears after the bot can read the configured Discord session logs.</div>';
  }
}

function renderStaffDirectory() {
  const directory = state.data.staffDirectory || { configured: false, members: [] };
  const status = $('#staffDirectoryStatus');
  const list = $('#staffDirectory');
  if (!directory.configured) {
    if (status) status.innerHTML = '<strong>Roblox group not connected.</strong> Add ROBLOX_GROUP_ID in Render to load the community staff list.';
    if (list) list.innerHTML = '';
    return;
  }
  if (directory.error) {
    if (status) status.innerHTML = `<strong>Staff list could not load.</strong> ${escapeHtml(directory.error)}`;
    if (list) list.innerHTML = '';
    return;
  }
  if (status) status.innerHTML = `<strong>${escapeHtml((directory.members || []).length)} current Intern+ staff</strong> synced from Roblox community ${escapeHtml(directory.groupId || '')}.`;
  if (list) list.innerHTML = (directory.members || []).length ? directory.members.map((item) => `<article class="staff-directory-card ${roleClass(item.tier)}"><div class="staff-directory-badge">${item.tier === 8 ? '\u265B' : '\u2605'}</div><div><h3>${escapeHtml(item.robloxDisplayName || item.robloxUsername)}</h3><p>@${escapeHtml(item.robloxUsername)} \u2022 ${escapeHtml(item.rankName)}</p><span>${escapeHtml(item.tierLabel)}${item.linked ? ` \u2022 Discord: ${escapeHtml(item.discordDisplayName || item.discordUserId)}` : ' \u2022 Discord not matched'}</span>${item.timezone ? `<small>Timezone: ${escapeHtml(item.timezone)}</small>` : ''}</div></article>`).join('') : '<div class="empty-state"><strong>No Intern+ Roblox members found</strong>Check the group rank names and ROBLOX_GROUP_ID.</div>';
}

function loadReturnedStaffRequest(id) {
  const item = (state.data.staffRequests || []).find((entry) => entry.id === id);
  if (!item || item.status !== 'returned') return;
  state.staffRequestResubmit = { id: item.id, type: item.type };
  const formIds = {
    resignation: '#resignationRequestForm',
    username_update: '#usernameRequestForm',
    loa: '#loaRequestForm',
    loa_removal: '#loaRemovalRequestForm',
    timezone_change: '#timezoneRequestForm',
  };
  const form = $(formIds[item.type]);
  if (!form) return;
  Object.entries(item.requestData || {}).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value ?? ''; });
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.textContent = `Resubmit ${item.requestNumber}`;
  showTab('requests');
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderCases() {
  const c = currentCapabilities();
  $('#caseList').innerHTML = state.data.cases.length ? state.data.cases.map((item) => {
    const actions = [];
    if (!isPreviewing() && c.approveSeriousCase && item.status === 'pending_approval') {
      actions.push(`<button class="btn small green" data-case-action="approved" data-id="${escapeHtml(item.id)}">Approve</button>`);
      actions.push(`<button class="btn small danger" data-case-action="denied" data-id="${escapeHtml(item.id)}">Deny</button>`);
    }
    if (!isPreviewing() && c.approveSeriousCase && item.status === 'approved') {
      actions.push(`<button class="btn small ghost" data-case-action="closed" data-id="${escapeHtml(item.id)}">Close</button>`);
      actions.push(`<button class="btn small danger" data-case-action="reversed" data-id="${escapeHtml(item.id)}">Reverse</button>`);
    }
    return `<article class="record-card"><div class="record-head"><div class="record-title"><h3>${escapeHtml(item.caseNumber)} \u2014 ${escapeHtml(item.targetUsername || item.targetId)}</h3><div class="meta">${escapeHtml(prettify(item.actionType))} \u2022 ${escapeHtml(item.targetRank || 'Rank not recorded')} \u2022 ${formatDate(item.createdAt)}</div></div>${statusChip(item.status)}</div><div class="record-body">${escapeHtml(item.reason)}</div><div class="record-details"><span>Issued by ${escapeHtml(item.createdByTag || 'Unknown')}</span>${item.length ? `<span>Length: ${escapeHtml(item.length)}</span>` : ''}${item.staffWarningCount !== null ? `<span>Warnings: ${escapeHtml(item.staffWarningCount)}</span>` : ''}${item.evidence ? `<span>Evidence: ${escapeHtml(item.evidence)}</span>` : ''}</div>${item.decisionReason ? `<div class="record-body"><strong>Decision</strong>\n${escapeHtml(item.decisionReason)}</div>` : ''}<div class="record-actions">${actions.join('')}</div></article>`;
  }).join('') : '<div class="empty-state"><strong>No staff actions</strong>Approved and pending staff actions will be stored here.</div>';
}

function renderRestricted() {
  $('#restrictedList').innerHTML = state.data.restrictedRecords.length ? state.data.restrictedRecords.map((item) => `<article class="record-card"><div class="record-head"><div class="record-title"><h3>${escapeHtml(item.recordNumber)} \u2014 ${escapeHtml(item.subjectName || item.subjectId)}</h3><div class="meta">${escapeHtml(item.category)} \u2022 ${formatDate(item.createdAt)}</div></div>${statusChip(item.status)}</div><div class="record-body">${escapeHtml(item.summary)}</div>${item.evidence ? `<div class="record-body"><strong>Evidence</strong>\n${escapeHtml(item.evidence)}</div>` : ''}${item.resolution ? `<div class="record-body"><strong>Resolution</strong>\n${escapeHtml(item.resolution)}</div>` : ''}<div class="record-details"><span>Created by ${escapeHtml(item.createdByTag || 'Unknown')}</span><span>Every view and edit is auditable</span></div><div class="record-actions">${isPreviewing() ? '<span class="preview-lock-note">Preview only</span>' : `<button class="btn small ghost" data-restricted-update="${escapeHtml(item.id)}">Update Record</button>`}</div></article>`).join('') : '<div class="empty-state"><strong>No restricted records</strong>Board-level investigations and confidential decisions will remain here.</div>';
}

function renderDocuments() {
  const visibleDocuments = state.data.documents.filter((item) => effectiveTier() >= Number(item.visibilityTier || 4));
  $('#documentList').innerHTML = visibleDocuments.length ? visibleDocuments.map((item) => `<article class="record-card"><div class="record-head"><div class="record-title"><h3>${escapeHtml(item.title)}</h3><div class="meta">${escapeHtml(item.category)} \u2022 Updated ${formatDate(item.updatedAt)}</div></div><span class="tiny-chip ${roleClass(item.visibilityTier)}">${escapeHtml(roleName(item.visibilityTier))}+</span></div><div class="record-body">${escapeHtml(item.content)}</div><div class="record-details"><span>Published by ${escapeHtml(item.createdByTag || 'Unknown')}</span></div></article>`).join('') : '<div class="empty-state"><strong>No documents available</strong>Documents visible to your rank will appear here.</div>';
}

function renderPosts() {
  $('#postList').innerHTML = state.data.posts.length ? state.data.posts.map((item) => `<article class="record-card"><div class="record-head"><div class="record-title"><h3>${escapeHtml(item.title)}</h3><div class="meta">${escapeHtml(prettify(item.type))} \u2022 ${formatDate(item.createdAt)}</div></div>${statusChip(item.posted ? 'approved' : 'pending_approval')}</div><div class="record-body">${escapeHtml(item.content)}</div><div class="record-details"><span>Created by ${escapeHtml(item.createdByTag || 'Unknown')}</span><span>${item.posted ? 'Posted to Discord' : 'Saved; Discord channel not configured'}</span></div></article>`).join('') : '<div class="empty-state"><strong>No schedules or updates</strong>Published posts will appear here.</div>';
}

function renderLoas() {
  $('#loaList').innerHTML = state.data.loas.length ? state.data.loas.map((item) => `<article class="record-card"><div class="record-head"><div class="record-title"><h3>${escapeHtml(item.originalDisplayName || item.staffCardName || item.userId)}</h3><div class="meta">${escapeHtml(item.staffClassLabel || item.loaType || 'Staff')} \u2022 ${escapeHtml(item.officialStartDate || 'Unknown')} to ${escapeHtml(item.officialEndDate || 'Unknown')}</div></div>${statusChip('active')}</div><div class="record-body">${escapeHtml(item.reason || 'No reason recorded.')}</div><div class="record-details"><span>Reviewer: ${escapeHtml(item.reviewerUsername || 'Unknown')}</span></div></article>`).join('') : '<div class="empty-state"><strong>No active LOAs</strong>The current LOA display is clear.</div>';
  $('#loaHistoryList').innerHTML = state.data.loaHistory.length ? state.data.loaHistory.map((item) => `<article class="record-card"><div class="record-head"><div class="record-title"><h3>${escapeHtml(item.originalDisplayName || item.staffCardName || item.userId)}</h3><div class="meta">${escapeHtml(item.officialStartDate || 'Unknown')} to ${escapeHtml(item.officialEndDate || 'Unknown')}</div></div>${statusChip('closed')}</div><div class="record-body">${escapeHtml(item.reason || 'No reason recorded.')}</div><div class="record-details"><span>Ended by ${escapeHtml(item.endedByTag || item.endedById || 'Unknown')}</span><span>${formatDate(item.endedAt)}</span></div></article>`).join('') : '<div class="empty-state"><strong>No LOA history yet</strong>Ended LOAs will remain available here.</div>';
}

function renderAudit() {
  $('#auditList').innerHTML = state.data.audit.length ? state.data.audit.map((item) => `<article class="record-card"><div class="record-head"><div class="record-title"><h3>${escapeHtml(prettify(item.action))}</h3><div class="meta">${escapeHtml(item.actorTag || 'Unknown actor')} \u2022 ${formatDate(item.createdAt)}</div></div><span class="tiny-chip role-board">Audit</span></div><div class="record-body">${escapeHtml(JSON.stringify(item.details || {}, null, 2))}</div></article>`).join('') : '<div class="empty-state"><strong>No audit entries</strong>High-impact website and bot activity will appear here.</div>';
}

function renderAll() {
  renderViewer();
  const capabilities = currentCapabilities();
  renderDashboard();
  if (capabilities.viewStaffRequests) { renderStaffRequests(); prefillRequestForms(); }
  if (capabilities.viewActivity) renderActivity();
  if (capabilities.viewStaffDirectory) renderStaffDirectory();
  if (capabilities.viewPromotions) renderPromotions();
  if (capabilities.viewStaffCases) renderCases();
  if (capabilities.viewRestrictedRecords) renderRestricted();
  if (capabilities.viewDocuments) renderDocuments();
  if (capabilities.viewPosts) renderPosts();
  if (capabilities.viewLoas) renderLoas();
  if (capabilities.viewAudit) renderAudit();
  showTab(state.initialTab || location.hash.slice(1) || state.activeTab);
  state.initialTab = null;
  applyPreviewLock();
}

async function refresh() {
  const result = await api('/ops/api/bootstrap');
  state.data = result.data;
  state.csrf = result.data.csrf;
  const realTier = Number(state.data?.viewer?.tier) || 3;
  const canPreview = Boolean(state.data?.viewer?.canPreviewTiers) || realTier >= 8;
  if (!canPreview) {
    state.previewTier = null;
    sessionStorage.removeItem('glacePreviewTier');
  } else if (state.previewTier === null) {
    const savedTier = Number(sessionStorage.getItem('glacePreviewTier'));
    if (savedTier >= 3 && savedTier <= 8 && savedTier !== realTier) state.previewTier = savedTier;
  }
  renderAll();
}

function openDecision(config) {
  state.decision = config;
  $('#decisionTitle').textContent = config.title;
  $('#decisionCopy').textContent = config.copy || 'Add the decision reason for the permanent audit record.';
  $('#decisionReason').value = '';
  $('#decisionDialog').showModal();
}

async function submitDecision() {
  const config = state.decision;
  const reason = $('#decisionReason').value.trim();
  if (config.requireReason !== false && !reason) return notify('A decision reason is required.', 'error');
  try {
    if (config.kind === 'promotion') {
      const action = config.action === 'override'
        ? 'presidential_override'
        : (config.stage === 'board' ? 'board_decision' : 'presidential_decision');
      const payload = action === 'presidential_override'
        ? { action, reason }
        : { action, decision: config.action, reason };
      await api(`/ops/api/promotions/${encodeURIComponent(config.id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
    } else if (config.kind === 'staffRequest') {
      await api(`/ops/api/staff-requests/${encodeURIComponent(config.id)}`, { method: 'PATCH', body: JSON.stringify({ action: config.action, note: reason }) });
    } else if (config.kind === 'case') {
      await api(`/ops/api/cases/${encodeURIComponent(config.id)}`, { method: 'PATCH', body: JSON.stringify({ status: config.action, decisionReason: reason }) });
    } else if (config.kind === 'restricted') {
      await api(`/ops/api/restricted/${encodeURIComponent(config.id)}`, { method: 'PATCH', body: JSON.stringify({ status: $('#decisionStatus').value, resolution: reason }) });
    }
    $('#decisionDialog').close();
    await refresh();
    notify('The record was updated.');
  } catch (error) { notify(error.message, 'error'); }
}

function editPromotion(id) {
  const item = state.data.promotions.find((entry) => entry.id === id);
  if (!item) return;
  state.promotionMode = 'resubmit';
  $('#promotionId').value = item.id;
  const form = $('#promotionForm');
  for (const field of ['candidateId','candidateUsername','currentRank','proposedRank','proposedTier','reason','evidence','strengths','concerns']) {
    if (form.elements[field]) form.elements[field].value = item[field] ?? '';
  }
  form.elements.diligenceConfirmed.checked = Boolean(item.diligenceConfirmed);
  $('#promotionFormTitle').textContent = `Revise ${item.submissionNumber}`;
  $('#promotionSubmit').textContent = 'Resubmit to Review';
  showTab('promotions');
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetPromotionForm() {
  state.promotionMode = 'create';
  $('#promotionForm').reset();
  $('#promotionId').value = '';
  $('#promotionFormTitle').textContent = 'New Promotion Submission';
  $('#promotionSubmit').textContent = 'Submit for Board Review';
}

async function completePromotion(id) {
  const item = state.data.promotions.find((entry) => entry.id === id);
  if (!item) return;
  if (!confirm(`Verify that ${item.candidateUsername || item.candidateId} now has the approved Discord rank and complete this promotion?`)) return;
  try {
    const result = await api(`/ops/api/promotions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ action: 'complete' }) });
    await refresh();
    notify(result.warning || 'Promotion verified and completed. Staff Journey announcements remain manual.');
  } catch (error) { notify(error.message, 'error'); }
}

function openReassign(id) {
  state.decision = { kind: 'reassign', id };
  $('#reassignId').value = id;
  $('#reassignForm').reset();
  $('#reassignId').value = id;
  $('#reassignDialog').showModal();
}

function bindEvents() {
  $$('[data-tab]').forEach((button) => button.addEventListener('click', () => showTab(button.dataset.tab)));
  $('#previewTier')?.addEventListener('change', (event) => {
    if (!state.data?.viewer?.canPreviewTiers) return;
    const selected = Number(event.target.value);
    state.previewTier = selected === Number(state.data.viewer.tier) ? null : selected;
    if (state.previewTier) sessionStorage.setItem('glacePreviewTier', String(state.previewTier));
    else sessionStorage.removeItem('glacePreviewTier');
    state.activeTab = 'dashboard';
    renderAll();
    notify(state.previewTier ? `Previewing the portal as ${roleName(selected)}.` : 'Returned to your real Presidential access.');
  });
  $('#exitPreview')?.addEventListener('click', () => {
    state.previewTier = null;
    sessionStorage.removeItem('glacePreviewTier');
    $('#previewTier').value = String(state.data.viewer.tier);
    state.activeTab = 'dashboard';
    renderAll();
    notify('Returned to your real Presidential access.');
  });
  document.addEventListener('click', async (event) => {
    const mutationTarget = event.target.closest('[data-promotion-action], [data-promotion-edit], [data-promotion-complete], [data-promotion-reassign], [data-staff-request-action], [data-staff-request-resubmit], [data-case-action], [data-restricted-update]');
    if (mutationTarget && isPreviewing()) {
      event.preventDefault();
      notify('Exit Preview mode before changing records.', 'error');
      return;
    }
    const go = event.target.closest('[data-go]');
    if (go) showTab(go.dataset.go);

    const promoAction = event.target.closest('[data-promotion-action]');
    if (promoAction) {
      const [stage, action] = promoAction.dataset.promotionAction.split(':');
      const id = promoAction.dataset.id;
      if (action === 'approve') {
        try {
          const payload = { action: stage === 'board' ? 'board_decision' : 'presidential_decision', decision: 'approve', reason: '' };
          await api(`/ops/api/promotions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
          await refresh();
          notify(`${stage === 'board' ? 'Board' : 'Presidential'} approval recorded.`);
        } catch (error) { notify(error.message, 'error'); }
      } else {
        const isOverride = action === 'override';
        openDecision({
          kind: 'promotion', stage, action, id,
          title: isOverride ? 'Presidential Approval Override' : `${prettify(stage)}: ${prettify(action)} Promotion`,
          copy: isOverride
            ? 'This skips Corporate Board review and records your Presidential approval immediately. Explain why the override is appropriate.'
            : 'Explain why this submission is being returned or denied.',
        });
      }
    }
    const promoEdit = event.target.closest('[data-promotion-edit]');
    if (promoEdit) editPromotion(promoEdit.dataset.promotionEdit);
    const promoComplete = event.target.closest('[data-promotion-complete]');
    if (promoComplete) completePromotion(promoComplete.dataset.promotionComplete);
    const promoReassign = event.target.closest('[data-promotion-reassign]');
    if (promoReassign) openReassign(promoReassign.dataset.promotionReassign);

    const staffRequestAction = event.target.closest('[data-staff-request-action]');
    if (staffRequestAction) {
      const action = staffRequestAction.dataset.staffRequestAction;
      const id = staffRequestAction.dataset.id;
      if (action === 'approve') {
        try {
          await api(`/ops/api/staff-requests/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ action: 'approve', note: '' }) });
          await refresh();
          notify('Staff request approved and applied.');
        } catch (error) { notify(error.message, 'error'); }
      } else {
        openDecision({
          kind: 'staffRequest', id, action,
          title: `${prettify(action)} Staff Request`,
          copy: 'Explain why this request is being returned or denied.',
        });
      }
    }
    const staffRequestResubmit = event.target.closest('[data-staff-request-resubmit]');
    if (staffRequestResubmit) loadReturnedStaffRequest(staffRequestResubmit.dataset.staffRequestResubmit);

    const caseAction = event.target.closest('[data-case-action]');
    if (caseAction) openDecision({ kind: 'case', id: caseAction.dataset.id, action: caseAction.dataset.caseAction, title: `${prettify(caseAction.dataset.caseAction)} Staff Action` });
    const restrictedUpdate = event.target.closest('[data-restricted-update]');
    if (restrictedUpdate) {
      $('#decisionStatusWrap').hidden = false;
      $('#decisionStatus').innerHTML = ['open','under_review','resolved','do_not_rehire','archived'].map((x) => `<option value="${x}">${prettify(x)}</option>`).join('');
      openDecision({ kind: 'restricted', id: restrictedUpdate.dataset.restrictedUpdate, title: 'Update Restricted Record', copy: 'Choose the record status and enter the confidential resolution note.' });
    }
  });

  $('#decisionDialog').addEventListener('close', () => { $('#decisionStatusWrap').hidden = true; state.decision = null; });
  $('#decisionSubmit').addEventListener('click', submitDecision);
  $('#decisionCancel').addEventListener('click', () => $('#decisionDialog').close());
  $('#reassignCancel').addEventListener('click', () => $('#reassignDialog').close());

  $('#promotionForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (blockPreviewSubmit(event)) return;
    const payload = formDataObject(event.currentTarget);
    try {
      if (state.promotionMode === 'resubmit') {
        await api(`/ops/api/promotions/${encodeURIComponent($('#promotionId').value)}`, { method: 'PATCH', body: JSON.stringify({ action: 'resubmit', ...payload }) });
      } else {
        await api('/ops/api/promotions', { method: 'POST', body: JSON.stringify(payload) });
      }
      resetPromotionForm();
      await refresh();
      notify('Promotion submitted and routed to the correct Discord approval channel.');
    } catch (error) { notify(error.message, 'error'); }
  });
  $('#promotionReset')?.addEventListener('click', resetPromotionForm);

  const requestFormLabels = {
    resignation: 'Submit Resignation',
    username_update: 'Submit Username Update',
    loa: 'Submit LOA Request',
    loa_removal: 'Submit LOA Removal',
    timezone_change: 'Submit Timezone Update',
  };
  $$('form[data-request-type]').forEach((form) => form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (blockPreviewSubmit(event)) return;
    const type = event.currentTarget.dataset.requestType;
    const requestData = formDataObject(event.currentTarget);
    try {
      if (state.staffRequestResubmit?.type === type) {
        await api(`/ops/api/staff-requests/${encodeURIComponent(state.staffRequestResubmit.id)}`, { method: 'PATCH', body: JSON.stringify({ action: 'resubmit', requestData }) });
      } else {
        await api('/ops/api/staff-requests', { method: 'POST', body: JSON.stringify({ type, requestData }) });
      }
      state.staffRequestResubmit = null;
      event.currentTarget.reset();
      const submit = event.currentTarget.querySelector('button[type="submit"]');
      if (submit) submit.textContent = requestFormLabels[type] || 'Submit Request';
      await refresh();
      notify(`${requestTypeLabel(type)} submitted and routed to the correct review channel.`);
    } catch (error) { notify(error.message, 'error'); }
  }));
  $('#postRequestPanel')?.addEventListener('click', async () => {
    if (isPreviewing()) return notify('Exit Preview mode before posting the Discord panel.', 'error');
    try { await api('/ops/api/staff-requests/panel', { method: 'POST', body: JSON.stringify({}) }); notify('The staff request panel was posted in Discord.'); }
    catch (error) { notify(error.message, 'error'); }
  });
  $('#refreshStaffDirectory')?.addEventListener('click', async () => {
    try {
      const result = await api('/ops/api/staff-directory/refresh', { method: 'POST', body: JSON.stringify({}) });
      state.data.staffDirectory = result.directory;
      renderStaffDirectory();
      notify('Roblox staff list refreshed.');
    } catch (error) { notify(error.message, 'error'); }
  });

  $('#caseForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (blockPreviewSubmit(event)) return;
    try { await api('/ops/api/cases', { method: 'POST', body: JSON.stringify(formDataObject(event.currentTarget)) }); event.currentTarget.reset(); await refresh(); notify('Staff action saved.'); } catch (error) { notify(error.message, 'error'); }
  });
  $('#restrictedForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (blockPreviewSubmit(event)) return;
    try { await api('/ops/api/restricted', { method: 'POST', body: JSON.stringify(formDataObject(event.currentTarget)) }); event.currentTarget.reset(); await refresh(); notify('Restricted record created.'); } catch (error) { notify(error.message, 'error'); }
  });
  $('#documentForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (blockPreviewSubmit(event)) return;
    try { await api('/ops/api/documents', { method: 'POST', body: JSON.stringify(formDataObject(event.currentTarget)) }); event.currentTarget.reset(); await refresh(); notify('Document published.'); } catch (error) { notify(error.message, 'error'); }
  });
  $('#postForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (blockPreviewSubmit(event)) return;
    try { const result = await api('/ops/api/posts', { method: 'POST', body: JSON.stringify(formDataObject(event.currentTarget)) }); event.currentTarget.reset(); await refresh(); notify(result.warning || 'Post saved and sent to Discord.'); } catch (error) { notify(error.message, 'error'); }
  });
  $('#reassignForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (blockPreviewSubmit(event)) return;
    try { await api(`/ops/api/promotions/${encodeURIComponent($('#reassignId').value)}`, { method: 'PATCH', body: JSON.stringify({ action: 'reassign', ...formDataObject(event.currentTarget) }) }); $('#reassignDialog').close(); await refresh(); notify('Completion owner reassigned.'); } catch (error) { notify(error.message, 'error'); }
  });

  $('#globalSearch')?.addEventListener('input', (event) => {
    const query = event.target.value.toLowerCase().trim();
    const section = $(`#section-${state.activeTab}`);
    $$('.record-card', section).forEach((card) => { card.hidden = Boolean(query) && !card.textContent.toLowerCase().includes(query); });
  });
}

async function init() {
  bindEvents();
  try {
    await refresh();
    $('#loading').hidden = true;
    $('#app').hidden = false;
  } catch (error) {
    $('#loadingMessage').textContent = `${error.message} Sign in again if your session expired.`;
  }
}

document.addEventListener('DOMContentLoaded', init);
