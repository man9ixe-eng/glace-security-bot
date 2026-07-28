'use strict';

const state = { data: null, csrf: null, activeTab: 'dashboard', decision: null, promotionMode: 'create', previewTier: null, viewCapabilities: null };
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
  const viewer = state.data.viewer;
  const viewTier = effectiveTier();
  const previewing = isPreviewing();
  state.viewCapabilities = previewing ? capabilitiesForTier(viewTier) : { ...state.data.capabilities };
  applyTheme(viewTier);

  $('#profileName').textContent = viewer.displayName;
  $('#profileRole').textContent = previewing
    ? `${viewer.tierLabel} • previewing ${roleName(viewTier)}`
    : viewer.tierLabel;
  $('#opsBadge').textContent = previewing ? `${roleName(viewTier)} Preview` : viewer.tierLabel;
  $('#opsBadge').className = `role-chip ${roleClass(viewTier)}`;
  $('#pageTierLabel').textContent = roleName(viewTier);
  $('#pageTierLabel').className = roleClass(viewTier);
  $('#pageEyebrow').textContent = previewing ? 'PRESIDENTIAL PREVIEW MODE' : `${roleName(viewTier).toUpperCase()} STAFF HUB`;

  const previewControl = $('#previewControl');
  previewControl.hidden = !viewer.canPreviewTiers;
  if (viewer.canPreviewTiers) $('#previewTier').value = String(viewTier);

  const avatar = $('#profileAvatar');
  if (viewer.avatar) {
    avatar.innerHTML = `<img src="${escapeHtml(viewer.avatar)}" alt="" class="avatar">`;
  } else {
    avatar.innerHTML = `<div class="avatar">${escapeHtml((viewer.displayName || 'G')[0].toUpperCase())}</div>`;
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
  const activeWatch = d.watchRecords.filter((x) => ['active', 'improving', 'escalated'].includes(x.status)).length;
  const stats = [
    ['Promotion Submissions', capabilities.viewPromotions ? pendingPromotions : '—', capabilities.viewPromotions ? `${awaitingCompletion} awaiting completion` : 'Corporate access', 'role-intern', '♛'],
    ['Staff Actions', capabilities.viewStaffCases ? openCases : '—', capabilities.viewStaffCases ? `${d.cases.filter((x) => x.status === 'pending_approval').length} awaiting Board` : 'Senior Management access', 'role-management', '◇'],
    ['Current LOAs', d.loas.length, `${d.loaHistory.length} recent ended records`, 'role-senior', '◔'],
    ['Watch Records', capabilities.viewWatchRecords ? activeWatch : '—', capabilities.viewWatchRecords ? `${d.watchRecords.filter((x) => x.status === 'escalated').length} escalated` : 'Corporate access', 'role-corporate', '◉'],
    ['Restricted Records', capabilities.viewRestrictedRecords ? d.restrictedRecords.filter((x) => x.status !== 'archived').length : '—', capabilities.viewRestrictedRecords ? 'Board-level confidentiality' : 'Corporate Board access', 'role-board', '◆'],
    ['Documents', capabilities.viewDocuments ? d.documents.length : '—', `${d.posts.length} schedule/update posts`, 'role-presidential', '▤'],
  ];
  $('#dashboardStats').innerHTML = stats.map((item) => statCard(...item)).join('');

  const feed = d.feed.slice(0, 7);
  $('#journeyFeed').innerHTML = feed.length ? feed.map((entry) => `
    <div class="activity-item">
      <div class="activity-icon ${roleClass(entry.tier || 3)}">${escapeHtml(entry.icon || '❄')}</div>
      <div class="activity-copy"><strong>${escapeHtml(entry.title)}</strong><span>${escapeHtml(entry.detail || '')}</span></div>
      <span class="activity-time">${escapeHtml(relativeTime(entry.createdAt))}</span>
    </div>`).join('') : '<div class="empty-state"><strong>No recent activity</strong>New portal activity will appear here.</div>';

  const approvals = [
    ...(capabilities.viewPromotions ? d.promotions.filter((x) => ['board_review', 'presidential_review', 'approved_awaiting_completion'].includes(x.status)).map((x) => ({
      title: `${x.candidateUsername || x.candidateId}: ${x.currentRank} → ${x.proposedRank}`,
      meta: `${x.submissionNumber} • ${prettify(x.status)}`,
      tier: x.proposedTier,
      tab: 'promotions',
    })) : []),
    ...(capabilities.viewStaffCases ? d.cases.filter((x) => x.status === 'pending_approval').map((x) => ({
      title: `${x.caseNumber}: ${x.targetUsername || x.targetId}`,
      meta: `${prettify(x.actionType)} • Board review`,
      tier: 7,
      tab: 'cases',
    })) : []),
  ].slice(0, 7);
  $('#approvalPreview').innerHTML = approvals.length ? approvals.map((item) => `
    <button class="activity-item" data-go="${item.tab}" style="width:100%;color:inherit;text-align:left;cursor:pointer">
      <div class="activity-icon ${roleClass(item.tier)}">↗</div>
      <div class="activity-copy"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.meta)}</span></div>
      <span class="tiny-chip ${roleClass(item.tier)}">${escapeHtml(roleName(item.tier))}</span>
    </button>`).join('') : '<div class="empty-state"><strong>Queue is clear</strong>No approvals are waiting at your access level.</div>';

  $('#rankOverview').innerHTML = [
    [3, 'Intern Team'], [4, 'Management'], [5, 'Senior Management'], [6, 'Corporate'], [7, 'Corporate Board'], [8, 'Presidential'],
  ].map(([tier, label]) => `<div class="rank-row ${roleClass(tier)} ${tier === effectiveTier() ? 'current' : ''}"><span class="rank-dot"></span><strong>${label}</strong><span>${tier === effectiveTier() ? 'Current view' : 'Role access'}</span></div>`).join('');

  $('#quickActions').innerHTML = [
    ['promotions', 'submitPromotion', '♛', 'Submit Promotion'],
    ['cases', 'createRoutineCase', '◇', 'Staff Action'],
    ['watch', 'manageWatchRecords', '◉', 'Watch Record'],
    ['restricted', 'manageRestrictedRecords', '◆', 'Restricted Record'],
    ['posts', 'publishUpdate', '✦', 'Post Update'],
    ['loas', 'viewLoas', '◔', 'View LOAs'],
  ].filter(([, cap]) => capabilities[cap]).map(([tab,, icon,label]) => `<button class="quick-action" data-go="${tab}"><b>${icon}</b>${label}</button>`).join('') || '<div class="empty-state"><strong>Your access is ready</strong>Use the navigation to view the tools assigned to your rank.</div>';
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
  if (item.status === 'presidential_review' && c.approvePromotionPresidential && String(item.submittedById) !== String(viewer.id)) {
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
  $('#promotionList').innerHTML = list.length ? list.map((item) => {
    const done = promotionStepCount(item.status);
    const approvals = (item.presidentialApprovals || []).map((x) => x.tag).join(', ') || 'None yet';
    return `<article class="record-card">
      <div class="record-head">
        <div class="record-title"><h3>${escapeHtml(item.submissionNumber)} — ${escapeHtml(item.candidateUsername || item.candidateId)}</h3>
          <div class="meta">${escapeHtml(item.currentRank)} → <span class="${roleClass(item.proposedTier)}">${escapeHtml(item.proposedRank)}</span> • Submitted ${formatDate(item.submittedAt)}</div>
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
      ${item.boardDecisionReason ? `<div class="record-body"><strong>Board note</strong>\n${escapeHtml(item.boardDecisionReason)}</div>` : ''}
      ${item.presidentialDecisionReason ? `<div class="record-body"><strong>Presidential note</strong>\n${escapeHtml(item.presidentialDecisionReason)}</div>` : ''}
      <div class="record-actions">${promotionActions(item)}</div>
    </article>`;
  }).join('') : '<div class="empty-state"><strong>No promotion submissions</strong>Corporate submissions will appear here after due diligence is completed.</div>';
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
    return `<article class="record-card"><div class="record-head"><div class="record-title"><h3>${escapeHtml(item.caseNumber)} — ${escapeHtml(item.targetUsername || item.targetId)}</h3><div class="meta">${escapeHtml(prettify(item.actionType))} • ${escapeHtml(item.targetRank || 'Rank not recorded')} • ${formatDate(item.createdAt)}</div></div>${statusChip(item.status)}</div><div class="record-body">${escapeHtml(item.reason)}</div><div class="record-details"><span>Issued by ${escapeHtml(item.createdByTag || 'Unknown')}</span>${item.length ? `<span>Length: ${escapeHtml(item.length)}</span>` : ''}${item.staffWarningCount !== null ? `<span>Warnings: ${escapeHtml(item.staffWarningCount)}</span>` : ''}${item.evidence ? `<span>Evidence: ${escapeHtml(item.evidence)}</span>` : ''}</div>${item.decisionReason ? `<div class="record-body"><strong>Decision</strong>\n${escapeHtml(item.decisionReason)}</div>` : ''}<div class="record-actions">${actions.join('')}</div></article>`;
  }).join('') : '<div class="empty-state"><strong>No staff actions</strong>Approved and pending staff actions will be stored here.</div>';
}

