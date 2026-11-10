// Administrator login + dashboard (was AdminLogin.jsx and AdminDashboard.jsx).
// SECURITY: this file only decides what to SHOW. Every read and write is enforced by
// firebase/firestore.rules, which check that the signed-in user has an `admins/{uid}` document.
import { initPage, Alert, ClaimBadge, ErrorState, Pagination, Spinner, StatusBadge, TypeBadge, withBusy } from './app.js';
import { authErrorMessage, signInAdmin, signOutUser, waitForAuth } from './firebase-auth.js';
import { adminLinkItems, adminLoadAll, adminMatches, adminReviewClaim, adminUnlinkItem, adminUpdateItem, isAdminUser } from './database.js';
import { debounce, formatDate, friendlyError, html, raw, render, shortId } from './utils.js';

// ------------------------------------------------------------------- login
export async function initAdminLogin() {
  await initPage('', { loadSettings: false });
  const user = await waitForAuth();
  try {
    if (user && !user.isAnonymous && (await isAdminUser(user.uid))) return void location.replace('admin-dashboard.html');
  } catch { /* show the login form; the real reason is shown after sign-in */ }

  const form = document.getElementById('login-form');
  const btn = document.getElementById('login-btn');
  const alertEl = document.getElementById('login-alert');
  const sync = () => { btn.disabled = !form.email.value || !form.password.value; };
  form.addEventListener('input', sync);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    render(alertEl, html``);
    await withBusy(btn, 'Signing in…', async () => {
      try {
        const u = await signInAdmin(form.email.value.trim(), form.password.value);
        if (!(await isAdminUser(u.uid))) {
          await signOutUser();
          throw Object.assign(new Error(`Sign-in worked, but this account is not an administrator. In Firestore create the collection "admins" with a document whose ID is exactly this UID: ${u.uid} (field: email).`), { code: 'app/not-admin' });
        }
        location.replace('admin-dashboard.html');
      } catch (err) {
        let msg;
        if (err.code === 'app/not-admin') msg = err.message;
        else if (String(err.code || '').startsWith('auth/')) msg = authErrorMessage(err);
        else if (err.code === 'permission-denied') msg = 'Sign-in worked, but Firestore blocked the administrator check. Publish firebase/firestore.rules in Firebase -> Firestore Database -> Rules (README step 4).';
        else msg = friendlyError(err);
        render(alertEl, Alert('error', '', msg));
      }
    });
  });
}

// --------------------------------------------------------------- dashboard
const TABS = [['overview', 'Overview'], ['claims', 'Claims'], ['reports', 'Reports']];
const state = { user: null, tab: 'claims', data: { items: [], claims: [] }, notice: '', matchFor: null, reportPage: 1, busy: false };
const filters = { claims: { status: 'pending', q: '' }, reports: { q: '', type: '', status: '', visibility: '' } };
let root;

export async function initDashboard() {
  await initPage('', { loadSettings: false });
  root = document.getElementById('admin-root');
  render(root, Spinner());
  const user = await waitForAuth();
  if (!user || user.isAnonymous || !(await isAdminUser(user.uid))) {
    if (user) await signOutUser();
    return void location.replace('admin-login.html');
  }
  state.user = user;
  await reload();
  draw();
}

async function reload() {
  try {
    state.data = await adminLoadAll();
    state.error = '';
  } catch (err) {
    state.error = friendlyError(err);
    if (err.code === 'permission-denied') { await signOutUser(); location.replace('admin-login.html'); }
  }
}

/** Runs a write, reloads data, shows a notice. Session/permission errors send the admin back to login. */
async function act(fn, notice, errorTarget) {
  if (state.busy) return;
  state.busy = true;
  try {
    await fn();
    state.notice = notice;
    await reload();
    draw();
  } catch (err) {
    if (err.code === 'permission-denied') { await signOutUser(); return void location.replace('admin-login.html'); }
    if (errorTarget) render(errorTarget, Alert('error', '', friendlyError(err)));
    else window.alert(friendlyError(err));
  } finally {
    state.busy = false;
  }
}

