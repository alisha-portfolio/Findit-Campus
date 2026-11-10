// Browser smoke test. Usage:  node tests/e2e/run.mjs        (needs Playwright; serves the site itself)
// Runs every major user and admin flow against the in-memory fake Firebase in fake-sdk.mjs.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES } from './fake-sdk.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHOTS = process.env.SHOTS_DIR || '';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${server.address().port}`;

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const errors = [];
await ctx.route('https://www.gstatic.com/firebasejs/**', (route) => {
  const name = route.request().url().split('/').pop();
  route.fulfill({ contentType: 'text/javascript', body: SOURCES[name] || 'export {}' });
});
await ctx.route('**/js/firebase-config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: "export const firebaseConfig={apiKey:'k',authDomain:'a',projectId:'p',storageBucket:'b',messagingSenderId:'1',appId:'a'};" }));
await ctx.addInitScript(() => {
  if (!localStorage.getItem('__fakefb')) localStorage.setItem('__fakefb', JSON.stringify({ docs: { 'admins/adminuid': { email: 'admin@test.com' }, 'settings/site': { adminContact: { name: 'Test Admin', email: 'office@muet.test', phone: '0300 1112223', office_location: 'Admin Block, Room 4', office_hours: '9-5' } } }, seq: 0, user: null, files: {} }));
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('dialog', (d) => d.accept());
const go = async (u) => { await page.goto(`${BASE}/${u}`); await page.waitForLoadState('networkidle'); };
const shot = async (n) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true }); };
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);

async function fillReport(v, photo) {
  for (const [k, val] of Object.entries(v)) {
    const el = page.locator(`#${k}`);
    if (['category', 'location'].includes(k)) await el.selectOption(val);
    else await el.fill(val);
  }
  if (photo) await page.locator('#image').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: png });
}
const rowOf = (title) => page.locator('tr[data-item]', { has: page.locator('td[data-label="Report"] strong', { hasText: new RegExp(`^${title}$`) }) });
const today = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- empty states
await go('index.html');
ok(await page.locator('#recent').innerText().then((t) => /No reports yet/.test(t)), 'home: empty state when no reports');
ok((await page.locator('#stats .stat').count()) === 3, 'home: three stat tiles');
ok(await page.locator('#admin-contact').innerText().then((t) => t.includes('Test Admin') && t.includes('Admin Block, Room 4')), 'home: admin contact card comes from Firestore settings/site');
await go('browse.html');
ok(await page.locator('#results').innerText().then((t) => /No items match/.test(t)), 'browse: empty state');

// ------------------------------------------------------- report validation
await go('report.html?type=found');
ok(await page.locator('#report-title').innerText() === 'Report a found item', 'report: ?type=found switches the form');
await page.locator('#submit-btn').click();
ok((await page.locator('.field-error').count()) >= 8, 'report: empty submit shows field errors');
ok(await page.locator('#form-alert .alert-error').count() === 1, 'report: error banner shown');
await page.locator('#image').setInputFiles({ name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('this is not an image at all') });
ok(await page.locator('#image').locator('xpath=..').innerText().then((t) => /JPEG, PNG or WebP/.test(t) && t.length > 0), 'report: fake image rejected by magic-byte check');

// -------------------------------------------------- submit found + lost reports
await fillReport({ title: 'Black wallet found on study desk', color: 'Black', category: 'Wallet', description: 'Black leather wallet with a silver coin zipper, found on a desk.', location: 'Library', event_date: today, contact_name: 'Finder One', contact: 'finder@gmail.com', contact_phone: '0300 1234567' }, true);
await page.locator('#submit-btn').click();
await page.waitForURL(/item-details\.html\?id=.*posted=1/);
await page.waitForSelector('h1');
const foundUrl = page.url();
ok(await page.locator('h1').innerText() === 'Black wallet found on study desk', 'report: found report submitted, redirected to its page');
ok(await page.locator('.alert-success').first().innerText().then((t) => /hand the item/.test(t)), 'item: "just posted" notice for found item');
ok(await page.locator('.detail-media img').count() === 1, 'item: uploaded photo displayed');
const body1 = await page.content();
ok(!body1.includes('finder@gmail.com') && !body1.includes('0300 1234567'), 'item: reporter email/phone NOT in public page');
ok(await page.locator('#show-claim').count() === 1, 'item: found + open shows claim button');

