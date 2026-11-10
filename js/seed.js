// OPTIONAL demo data for presentations. Only a signed-in ADMINISTRATOR can run it (the security
// rules reject everyone else). Delete seed.html and this file before going live if you do not want them.
import { initPage, Alert, withBusy } from './app.js';
import { waitForAuth } from './firebase-auth.js';
import { createReport, createClaim, isAdminUser, adminLoadAll, adminUpdateItem } from './database.js';
import { friendlyError, html, render } from './utils.js';

await initPage('', { loadSettings: false });
const out = document.getElementById('seed-out');
const btn = document.getElementById('seed-btn');
const user = await waitForAuth();
if (!user || user.isAnonymous || !(await isAdminUser(user.uid))) location.replace('admin-login.html');

const ago = (d) => { const x = new Date(Date.now() - d * 86400000); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const P = '0300 0000000';
const R = (type, title, category, location, daysAgo, color, description, n, extra = {}) =>
  ({ type, title, category, location, event_date: ago(daysAgo), color, description, contact_name: `Demo ${type === 'lost' ? 'Student' : 'Finder'} ${n}`, contact: `demo.reporter${n}@example.com`, contact_phone: P, ...extra });

const DEMO = [
  R('lost', 'Black leather wallet', 'Wallet', 'Library', 2, 'Black', 'Black bi-fold leather wallet with a small silver zipper coin pocket. Probably left on a second-floor study desk.', 1),
  R('found', 'Black wallet found on study desk', 'Wallet', 'Library', 1, 'Black', 'Black leather wallet with a silver coin zipper, found on a second-floor study desk in the library.', 2),
  R('lost', 'Blue iPhone with clear case', 'Phone', 'Cafeteria', 3, 'Blue', 'Blue iPhone in a clear case with a sticker on the back. Lost during lunch break.', 3),
  R('found', 'Mobile phone, blue case', 'Phone', 'Cafeteria', 2, 'Blue', 'Blue mobile phone with a transparent case and a sticker on the back, left on a cafeteria table.', 4),
  R('lost', 'Car key with red keychain', 'Keys', 'Parking Area', 4, 'Red', 'Single car key on a red fabric keychain with a small metal tag.', 5),
  R('found', 'Set of keys with red tag', 'Keys', 'Main Gate', 3, 'Red', 'A car key attached to a red keychain, picked up near the main gate barrier.', 6),
  R('lost', 'Green steel water bottle', 'Water Bottle', 'Sports Ground', 2, 'Green', 'Green stainless steel water bottle with a dent near the bottom and a small team sticker.', 7),
  R('found', 'Green flask near the courts', 'Water Bottle', 'Sports Ground', 1, 'Green', 'Green steel flask with a dent at the base and a sticker on the side, found beside the courts.', 8),
  R('found', 'Red plastic water bottle', 'Water Bottle', 'Cafeteria', 1, 'Red', 'Red plastic water bottle with a flip-top lid, left on a cafeteria counter.', 9),
  R('lost', 'Grey backpack with name tag', 'Bag', 'Classroom Block A', 2, 'Grey', 'Grey backpack with a laptop sleeve, two front pockets and a luggage name tag on the handle.', 10),
  R('found', 'Gray rucksack with laptop sleeve', 'Bag', 'Classroom Block A', 1, 'Gray', 'Gray rucksack with a padded laptop sleeve and front pockets, found outside lecture room A2.', 11),
  R('lost', 'Student ID card', 'ID Card', 'Science Laboratory', 1, 'Blue', 'University student ID card in a clear plastic holder with a blue lanyard.', 12),
  R('found', 'ID card in blue lanyard', 'ID Card', 'Library', 0, 'Blue', 'Student ID card in a clear holder attached to a blue lanyard, found near the library photocopier.', 13),
  R('lost', 'Casio scientific calculator', 'Electronics', 'Computer Lab', 5, 'Black', 'Black Casio scientific calculator with a scratched cover and initials written inside the lid.', 14),
  R('found', 'Prescription glasses in brown case', 'Accessories', 'Student Center', 2, 'Black', 'Thin black-framed prescription glasses inside a brown hard case, found on a sofa.', 15),
  R('found', 'Black folding umbrella', 'Accessories', 'Main Gate', 10, 'Black', 'Black folding umbrella with a wooden handle. Returned to its owner.', 16, { after: { status: 'returned' } }),
  R('found', 'Silver USB flash drive', 'Electronics', 'Computer Lab', 12, 'Silver', 'Silver 32 GB USB flash drive on a lanyard. Returned to its owner.', 17, { after: { status: 'returned' } }),
  R('lost', 'Chemistry textbook', 'Books & Stationery', 'Classroom Block B', 20, 'Green', 'Chemistry textbook with a green cover. Owner located it elsewhere, report closed.', 18, { after: { status: 'closed' } }),
  R('found', 'Black wallet (duplicate post)', 'Wallet', 'Library', 1, 'Black', 'Duplicate of the black library wallet report, hidden by an administrator.', 19, { after: { visibility: 'hidden' } }),
];

btn.addEventListener('click', () => withBusy(btn, 'Loading demo data…', async () => {
  try {
    let made = 0;
    for (const { after, ...values } of DEMO) {
      const id = await createReport(values, null, user);
      made += 1;
      if (after) {
        const { items } = await adminLoadAll();
        await adminUpdateItem(items.find((i) => i.id === id), after, items);
      }
    }
    const { items } = await adminLoadAll();
    const target = items.find((i) => i.title === 'Black wallet found on study desk');
    await createClaim(target, { claimant_name: 'Demo Claimant', claimant_contact: 'demo.claimant@example.com', proof: 'The wallet has a worn corner on the left side, a bus pass tucked behind the card slots, and a folded receipt in the coin pocket.' }, user);
    render(out, Alert('success', 'Demo data loaded', html`${made} reports and 1 claim were created. Open the <a href="browse.html">Browse page</a> or the <a href="admin-dashboard.html">dashboard</a>.`));
  } catch (err) {
    render(out, Alert('error', 'Could not load demo data', friendlyError(err)));
  }
}));