function renderWatch() {
  $('#watchList').innerHTML = state.data.watchRecords.length ? state.data.watchRecords.map((item) => `<article class="record-card"><div class="record-head"><div class="record-title"><h3>${escapeHtml(item.recordNumber)} — ${escapeHtml(item.targetUsername || item.targetId)}</h3><div class="meta">${escapeHtml(item.targetRank || 'Rank not recorded')} • Review ${formatDate(item.reviewDate, true)}</div></div>${statusChip(item.status)}</div><div class="record-body"><strong>Reason</strong>\n${escapeHtml(item.reason)}</div><div class="record-body"><strong>Expected improvement</strong>\n${escapeHtml(item.expectations || 'Not recorded')}</div>${item.outcome ? `<div class="record-body"><strong>Outcome</strong>\n${escapeHtml(item.outcome)}</div>` : ''}<div class="record-details"><span>Reviewer: ${escapeHtml(item.reviewerTag || 'Unknown')}</span><span>Created: ${formatDate(item.createdAt)}</span></div><div class="record-actions">${isPreviewing() ? '<span class="preview-lock-note">Preview only</span>' : `<button class="btn small ghost" data-watch-update="${escapeHtml(item.id)}">Update Status</button>`}</div></article>`).join('') : '<div class="empty-state"><strong>No watch records</strong>Private monitoring records created by Corporate will appear here.</div>';
}