await go('report.html?type=lost');
await fillReport({ title: 'Black leather wallet', color: 'Black', category: 'Wallet', description: 'Black bi-fold leather wallet with a small silver zipper pocket.', location: 'Library', event_date: today, contact_name: 'Owner One', contact: 'owner@gmail.com', contact_phone: '0311 7654321' });
await page.locator('#submit-btn').click();
await page.waitForURL(/posted=1/);
await page.waitForSelector('.match');
ok(await page.locator('.match').count() === 1, 'item: lost report shows the found wallet as suggested match');
ok(await page.locator('.match .badge[class*="conf-"]').innerText().then((t) => /match/i.test(t)), 'item: match has confidence badge');
ok(await page.locator('.match .score strong').innerText().then((t) => Number(t) >= 55), 'item: match score displayed');
ok(await page.locator('#show-claim').count() === 0 && await page.locator('text=I found it').count() === 1, 'item: lost report shows "I found it", no claim');
await shot('item-lost-desktop');

// --------------------------------------------------------------------- browse
await go('browse.html');
ok(await page.locator('.item-card').count() === 2, 'browse: both reports listed');
await page.locator('#type').selectOption('found');
ok(await page.locator('.item-card').count() === 1 && /1 item found/.test(await page.locator('#count').innerText()), 'browse: type filter');
await page.locator('#type').selectOption('');
await page.locator('#q').fill('bi-fold');
await page.waitForTimeout(400);
ok(await page.locator('.item-card').count() === 1, 'browse: text search (description)');
await page.locator('#q').fill('zzzz');
await page.waitForTimeout(400);
ok(await page.locator('.empty').count() === 1, 'browse: no-result empty state');
await page.locator('#clear-filters').click();
ok(await page.locator('.item-card').count() === 2, 'browse: clear filters');
await page.locator('#date_from').fill('2099-01-01');
ok(await page.locator('.item-card').count() === 0, 'browse: date filter excludes');
await page.locator('#clear-filters').click();
await page.locator('#category').selectOption('Phone');
ok(await page.locator('.item-card').count() === 0, 'browse: category filter');
await page.locator('#clear-filters').click();
await page.locator('#status').selectOption('returned');
ok(await page.locator('.item-card').count() === 0, 'browse: status filter');
await shot('browse-desktop');

// ------------------------------------------------------------------- claim flow
await page.goto(foundUrl.replace('&posted=1', ''));
await page.locator('#show-claim').click();
await page.locator('form#claim-form button[type=submit]').click();
ok(await page.locator('#claim-form .field-error').count() === 3, 'claim: empty submit shows 3 field errors');
await page.locator('#claimant_name').fill('Sara Ahmed');
await page.locator('#claimant_contact').fill('sara@gmail.com');
await page.locator('#proof').fill('Has a worn left corner, a bus pass behind the cards and a folded receipt.');
await page.locator('form#claim-form button[type=submit]').click();
await page.waitForSelector('.claim-code');
const code = await page.locator('.claim-code').innerText();
ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code), `claim: claim code shown (${code})`);

await go('claim-status.html');
ok(await page.locator('#status-btn').isDisabled(), 'claim-status: button disabled until code typed');
await page.locator('#code').fill('AAAA-BBBB-CCCC');
await page.locator('#status-btn').click();
await page.waitForSelector('#status-result .alert-error');
ok(true, 'claim-status: unknown code -> friendly error');
await page.locator('#code').fill(code.toLowerCase());
await page.locator('#status-btn').click();
await page.waitForSelector('.result');
ok(await page.locator('.result .claim-pending').count() === 1, 'claim-status: pending status for new claim');
await go(`claim-status.html?code=${code}`);
await page.waitForSelector('.result');
ok(true, 'claim-status: ?code= prefill auto-lookup');