function draw() {
  render(root, html`
    <div class="admin-head">
      <div><h1>Admin dashboard</h1><p class="muted small">Signed in as ${state.user.email}</p></div>
      <button type="button" class="btn btn-ghost" id="logout">Log out</button>
    </div>
    <div role="tablist" aria-label="Admin sections" class="tabs">
      ${TABS.map(([id, label]) => html`<button role="tab" type="button" id="tab-${id}" aria-selected="${String(state.tab === id)}" aria-controls="panel-${id}" class="${state.tab === id ? 'tab active' : 'tab'}" data-tab="${id}">${label}</button>`)}
    </div>
    <div aria-live="polite" class="notice-slot">${state.notice ? Alert('success', '', state.notice) : ''}</div>
    <div role="tabpanel" id="panel-${state.tab}" aria-labelledby="tab-${state.tab}">${state.error ? ErrorState(state.error) : html`<div id="panel"></div>`}</div>`);

  root.querySelector('#logout').addEventListener('click', async () => { await signOutUser(); location.replace('admin-login.html'); });
  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; state.notice = ''; state.matchFor = null; draw(); }));
  root.querySelector('[data-retry]')?.addEventListener('click', async () => { await reload(); draw(); });
  if (state.error) return;
  ({ overview: drawOverview, claims: drawClaims, reports: drawReports })[state.tab](root.querySelector('#panel'));
}

// ---------------------------------------------------------------- overview
function drawOverview(el) {
  const { items, claims } = state.data;
  const n = (fn) => items.filter(fn).length;
  const cl = (s) => claims.filter((c) => c.status === s).length;
  const cards = [
    ['Pending claims', cl('pending'), 'warn'], ['Open lost reports', n((i) => i.type === 'lost' && i.status === 'open'), 'lost'],
    ['Open found reports', n((i) => i.type === 'found' && i.status === 'open'), 'found'], ['Returned to owners', n((i) => i.status === 'returned'), 'returned'],
    ['Closed reports', n((i) => i.status === 'closed'), ''], ['Hidden reports', n((i) => i.visibility === 'hidden'), ''],
    ['Approved claims', cl('approved'), ''], ['Rejected claims', cl('rejected'), ''], ['Total reports', items.length, ''],
  ];
  render(el, html`<div class="admin-stats">${cards.map(([label, value, tone]) => html`<div class="stat stat-${tone || 'plain'}"><strong>${value}</strong><span>${label}</span></div>`)}</div>`);
}

// ------------------------------------------------------------------ claims
function drawClaims(el) {
  const f = filters.claims;
  render(el, html`<section aria-labelledby="claims-h"><h2 id="claims-h" class="sr-only">Claims</h2>
    <div class="toolbar card">
      <div class="field"><label for="c-status">Status</label><select id="c-status">
        ${[['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['', 'All']].map(([v, t]) => html`<option value="${v}" ${f.status === v ? raw('selected') : ''}>${t}</option>`)}</select></div>
      <div class="field field-wide"><label for="c-q">Search (claimant, contact or item)</label><input id="c-q" type="search" maxlength="100" value="${f.q}"></div>
    </div><div id="claims-list"></div></section>`);
  el.querySelector('#c-status').addEventListener('change', (e) => { f.status = e.target.value; drawClaimList(el); });
  el.querySelector('#c-q').addEventListener('input', debounce((e) => { f.q = e.target.value; drawClaimList(el); }, 250));
  drawClaimList(el);
}