function renderRestricted() {
  $('#restrictedList').innerHTML = state.data.restrictedRecords.length ? state.data.restrictedRecords.map((item) => `<article class="record-card"><div class="record-head"><div class="record-title"><h3>${escapeHtml(item.recordNumber)} — ${escapeHtml(item.subjectName || item.subjectId)}</h3><div class="meta">${escapeHtml(item.category)} • ${formatDate(item.createdAt)}</div></div>${statusChip(item.status)}</div><div class="record-body">${escapeHtml(item.summary)}</div>${item.evidence ? `<div class="record-body"><strong>Evidence</strong>\n${escapeHtml(item.evidence)}</div>` : ''}${item.resolution ? `<div class="record-body"><strong>Resolution</strong>\n${escapeHtml(item.resolution)}</div>` : ''}<div class="record-details"><span>Created by ${escapeHtml(item.createdByTag || 'Unknown')}</span><span>Every view and edit is auditable</span></div><div class="record-actions">${isPreviewing() ? '<span class="preview-lock-note">Preview only</span>' : `<button class="btn small ghost" data-restricted-update="${escapeHtml(item.id)}">Update Record</button>`}</div></article>`).join('') : '<div class="empty-state"><strong>No restricted records</strong>Board-level investigations and confidential decisions will remain here.</div>';
}

function renderDocuments() {
  const visibleDocuments = state.data.documents.filter((item) => effectiveTier() >= Number(item.visibilityTier || 4));
  $('#documentList').innerHTML = visibleDocuments.length ? visibleDocuments.map((item) => `<article class="record-card"><div class="record-head"><div class="record-title"><h3>${escapeHtml(item.title)}</h3><div class="meta">${escapeHtml(item.category)} • Updated ${formatDate(item.updatedAt)}</div></div><span class="tiny-chip ${roleClass(item.visibilityTier)}">${escapeHtml(roleName(item.visibilityTier))}+</span></div><div class="record-body">${escapeHtml(item.content)}</div><div class="record-details"><span>Published by ${escapeHtml(item.createdByTag || 'Unknown')}</span></div></article>`).join('') : '<div class="empty-state"><strong>No documents available</strong>Documents visible to your rank will appear here.</div>';
}