// duplicate claim with same contact must be refused
await page.goto(foundUrl.replace('&posted=1', ''));
await page.locator('#show-claim').click();
await page.locator('#claimant_name').fill('Sara Ahmed');
await page.locator('#claimant_contact').fill('SARA@gmail.com');
await page.locator('#proof').fill('Trying to claim again with the same contact details.');
await page.locator('form#claim-form button[type=submit]').click();
await page.waitForSelector('#claim-alert .alert-error');
ok(true, 'claim: duplicate claim (same contact) is rejected');

// ------------------------------------------------------- students vs admin pages
await go('admin-dashboard.html');
await page.waitForURL(/admin-login\.html/);
ok(true, 'admin: dashboard redirects anonymous visitor to login');
await go('admin-login.html');
ok(await page.locator('#login-btn').isDisabled(), 'admin-login: submit disabled until filled');
await page.locator('#email').fill('admin@test.com');
await page.locator('#password').fill('wrong');
await page.locator('#login-btn').click();
await page.waitForSelector('#login-alert .alert-error');
ok(await page.locator('#login-alert').innerText().then((t) => /Incorrect email or password/.test(t)), 'admin-login: wrong password -> generic message');
await page.locator('#email').fill('student@test.com');
await page.locator('#password').fill('secret123');
await page.locator('#login-btn').click();
await page.waitForSelector('#login-alert .alert-error');
ok(await page.locator('#login-alert').innerText().then((t) => /not an administrator/.test(t)), 'admin-login: valid non-admin account is refused');
await go('admin-dashboard.html');
await page.waitForURL(/admin-login\.html/);
ok(true, 'admin: non-admin account cannot open dashboard');

await page.locator('#email').fill('admin@test.com');
await page.locator('#password').fill('secret123');
await page.locator('#login-btn').click();
await page.waitForURL(/admin-dashboard\.html/);
await page.waitForSelector('.tabs');
ok(await page.locator('text=Signed in as admin@test.com').count() === 1, 'admin: signs in and sees dashboard');

// overview
await page.locator('#tab-overview').click();
ok(await page.locator('.admin-stats .stat').count() === 9, 'admin: overview shows 9 stat cards');
const stat = (label) => page.locator('.admin-stats .stat', { hasText: label }).locator('strong').innerText();
ok((await stat('Pending claims')) === '1' && (await stat('Total reports')) === '2', 'admin: overview counts correct');

// claims
await page.locator('#tab-claims').click();
ok(await page.locator('.claim').count() === 1, 'admin: pending claim listed');
const claimText = await page.locator('.claim').innerText();
ok(claimText.includes('worn left corner') && claimText.includes('finder@gmail.com') && claimText.includes('sara@gmail.com'), 'admin: claim shows proof + claimant + finder contact');
await shot('admin-claims-desktop');
await page.locator('.claim textarea').fill('Bring your student ID to the office.');
await page.locator('[data-decision=approved]').click();
await page.waitForSelector('.notice-slot .alert-success');
ok(await page.locator('.notice-slot').innerText().then((t) => /approved/.test(t)), 'admin: approve claim shows success notice');
await page.locator('#c-status').selectOption('approved');
ok(await page.locator('.claim [data-returned]').count() === 1, 'admin: approved claim offers "Mark item as returned"');

