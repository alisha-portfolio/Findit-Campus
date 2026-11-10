// Item details page (was ItemDetail.jsx).
import { initPage, Alert, ErrorState, Spinner, TypeBadge, StatusBadge, AdminContactCard, MatchList, settings } from './app.js';
import { getPublicItem, getMatches } from './database.js';
import { mountClaimForm } from './claims.js';
import { categoryIcon, formatDate, getParam, html, render, friendlyError } from './utils.js';

await initPage('browse');
const root = document.getElementById('item-root');
const id = getParam('id');

async function load() {
  render(root, Spinner('Loading item…'));
  let it;
  try {
    it = id ? await getPublicItem(id) : null;
  } catch (err) {
    render(root, ErrorState(friendlyError(err)));
    root.querySelector('[data-retry]')?.addEventListener('click', load);
    return;
  }
  if (!it) {
    render(root, Alert('warning', 'Item not found', html`This report doesn't exist or has been removed. <a href="browse.html">Browse all items</a>.`));
    return;
  }
  document.title = `${it.title} · FindIt Campus`;
  const claimable = it.type === 'found' && it.status === 'open';
  const justPosted = getParam('posted') === '1';

  render(root, html`
    <p class="crumbs"><a href="browse.html">← Back to browse</a></p>
    ${justPosted ? Alert('success', 'Your report has been submitted', html`<p>${it.type === 'found'
      ? 'Thank you! Please hand the item to the Lost & Found administrator so it can be returned to its owner.'
      : 'The administrator will compare your report with found items and contact you if something matches. You can also visit or call the office.'}</p>${AdminContactCard(settings.adminContact, true)}`) : ''}
    <div class="detail-grid">
      <article class="card detail">
        <div class="detail-media">${it.imageUrl ? html`<img src="${it.imageUrl}" alt="Photo of ${it.title}">` : html`<span class="item-icon big" aria-hidden="true">${categoryIcon(it.category)}</span>`}</div>
        <div class="detail-body">
          <div class="badge-row">${TypeBadge(it.type)}${StatusBadge(it.status)}</div>
          <h1>${it.title}</h1>
          <dl class="facts">
            <div><dt>Category</dt><dd>${it.category}</dd></div>
            ${it.color ? html`<div><dt>Colour</dt><dd>${it.color}</dd></div>` : ''}
            <div><dt>${it.type === 'lost' ? 'Lost at' : 'Found at'}</dt><dd>${it.location}</dd></div>
            <div><dt>${it.type === 'lost' ? 'Date lost' : 'Date found'}</dt><dd>${formatDate(it.eventDate)}</dd></div>
            <div><dt>Reported</dt><dd>${formatDate(it.createdAt)}</dd></div>
          </dl>
          <h2 class="h3">Description</h2>
          <p class="prewrap">${it.description}</p>
          <p class="muted small">The name, email and phone of the person who posted this are private. Only the administrator can see them and connect owner and finder.</p>
        </div>
      </article>
      <aside class="side">
        ${it.status !== 'open' ? Alert('info', it.status === 'returned' ? 'Returned to its owner' : 'Report closed', 'This report is no longer active.') : ''}
        ${claimable ? html`<section class="card pad" aria-labelledby="claim-h"><h2 id="claim-h" class="h3">Is this yours?</h2>
          <div id="claim-box"><p>Submit a claim with private proof of ownership. An administrator reviews every claim before anything is handed over.</p>
          <button type="button" class="btn btn-primary" id="show-claim">This is mine: claim it</button></div></section>` : ''}
        ${it.type === 'lost' && it.status === 'open' ? html`<section class="card pad"><h2 class="h3">Did you find this?</h2>
          <p>Post a found-item report so the owner can discover it and submit a claim.</p>
          <a href="report.html?type=found" class="btn btn-accent">I found it</a></section>` : ''}
      </aside>
    </div>
    <section class="section-tight" aria-labelledby="match-h">
      <h2 id="match-h">Suggested matches</h2>
      <p class="muted">Suggestions are based on category, name, description, location and date. <strong>A high score is a hint, not proof of ownership.</strong> ${it.type === 'lost' ? 'Open a found item to claim it.' : 'These are people who reported something similar.'}</p>
      <div id="matches">${Spinner('Looking for matches…')}</div>
    </section>`);

  document.getElementById('show-claim')?.addEventListener('click', () => mountClaimForm(document.getElementById('claim-box'), it));
  loadMatches(it);
}

async function loadMatches(it) {
  const el = document.getElementById('matches');
  try {
    render(el, MatchList(await getMatches(it)));
  } catch (err) {
    render(el, ErrorState(friendlyError(err)));
    el.querySelector('[data-retry]')?.addEventListener('click', () => { render(el, Spinner('Looking for matches…')); loadMatches(it); });
  }
}

load();