function renderPosts() {
  $('#postList').innerHTML = state.data.posts.length ? state.data.posts.map((item) => `<article class="record-card"><div class="record-head"><div class="record-title"><h3>${escapeHtml(item.title)}</h3><div class="meta">${escapeHtml(prettify(item.type))} • ${formatDate(item.createdAt)}</div></div>${statusChip(item.posted ? 'approved' : 'pending_approval')}</div><div class="record-body">${escapeHtml(item.content)}</div><div class="record-details"><span>Created by ${escapeHtml(item.createdByTag || 'Unknown')}</span><span>${item.posted ? 'Posted to Discord' : 'Saved; Discord channel not configured'}</span></div></article>`).join('') : '<div class="empty-state"><strong>No schedules or updates</strong>Published posts will appear here.</div>';
}

function renderLoas() {
  $('#loaList').innerHTML = state.data.loas.length ? state.data.loas.map((item) => `<article class="record-card"><div class="record-head"><div class="record-title"><h3>${escapeHtml(item.originalDisplayName || item.staffCardName || item.userId)}</h3><div class="meta">${escapeHtml(item.staffClassLabel || item.loaType || 'Staff')} • ${escapeHtml(item.officialStartDate || 'Unknown')} to ${escapeHtml(item.officialEndDate || 'Unknown')}</div></div>${statusChip('active')}</div><div class="record-body">${escapeHtml(item.reason || 'No reason recorded.')}</div><div class="record-details"><span>Reviewer: ${escapeHtml(item.reviewerUsername || 'Unknown')}</span></div></article>`).join('') : '<div class="empty-state"><strong>No active LOAs</strong>The current LOA display is clear.</div>';
  $('#loaHistoryList').innerHTML = state.data.loaHistory.length ? state.data.loaHistory.map((item) => `<article class="record-card"><div class="record-head"><div class="record-title"><h3>${escapeHtml(item.originalDisplayName || item.staffCardName || item.userId)}</h3><div class="meta">${escapeHtml(item.officialStartDate || 'Unknown')} to ${escapeHtml(item.officialEndDate || 'Unknown')}</div></div>${statusChip('closed')}</div><div class="record-body">${escapeHtml(item.reason || 'No reason recorded.')}</div><div class="record-details"><span>Ended by ${escapeHtml(item.endedByTag || item.endedById || 'Unknown')}</span><span>${formatDate(item.endedAt)}</span></div></article>`).join('') : '<div class="empty-state"><strong>No LOA history yet</strong>Ended LOAs will remain available here.</div>';
}

function renderAudit() {
  $('#auditList').innerHTML = state.data.audit.length ? state.data.audit.map((item) => `<article class="record-card"><div class="record-head"><div class="record-title"><h3>${escapeHtml(prettify(item.action))}</h3><div class="meta">${escapeHtml(item.actorTag || 'Unknown actor')} • ${formatDate(item.createdAt)}</div></div><span class="tiny-chip role-board">Audit</span></div><div class="record-body">${escapeHtml(JSON.stringify(item.details || {}, null, 2))}</div></article>`).join('') : '<div class="empty-state"><strong>No audit entries</strong>High-impact website and bot activity will appear here.</div>';
}

function renderAll() {
  renderViewer();
  const capabilities = currentCapabilities();
  renderDashboard();
  if (capabilities.viewPromotions) renderPromotions();
  if (capabilities.viewStaffCases) renderCases();
  if (capabilities.viewWatchRecords) renderWatch();
  if (capabilities.viewRestrictedRecords) renderRestricted();
  if (capabilities.viewDocuments) renderDocuments();
  if (capabilities.viewPosts) renderPosts();
  if (capabilities.viewLoas) renderLoas();
  if (capabilities.viewAudit) renderAudit();
  showTab(location.hash.slice(1) || state.activeTab);
  applyPreviewLock();
}

