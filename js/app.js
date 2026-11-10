// Shared UI: header/footer (was Layout.jsx), small components (was ui.jsx, ItemCard.jsx,
// MatchList.jsx) and page start-up. Every class name matches the original React app,
// so css/style.css (a copy of the original stylesheet) styles everything identically.
import { isConfigured } from './firebase-auth.js';
import { loadSiteSettings } from './database.js';
import { ADMIN_CONTACT, UNIVERSITY_NAME } from './config.js';
import { categoryIcon, formatDate, html, raw, render, STATUS_LABELS, esc } from './utils.js';

export const settings = { universityName: UNIVERSITY_NAME, adminContact: { ...ADMIN_CONTACT } };

const NAV = [
  ['home', 'index.html', 'Home'],
  ['browse', 'browse.html', 'Browse'],
  ['report', 'report.html', 'Report an item'],
  ['claim-status', 'claim-status.html', 'Claim status'],
  ['about', 'about.html', 'About & help'],
];

// ---------------------------------------------------------------- components
export const Spinner = (label = 'Loading…') => html`<div class="spinner-wrap" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><span>${label}</span></div>`;

/** kind: info | success | error | warning */
export const Alert = (kind, title, body) => html`<div class="alert alert-${kind}" role="${kind === 'error' ? 'alert' : 'status'}">${title ? html`<strong class="alert-title">${title}</strong>` : ''}<div>${body}</div></div>`;

export const ErrorState = (message, withRetry = true) => Alert('error', 'Something went wrong', html`${message || 'Please try again.'} ${withRetry ? html`<button type="button" class="link-btn" data-retry>Retry</button>` : ''}`);

export const TypeBadge = (type) => html`<span class="badge badge-${type}">${type === 'lost' ? 'Lost' : 'Found'}</span>`;
export const StatusBadge = (status) => html`<span class="badge status-${status}">${STATUS_LABELS[status] || status}</span>`;
export const ClaimBadge = (status) => html`<span class="badge claim-${status}">${{ pending: 'Pending', approved: 'Approved', rejected: 'Rejected' }[status] || status}</span>`;

export function AdminContactCard(contact = settings.adminContact, compact = false) {
  if (!contact) return html``;
  const tel = String(contact.phone || '').replace(/[^\d+]/g, '');
  return html`<div class="${compact ? 'contact-card compact' : 'contact-card'}">
    <p class="contact-name">${contact.name}</p>
    <dl class="facts facts-block">
      <div><dt>Email</dt><dd><a href="mailto:${contact.email}">${contact.email}</a></dd></div>
      <div><dt>Phone</dt><dd>${tel ? html`<a href="tel:${tel}">${contact.phone}</a>` : contact.phone}</dd></div>
      <div><dt>Office</dt><dd>${contact.office_location}</dd></div>
      <div><dt>Opening hours</dt><dd>${contact.office_hours}</dd></div>
    </dl></div>`;
}

export function ItemCard(item) {
  const img = item.imageUrl;
  return html`<article class="card item-card ${item.status !== 'open' ? 'is-done' : ''}">
    <a href="item-details.html?id=${encodeURIComponent(item.id)}" class="item-media" aria-hidden="true" tabindex="-1">${img ? html`<img src="${img}" alt="" loading="lazy">` : html`<span class="item-icon">${categoryIcon(item.category)}</span>`}</a>
    <div class="item-body">
      <div class="badge-row">${TypeBadge(item.type)}${StatusBadge(item.status)}</div>
      <h3 class="item-title"><a href="item-details.html?id=${encodeURIComponent(item.id)}">${item.title}</a></h3>
      <p class="item-meta"><span>${item.category}</span>${item.color ? html` · <span>${item.color}</span>` : ''} · <span>${item.location}</span></p>
      <p class="item-meta muted">${item.type === 'lost' ? 'Lost' : 'Found'} on ${formatDate(item.eventDate)}</p>
    </div></article>`;
}

const CONFIDENCE_LABEL = { strong: 'Strong match', likely: 'Likely match', possible: 'Possible match' };
const FACTOR_LABEL = { category: 'Category', title: 'Item name', description: 'Description', location: 'Location', date: 'Date' };

export function MatchList(matches) {
  if (!matches.length) return html`<p class="muted">No similar reports yet. New reports are checked automatically, so come back later or browse all items.</p>`;
  return html`<ul class="match-list">${matches.map(({ item, score, confidence, reasons }) => html`
    <li class="card match">
      <div class="match-top">
        <div class="match-media" aria-hidden="true">${item.imageUrl ? html`<img src="${item.imageUrl}" alt="" loading="lazy">` : html`<span>${categoryIcon(item.category)}</span>`}</div>
        <div class="match-info">
          <div class="badge-row">${TypeBadge(item.type)}<span class="badge conf-${confidence}">${CONFIDENCE_LABEL[confidence]}</span></div>
          <h4><a href="item-details.html?id=${encodeURIComponent(item.id)}">${item.title}</a></h4>
          <p class="item-meta">${item.category} · ${item.location} · ${formatDate(item.eventDate)}</p>
          <div class="score" role="img" aria-label="Match score ${score} out of 100"><div class="score-track"><div class="score-fill" style="width: ${Number(score)}%"></div></div><strong>${score}</strong><span class="muted">/100</span></div>
        </div>
      </div>
      <details class="why"><summary>Why this might match</summary><ul class="reasons">${reasons.map((r) => html`
        <li class="${r.matched ? 'ok' : 'no'}"><span class="reason-icon" aria-hidden="true">${r.matched ? '✓' : '–'}</span><span><strong>${FACTOR_LABEL[r.factor]}</strong> <span class="muted">(${r.points}/${r.max})</span><br>${r.detail}</span></li>`)}</ul></details>
    </li>`)}</ul>`;
}