function drawClaimList(el) {
  const f = filters.claims;
  const q = f.q.trim().toLowerCase();
  const list = state.data.claims
    .filter((c) => (!f.status || c.status === f.status) && (!q || `${c.claimantName} ${c.claimantContact} ${c.itemTitle}`.toLowerCase().includes(q)))
    .sort((a, b) => (b.status === 'pending') - (a.status === 'pending'));
  const box = el.querySelector('#claims-list');
  if (!list.length) return render(box, html`<div class="empty card"><p>No claims match these filters.</p></div>`);
  render(box, html`<ul class="claims">${list.map((c) => html`
    <li class="card claim" data-claim="${c.id}">
      <div class="claim-head">
        <div><div class="badge-row">${ClaimBadge(c.status)}${StatusBadge(c.itemStatus)}</div>
          <h3><a href="item-details.html?id=${encodeURIComponent(c.itemId)}">${c.itemTitle}</a></h3></div>
        <span class="muted small">Submitted ${formatDate(c.createdAt)}</span>
      </div>
      <div class="claim-cols">
        <div><h4>Claimant</h4><p>${c.claimantName}<br><span class="muted">${c.claimantContact}</span></p>
          <h4>Proof of ownership <span class="badge badge-private">Private</span></h4><p class="prewrap proof">${c.proof}</p></div>
        <div><h4>Finder (for handover)</h4><p>${c.finderName}<br><span class="muted">${c.finderContact}</span><br><span class="muted">${c.finderPhone}</span></p>
          ${c.adminNote ? html`<h4>Note sent to claimant</h4><p class="prewrap">${c.adminNote}</p>` : ''}
          ${c.reviewedAt ? html`<p class="muted small">Reviewed ${formatDate(c.reviewedAt)}</p>` : ''}</div>
      </div>
      <div class="claim-error"></div>
      ${c.status === 'pending' ? html`<div class="claim-actions">
        <label for="note-${c.id}">Note to claimant (optional, shown on their status page)</label>
        <textarea id="note-${c.id}" rows="2" maxlength="500" placeholder="e.g. Please bring your student ID to the lost &amp; found office."></textarea>
        <div class="btn-row"><button type="button" class="btn btn-primary" data-decision="approved">Approve</button><button type="button" class="btn btn-danger" data-decision="rejected">Reject</button></div></div>` : ''}
      ${c.status === 'approved' && c.itemStatus === 'open' ? html`<div class="claim-actions">
        <p class="muted small">After the item has physically been handed over, mark it returned.</p>
        <button type="button" class="btn btn-secondary" data-returned="${c.itemId}">Mark item as returned</button></div>` : ''}
    </li>`)}</ul>`);

  box.querySelectorAll('[data-decision]').forEach((b) => b.addEventListener('click', () => {
    const li = b.closest('[data-claim]');
    const claim = state.data.claims.find((c) => c.id === li.dataset.claim);
    const decision = b.dataset.decision;
    const text = decision === 'approved' ? "Approve this claim? Only do so after comparing the proof with the item and the finder's details." : 'Reject this claim?';
    if (!window.confirm(text)) return;
    const note = li.querySelector('textarea').value.trim().slice(0, 500);
    act(() => adminReviewClaim(claim, decision, note, state.user.uid, state.data.claims, state.data.items), `Claim ${shortId(claim.id)} ${decision}.`, li.querySelector('.claim-error'));
  }));
  box.querySelectorAll('[data-returned]').forEach((b) => b.addEventListener('click', () => {
    const item = state.data.items.find((i) => i.id === b.dataset.returned);
    act(() => adminUpdateItem(item, { status: 'returned' }, state.data.items), `"${item.title}" marked as returned.`, b.closest('li').querySelector('.claim-error'));
  }));
}

// ----------------------------------------------------------------- reports
function drawReports(el) {
  const f = filters.reports;
  const opt = (cur, pairs) => pairs.map(([v, t]) => html`<option value="${v}" ${cur === v ? raw('selected') : ''}>${t}</option>`);
  render(el, html`<section aria-labelledby="reports-h"><h2 id="reports-h" class="sr-only">Reports</h2>
    <div class="toolbar card">
      <div class="field field-wide"><label for="r-q">Search (title, colour, description, name, email, phone)</label><input id="r-q" type="search" maxlength="100" value="${f.q}"></div>
      <div class="field"><label for="r-type">Type</label><select id="r-type">${opt(f.type, [['', 'All'], ['lost', 'Lost'], ['found', 'Found']])}</select></div>
      <div class="field"><label for="r-status">Status</label><select id="r-status">${opt(f.status, [['', 'All'], ['open', 'Open'], ['returned', 'Returned'], ['closed', 'Closed']])}</select></div>
      <div class="field"><label for="r-vis">Visibility</label><select id="r-vis">${opt(f.visibility, [['', 'All'], ['visible', 'Visible'], ['hidden', 'Hidden']])}</select></div>
    </div><div id="reports-list"></div></section>`);
  const set = (k) => (e) => { f[k] = e.target.value; state.reportPage = 1; drawReportList(el); };
  el.querySelector('#r-q').addEventListener('input', debounce(set('q'), 250));
  el.querySelector('#r-type').addEventListener('change', set('type'));
  el.querySelector('#r-status').addEventListener('change', set('status'));
  el.querySelector('#r-vis').addEventListener('change', set('visibility'));
  drawReportList(el);
}

