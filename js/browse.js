// Browse page (was Browse.jsx). Firestore cannot do "contains" searches or range+equality
// mixes cheaply, so the newest reports are loaded once and filtered here in the browser.
import { initPage, ItemCard, Spinner, ErrorState, Pagination, fillSelect } from './app.js';
import { listPublicItems } from './database.js';
import { CATEGORIES, LOCATIONS, PAGE_SIZE } from './config.js';
import { html, render, debounce, friendlyError } from './utils.js';

await initPage('browse');

const FILTERS = ['type', 'category', 'location', 'status', 'date_from', 'date_to'];
const form = document.getElementById('filters');
const resultsEl = document.getElementById('results');
const countEl = document.getElementById('count');
const clearBtn = document.getElementById('clear-filters');

fillSelect(form.category, CATEGORIES, 'All categories');
fillSelect(form.location, LOCATIONS.map((l) => l.name), 'All locations');

let all = [];
let page = 1;

// Restore filters from the URL so a filtered view can be bookmarked / shared.
const params = new URLSearchParams(location.search);
[...FILTERS, 'q'].forEach((k) => { if (params.get(k)) form.elements[k].value = params.get(k); });
page = Math.max(1, Number(params.get('page')) || 1);

const read = () => Object.fromEntries([...FILTERS, 'q'].map((k) => [k, form.elements[k].value.trim()]));

function syncUrl(f) {
  const sp = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => v && sp.set(k, v));
  if (page > 1) sp.set('page', String(page));
  history.replaceState(null, '', sp.toString() ? `?${sp}` : location.pathname);
}

function apply(f) {
  const q = f.q.toLowerCase();
  return all.filter((it) =>
    (!f.type || it.type === f.type) && (!f.category || it.category === f.category) &&
    (!f.location || it.location === f.location) && (!f.status || it.status === f.status) &&
    (!f.date_from || it.eventDate >= f.date_from) && (!f.date_to || it.eventDate <= f.date_to) &&
    (!q || `${it.title} ${it.description} ${it.color || ''}`.toLowerCase().includes(q)));
}

function draw() {
  const f = read();
  const list = apply(f);
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  page = Math.min(page, pages);
  syncUrl(f);
  clearBtn.hidden = !Object.values(f).some(Boolean);
  countEl.textContent = `${list.length} item${list.length === 1 ? '' : 's'} found`;
  if (!list.length) {
    render(resultsEl, html`<div class="empty card"><h2>No items match your search</h2><p>Try fewer filters, or <a href="report.html">post a report</a> so others can find you.</p></div>`);
    return;
  }
  const slice = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  render(resultsEl, html`<div class="grid">${slice.map(ItemCard)}</div>${Pagination(page, pages)}`);
}

async function load() {
  render(resultsEl, Spinner());
  countEl.textContent = '';
  try {
    all = await listPublicItems();
    draw();
  } catch (err) {
    render(resultsEl, ErrorState(friendlyError(err)));
    resultsEl.querySelector('[data-retry]')?.addEventListener('click', load);
  }
}

const redraw = () => { page = 1; if (all.length || !resultsEl.querySelector('.spinner')) draw(); };
const debounced = debounce(redraw, 250);
form.addEventListener('submit', (e) => e.preventDefault());
form.addEventListener('input', (e) => (e.target.id === 'q' ? debounced() : redraw()));
form.addEventListener('change', (e) => { if (e.target.id !== 'q') redraw(); });
clearBtn.addEventListener('click', () => { form.reset(); page = 1; draw(); });
resultsEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-page]');
  if (b && !b.disabled) { page = Number(b.dataset.page); draw(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
});

load();
