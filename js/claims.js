// Claims: the claim form shown on a found item's page (was ClaimForm.jsx)
// and the claim-status lookup page (was ClaimStatus.jsx).
import { initPage, Alert, ClaimBadge, showFieldErrors, clearFieldErrors, withBusy } from './app.js';
import { createClaim, getClaimStatus } from './database.js';
import { ensureUser } from './firebase-auth.js';
import { getParam, html, render, validateClaim, formatDate, friendlyError } from './utils.js';

const field = (id, label, control, hint) => html`<div class="field"><label for="${id}">${label}<span class="req" aria-hidden="true"> *</span></label>${control}${hint ? html`<p id="${id}-hint" class="hint">${hint}</p>` : ''}</div>`;

/** Renders the claim form into `container` for a found, open item. */
export function mountClaimForm(container, item) {
  render(container, html`<form novalidate class="form" id="claim-form">
    <p class="muted">Describe something only the owner would know: marks, contents, stickers, or serial numbers. <strong>Your proof is private</strong>: it is never shown publicly and is seen only by the administrator.</p>
    <div id="claim-alert"></div>
    ${field('claimant_name', 'Your full name', html`<input id="claimant_name" name="claimant_name" required type="text" autocomplete="name" maxlength="100">`)}
    ${field('claimant_contact', 'Your email or phone number', html`<input id="claimant_contact" name="claimant_contact" required data-hint="claimant_contact-hint" aria-describedby="claimant_contact-hint" type="text" autocomplete="email" maxlength="120">`, 'Private. Only the administrator can see this.')}
    ${field('proof', 'Proof of ownership', html`<textarea id="proof" name="proof" required data-hint="proof-hint" aria-describedby="proof-hint" rows="5" maxlength="1500"></textarea>`, 'At least 20 characters. Do not include passwords or card numbers.')}
    <button type="submit" class="btn btn-primary">Submit claim request</button></form>`);

  const form = container.querySelector('form');
  const alertEl = form.querySelector('#claim-alert');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    render(alertEl, html``);
    clearFieldErrors(form);
    const { values, errors } = validateClaim(Object.fromEntries(new FormData(form)));
    if (Object.keys(errors).length) return showFieldErrors(form, errors);
    await withBusy(form.querySelector('button[type=submit]'), 'Submitting…', async () => {
      try {
        const user = await ensureUser();
        const { claimCode } = await createClaim(item, values, user);
        showDone(container, claimCode);
      } catch (err) {
        render(alertEl, Alert('error', '', friendlyError(err)));
      }
    });
  });
}

function showDone(container, code) {
  render(container, Alert('success', 'Claim submitted', html`
    <p>The administrator will review your proof. Nothing is handed over until your ownership is verified.</p>
    <p>Save your <strong>claim code</strong>. It is the only way to check your claim's status:</p>
    <p class="claim-code" aria-label="Claim code ${code}">${code}</p>
    <div class="btn-row"><button type="button" class="btn btn-secondary" id="copy-code">Copy code</button>
    <a class="btn btn-ghost" href="claim-status.html?code=${encodeURIComponent(code)}">Check status</a></div>`));
  const copy = container.querySelector('#copy-code');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(code); copy.textContent = 'Copied ✓'; } catch { /* the code is visible on screen */ }
  });
}

const MESSAGES = {
  pending: 'Your claim is waiting for review by the campus lost & found administrator.',
  approved: 'Your claim was approved. The administrator will contact you to arrange a safe handover; bring photo ID.',
  rejected: 'Your claim was not approved. If you believe this is a mistake, contact the lost & found office with more proof.',
};

/** Claim status page. */
export async function initClaimStatusPage() {
  await initPage('claim-status');
  const form = document.getElementById('status-form');
  const input = form.code;
  const btn = document.getElementById('status-btn');
  const out = document.getElementById('status-result');
  input.value = getParam('code');
  btn.disabled = !input.value.trim();
  input.addEventListener('input', () => { btn.disabled = !input.value.trim(); });

  async function lookup(code) {
    render(out, html``);
    await withBusy(btn, 'Checking…', async () => {
      try {
        const c = await getClaimStatus(code);
        if (!c) return render(out, Alert('error', '', "We couldn't find a claim with that code. Check it and try again."));
        render(out, html`<section class="card pad result" aria-live="polite">
          <div class="badge-row">${ClaimBadge(c.status)}</div>
          <h2 class="h3">Claim for <a href="item-details.html?id=${encodeURIComponent(c.itemId)}">${c.itemTitle}</a></h2>
          <p>${MESSAGES[c.status] || ''}</p>
          ${c.adminNote ? Alert('info', 'Note from the administrator', html`<span class="prewrap">${c.adminNote}</span>`) : ''}
          <p class="muted small">Submitted ${formatDate(c.createdAt)}${c.reviewedAt ? ` · Reviewed ${formatDate(c.reviewedAt)}` : ''}</p></section>`);
      } catch (err) {
        render(out, Alert('error', '', friendlyError(err)));
      }
    });
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); if (input.value.trim()) lookup(input.value); });
  if (input.value.trim()) lookup(input.value);
}