const REPORT_PAGE = 20;
function drawReportList(el) {
  const f = filters.reports;
  const q = f.q.trim().toLowerCase();
  const list = state.data.items.filter((i) =>
    (!f.type || i.type === f.type) && (!f.status || i.status === f.status) && (!f.visibility || i.visibility === f.visibility) &&
    (!q || `${i.title} ${i.color} ${i.description} ${i.contactName} ${i.contact} ${i.contactPhone}`.toLowerCase().includes(q)));
  const pages = Math.max(1, Math.ceil(list.length / REPORT_PAGE));
  state.reportPage = Math.min(state.reportPage, pages);
  const slice = list.slice((state.reportPage - 1) * REPORT_PAGE, state.reportPage * REPORT_PAGE);
  const byId = new Map(state.data.items.map((i) => [i.id, i]));
  const btn = (a, cls, label) => html`<button type="button" class="btn btn-small ${cls}" data-act="${a}">${label}</button>`;
  const box = el.querySelector('#reports-list');
  render(box, html`<p class="muted" aria-live="polite">${list.length} report${list.length === 1 ? '' : 's'}</p>
    <div class="table-wrap"><table class="table"><thead><tr><th>Report</th><th>Details</th><th>Private contact</th><th>State</th><th>Actions</th></tr></thead><tbody>
    ${slice.map((it) => html`
      <tr class="${it.visibility === 'hidden' ? 'row-hidden' : ''}" data-item="${it.id}">
        <td data-label="Report">${TypeBadge(it.type)}<div><a href="item-details.html?id=${encodeURIComponent(it.id)}"><strong>${it.title}</strong></a></div><span class="muted small">#${shortId(it.id)}</span></td>
        <td data-label="Details">${it.category}${it.color ? ` · ${it.color}` : ''}<br>${it.location}<br><span class="muted">${formatDate(it.eventDate)}</span></td>
        <td data-label="Contact">${it.contactName}<br><span class="muted">${it.contact}</span><br><span class="muted">${it.contactPhone}</span></td>
        <td data-label="State">${StatusBadge(it.status)} ${it.visibility === 'hidden' ? html`<span class="badge badge-hidden">Hidden</span>` : ''}
          ${it.linkedItemId ? html`<div class="small linked-text">Linked with #${shortId(it.linkedItemId)}: ${byId.get(it.linkedItemId)?.title || ''}</div>` : ''}
          ${pending(it) > 0 ? html`<div class="small warn-text">${pending(it)} pending claim${pending(it) === 1 ? '' : 's'}</div>` : ''}</td>
        <td data-label="Actions"><div class="btn-col">
          ${it.status === 'open' ? btn('matches', 'btn-primary', state.matchFor === it.id ? 'Hide matches' : 'Find matches') : ''}
          ${it.status !== 'returned' ? btn('returned', 'btn-secondary', 'Mark returned') : ''}
          ${it.status === 'open' ? btn('closed', 'btn-ghost', 'Close') : ''}
          ${it.status !== 'open' ? btn('open', 'btn-ghost', 'Reopen') : ''}
          ${it.visibility === 'visible' ? btn('hide', 'btn-danger', 'Hide') : btn('unhide', 'btn-ghost', 'Unhide')}
        </div></td>
      </tr>
      ${state.matchFor === it.id ? html`<tr class="match-row"><td colspan="5" id="match-slot"></td></tr>` : ''}`)}
    ${slice.length ? '' : html`<tr><td colspan="5" class="center muted">No reports match these filters.</td></tr>`}
    </tbody></table></div>${Pagination(state.reportPage, pages)}`);

  box.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const it = byId.get(b.closest('tr').dataset.item);
    const a = b.dataset.act;
    const patch = { returned: { status: 'returned' }, closed: { status: 'closed' }, open: { status: 'open' }, hide: { visibility: 'hidden' }, unhide: { visibility: 'visible' } }[a];
    const msg = { returned: `"${it.title}" marked as returned.`, closed: `"${it.title}" closed.`, open: `"${it.title}" reopened.`, hide: `"${it.title}" hidden from the public site.`, unhide: `"${it.title}" is visible again.` }[a];
    if (a === 'matches') { state.matchFor = state.matchFor === it.id ? null : it.id; return drawReportList(el); }
    act(() => adminUpdateItem(it, patch, state.data.items), msg);
  }));
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (b && !b.disabled) { state.reportPage = Number(b.dataset.page); state.matchFor = null; drawReportList(el); }
  });
  if (state.matchFor && byId.has(state.matchFor)) drawMatchPanel(box.querySelector('#match-slot'), byId.get(state.matchFor));
}
const pending = (it) => state.data.claims.filter((c) => c.itemId === it.id && c.status === 'pending').length;