// reports
await page.locator('#tab-reports').click();
ok(await page.locator('.table tbody tr[data-item]').count() === 2, 'admin: reports table lists both');
const tbl = await page.locator('.table').innerText();
ok(tbl.includes('owner@gmail.com') && tbl.includes('0311 7654321'), 'admin: private contact visible to admin');
const lostRow = rowOf('Black leather wallet');
await lostRow.locator('[data-act=matches]').click();
await page.waitForSelector('.match-card');
ok(await page.locator('.match-card').innerText().then((t) => t.includes('finder@gmail.com') && t.includes('owner@gmail.com')), 'admin: match panel shows both parties\' contacts');
await page.locator('[data-link]').click();
await page.waitForSelector('.notice-slot .alert-success');
ok(await page.locator('.linked-text').count() >= 1, 'admin: lost and found reports linked');
await shot('admin-reports-desktop');
// mark found one returned -> linked lost one returns too
const foundRow = rowOf('Black wallet found on study desk');
await foundRow.locator('[data-act=returned]').click();
await page.waitForSelector('.notice-slot .alert-success');
await page.waitForFunction(() => document.querySelectorAll('.badge.status-returned').length === 2);
ok(true, 'admin: returning an item also returns its linked report');
// hide + unhide
await rowOf('Black leather wallet').locator('[data-act=hide]').click();
await page.waitForSelector('.badge-hidden');
await go('browse.html');
await page.waitForSelector('.item-card, .empty');
ok(await page.locator('.item-card').count() === 1, 'public: hidden report disappears from browse');
const hiddenLink = await page.evaluate(() => JSON.parse(localStorage.getItem('__fakefb')).docs);
const hiddenId = Object.entries(hiddenLink).find(([k, v]) => k.startsWith('items/') && v.visibility === 'hidden')[0].split('/')[1];
await go(`item-details.html?id=${hiddenId}`);
ok(await page.locator('.alert-warning').innerText().then((t) => /Item not found/.test(t)), 'public: hidden report page shows "not found"');
await go('browse.html');
ok(await page.locator('.item-card.is-done').count() === 1, 'browse: returned item styled as done');

// claim status as the claimant sees it after approval (admin still signed in -> sign out first)
await go('admin-dashboard.html');
await page.waitForSelector('.tabs');
await page.locator('#logout').click();
await page.waitForURL(/admin-login\.html/);
ok(true, 'admin: log out returns to login');
await go('admin-dashboard.html');
await page.waitForURL(/admin-login\.html/);
ok(true, 'admin: dashboard blocked after logout');
await go(`claim-status.html?code=${code}`);
await page.waitForSelector('.result');
const res = await page.locator('.result').innerText();
ok(/Approved/.test(res) && /Bring your student ID/.test(res) && !/worn left corner/.test(res) && !/sara@gmail/.test(res), 'claim-status: shows approval + admin note, never proof/contact');

// -------------------------------------------------- other pages + responsive
await go('about.html');
ok(await page.locator('#admin-contact').innerText().then((t) => t.includes('Test Admin')), 'about: page renders with contact card');
await go('404.html');
ok(await page.locator('h1').innerText() === 'Page not found', '404 page');
await go('item-details.html?id=doesnotexist');
ok(await page.locator('.alert-warning').count() === 1, 'item: unknown id -> not found message');

await page.setViewportSize({ width: 375, height: 800 });
await go('index.html');
await page.waitForSelector('.item-card');
ok(await page.locator('.menu-toggle').isVisible(), 'mobile: menu toggle visible');
await page.locator('.menu-toggle').click();
ok(await page.locator('#primary-nav.is-open').count() === 1 && (await page.locator('.menu-toggle').getAttribute('aria-expanded')) === 'true', 'mobile: menu opens');
ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'mobile: no horizontal overflow on home');
await shot('home-mobile');
await go('report.html');
ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'mobile: no horizontal overflow on report');
await page.setViewportSize({ width: 1200, height: 900 });
await go('index.html');
await page.waitForSelector('.item-card');
await shot('home-desktop');

ok(errors.length === 0, `no JS or console errors during the whole run${errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''}`);
await browser.close();
server.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