async function refresh() {
  const result = await api('/ops/api/bootstrap');
  state.data = result.data;
  state.csrf = result.data.csrf;
  if (!state.data.viewer.canPreviewTiers) state.previewTier = null;
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
      await api(`/ops/api/promotions/${encodeURIComponent(config.id)}`, { method: 'PATCH', body: JSON.stringify({ action: config.stage === 'board' ? 'board_decision' : 'presidential_decision', decision: config.action, reason }) });
    } else if (config.kind === 'case') {
      await api(`/ops/api/cases/${encodeURIComponent(config.id)}`, { method: 'PATCH', body: JSON.stringify({ status: config.action, decisionReason: reason }) });
    } else if (config.kind === 'watch') {
      await api(`/ops/api/watch/${encodeURIComponent(config.id)}`, { method: 'PATCH', body: JSON.stringify({ status: $('#decisionStatus').value, outcome: reason }) });
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
    notify(result.warning || 'Promotion verified, completed, and archived in Staff Journey.');
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
    state.activeTab = 'dashboard';
    renderAll();
    notify(state.previewTier ? `Previewing the portal as ${roleName(selected)}.` : 'Returned to your real Presidential access.');
  });
  $('#exitPreview')?.addEventListener('click', () => {
    state.previewTier = null;
    $('#previewTier').value = String(state.data.viewer.tier);
    state.activeTab = 'dashboard';
    renderAll();
    notify('Returned to your real Presidential access.');
  });
  document.addEventListener('click', async (event) => {
    const mutationTarget = event.target.closest('[data-promotion-action], [data-promotion-edit], [data-promotion-complete], [data-promotion-reassign], [data-case-action], [data-watch-update], [data-restricted-update]');
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
      openDecision({ kind: 'promotion', stage, action, id: promoAction.dataset.id, title: `${prettify(stage)}: ${prettify(action)} Promotion`, copy: action === 'approve' ? 'Record any approval note. A short note is still required for accountability.' : 'Explain why this submission is being returned or denied.' });
    }
    const promoEdit = event.target.closest('[data-promotion-edit]');
    if (promoEdit) editPromotion(promoEdit.dataset.promotionEdit);
    const promoComplete = event.target.closest('[data-promotion-complete]');
    if (promoComplete) completePromotion(promoComplete.dataset.promotionComplete);
    const promoReassign = event.target.closest('[data-promotion-reassign]');
    if (promoReassign) openReassign(promoReassign.dataset.promotionReassign);

    const caseAction = event.target.closest('[data-case-action]');
    if (caseAction) openDecision({ kind: 'case', id: caseAction.dataset.id, action: caseAction.dataset.caseAction, title: `${prettify(caseAction.dataset.caseAction)} Staff Action` });
    const watchUpdate = event.target.closest('[data-watch-update]');
    if (watchUpdate) {
      $('#decisionStatusWrap').hidden = false;
      $('#decisionStatus').innerHTML = ['active','improving','escalated','cleared','expired','archived'].map((x) => `<option value="${x}">${prettify(x)}</option>`).join('');
      openDecision({ kind: 'watch', id: watchUpdate.dataset.watchUpdate, title: 'Update Watch Record', copy: 'Choose the new status and record the outcome or review note.' });
    }
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
      notify('Promotion submission saved and routed to Corporate Board.');
    } catch (error) { notify(error.message, 'error'); }
  });
  $('#promotionReset')?.addEventListener('click', resetPromotionForm);

  $('#caseForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (blockPreviewSubmit(event)) return;
    try { await api('/ops/api/cases', { method: 'POST', body: JSON.stringify(formDataObject(event.currentTarget)) }); event.currentTarget.reset(); await refresh(); notify('Staff action saved.'); } catch (error) { notify(error.message, 'error'); }
  });
  $('#watchForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (blockPreviewSubmit(event)) return;
    try { await api('/ops/api/watch', { method: 'POST', body: JSON.stringify(formDataObject(event.currentTarget)) }); event.currentTarget.reset(); await refresh(); notify('Watch record created.'); } catch (error) { notify(error.message, 'error'); }
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