export function Pagination(page, pages) {
  if (pages <= 1) return html``;
  return html`<nav class="pagination" aria-label="Pagination">
    <button type="button" class="btn btn-ghost" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>← Previous</button>
    <span aria-live="polite">Page ${page} of ${pages}</span>
    <button type="button" class="btn btn-ghost" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Next →</button></nav>`;
}

// -------------------------------------------------------------- form helpers
/** Shows per-field error messages under the matching inputs (same markup the React <Field> produced). */
export function showFieldErrors(form, errors) {
  clearFieldErrors(form);
  for (const [name, msg] of Object.entries(errors || {})) {
    const input = form.querySelector(`#${CSS.escape(name)}`);
    const field = input?.closest('.field');
    if (!input || !field) continue;
    field.classList.add('has-error');
    input.setAttribute('aria-invalid', 'true');
    const p = document.createElement('p');
    p.className = 'field-error';
    p.id = `${name}-err`;
    p.textContent = msg;
    field.appendChild(p);
    input.setAttribute('aria-describedby', [input.getAttribute('data-hint'), p.id].filter(Boolean).join(' '));
  }
}
export function clearFieldErrors(form) {
  form.querySelectorAll('.field.has-error').forEach((f) => f.classList.remove('has-error'));
  form.querySelectorAll('.field-error').forEach((p) => p.remove());
  form.querySelectorAll('[aria-invalid]').forEach((i) => i.removeAttribute('aria-invalid'));
}

export function fillSelect(select, options, firstLabel) {
  render(select, html`${firstLabel ? html`<option value="">${firstLabel}</option>` : ''}${options.map((o) => html`<option value="${o}">${o}</option>`)}`);
}

// ---------------------------------------------------------------- page start
function renderLayout(active) {
  const header = document.getElementById('site-header');
  if (header) {
    render(header, html`<div class="container header-row">
      <a href="index.html" class="brand" aria-label="FindIt Campus home">
        <span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 64 64" width="34" height="34"><rect width="64" height="64" rx="14" fill="#0f9d9a"/><circle cx="28" cy="28" r="12" fill="none" stroke="#fff" stroke-width="6"/><path d="M37 37l13 13" stroke="#fff" stroke-width="6" stroke-linecap="round"/></svg></span>
        <span class="brand-text"><strong>FindIt Campus</strong><small data-university>${settings.universityName}</small></span>
      </a>
      <button type="button" class="menu-toggle" aria-expanded="false" aria-controls="primary-nav"><span class="sr-only">Menu</span><span aria-hidden="true">☰</span></button>
      <nav id="primary-nav" class="nav" aria-label="Main">${NAV.map(([key, href, label]) => html`<a href="${href}" ${key === active ? raw('class="active" aria-current="page"') : ''}>${label}</a>`)}</nav>
    </div>`);
    const btn = header.querySelector('.menu-toggle');
    const nav = header.querySelector('#primary-nav');
    btn.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', String(open));
      btn.lastElementChild.textContent = open ? '✕' : '☰';
    });
  }
  const footer = document.getElementById('site-footer');
  if (footer) {
    render(footer, html`<div class="container footer-row">
      <div><strong>FindIt Campus</strong> · <span data-university>${settings.universityName}</span>
        <p class="muted small">A campus-only lost &amp; found service. Ownership is always verified before an item is handed over.</p></div>
      <div class="footer-links"><a href="about.html">Safe collection tips</a><a href="admin-login.html">Staff login</a></div></div>`);
  }
}

/** Call once at the top of every page. Draws the layout, loads site settings, warns if Firebase is not set up. */
export async function initPage(active, { loadSettings = true } = {}) {
  renderLayout(active);
  window.scrollTo(0, 0);
  const main = document.getElementById('main');
  if (!isConfigured && main) {
    const box = document.createElement('div');
    box.className = 'container';
    box.style.paddingTop = '16px';
    render(box, Alert('warning', 'Firebase is not configured yet', html`Open <code>js/firebase-config.js</code> and paste your Firebase web-app settings (see README, step 3). Until then no data can be loaded.`));
    main.prepend(box);
    return settings;
  }
  if (loadSettings) {
    Object.assign(settings, await loadSiteSettings());
    document.querySelectorAll('[data-university]').forEach((el) => { el.textContent = settings.universityName; });
  }
  return settings;
}

/** Lets a button disable itself while an async action runs (prevents duplicate submissions). */
export async function withBusy(button, busyLabel, fn) {
  if (button.disabled) return;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  try { return await fn(); } finally { button.disabled = false; button.textContent = label; }
}

export { esc };
