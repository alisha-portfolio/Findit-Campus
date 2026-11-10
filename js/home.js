// Home page (was Home.jsx): statistics + recently reported + admin contact card.
import { initPage, ItemCard, Spinner, ErrorState, AdminContactCard, settings } from './app.js';
import { listPublicItems, getStats } from './database.js';
import { html, render, friendlyError } from './utils.js';

await initPage('home');

const Stat = (value, label, tone) => html`<div class="stat stat-${tone}"><strong>${value}</strong><span>${label}</span></div>`;

async function loadStats() {
  const el = document.getElementById('stats');
  render(el, Spinner('Loading statistics…'));
  try {
    const s = await getStats();
    render(el, html`${Stat(s.lost, 'Items still lost', 'lost')}${Stat(s.found, 'Found items waiting', 'found')}${Stat(s.returned, 'Returned to owners', 'returned')}`);
  } catch {
    render(el, html`<p class="muted">Statistics are unavailable right now.</p>`);
  }
}

async function loadRecent() {
  const el = document.getElementById('recent');
  render(el, Spinner());
  try {
    const items = await listPublicItems(6);
    render(el, items.length ? html`<div class="grid">${items.map(ItemCard)}</div>` : html`<p class="muted">No reports yet. Be the first to post one.</p>`);
  } catch (err) {
    render(el, ErrorState(friendlyError(err)));
    el.querySelector('[data-retry]')?.addEventListener('click', loadRecent);
  }
}

render(document.getElementById('admin-contact'), AdminContactCard(settings.adminContact));
loadStats();
loadRecent();