// ------------------------------------------------------------ match + link
/** Suggested matches for one report WITH both parties' private details, and a button to link the pair. */
function drawMatchPanel(slot, item) {
  if (!slot) return;
  const matches = adminMatches(item, state.data.items);
  const byId = new Map(state.data.items.map((i) => [i.id, i]));
  const person = (it) => html`<strong>${it.contactName}</strong><br><a href="mailto:${it.contact}">${it.contact}</a><br><span>${it.contactPhone}</span>`;
  render(slot, html`<div class="match-panel">
    <h4>Possible matches for #${shortId(item.id)} ${item.title}</h4>
    <p class="muted small">Owner/finder details below are private. Phone or email both people yourself, check that the details really match, then link the pair. Linking does not hand anything over.</p>
    ${item.linkedItemId ? html`<p class="linked-text">Currently linked with #${shortId(item.linkedItemId)}: ${byId.get(item.linkedItemId)?.title || ''}. <button type="button" class="btn btn-small btn-ghost" data-unlink>Remove link</button></p>` : ''}
    <div class="panel-error"></div>
    ${matches.length === 0 ? html`<p class="muted">No matching ${item.type === 'lost' ? 'found' : 'lost'} reports yet.</p>` : ''}
    ${matches.map((m) => html`<div class="match-card">
      <div class="match-score" aria-label="Match score ${m.score} out of 100"><strong>${m.score}</strong><span>${m.confidence}</span></div>
      <div class="match-info"><p>${TypeBadge(m.item.type)} <strong>#${shortId(m.item.id)} ${m.item.title}</strong></p>
        <p class="muted small">${m.item.category}${m.item.color ? ` · ${m.item.color}` : ''} · ${m.item.location} · ${formatDate(m.item.eventDate)}</p>
        <p class="small">${m.reasons.filter((r) => r.matched).map((r) => r.detail).join(' ') || 'Weak match.'}</p></div>
      <div class="match-people small"><div><span class="muted">This report</span><br>${person(item)}</div><div><span class="muted">Other report</span><br>${person(m.item)}</div></div>
      <div class="match-action">${item.linkedItemId === m.item.id ? html`<span class="badge badge-private">Linked</span>` : html`<button type="button" class="btn btn-small btn-primary" data-link="${m.item.id}">Link these two</button>`}</div>
    </div>`)}</div>`);
  const err = slot.querySelector('.panel-error');
  slot.querySelector('[data-unlink]')?.addEventListener('click', () => act(() => adminUnlinkItem(item, state.data.items), `Link removed from #${shortId(item.id)}.`, err));
  slot.querySelectorAll('[data-link]').forEach((b) => b.addEventListener('click', () => {
    const other = byId.get(b.dataset.link);
    act(() => adminLinkItems(item, other, state.data.items), `#${shortId(item.id)} linked with #${shortId(other.id)}.`, err);
  }));
}
