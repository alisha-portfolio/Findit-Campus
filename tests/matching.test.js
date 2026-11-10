import test from 'node:test';
import assert from 'node:assert/strict';
import { findMatches, scorePair, tokenize, extractColors, confidenceLabel } from '../js/matching.js';
import { LOCATIONS } from '../js/config.js';

const day = (n) => new Date(Date.UTC(2026, 10, 9) - n * 86400000).toISOString().slice(0, 10);
let n = 0;
const item = (o) => ({ id: `i${++n}`, color: '', ...o, eventDate: day(o.daysAgo ?? 0) });

test('tokenize: stems, drops stop words, adds synonyms', () => {
  const t = tokenize('My lost backpacks near the Library');
  assert.ok(t.has('bag') && t.has('backpack') && t.has('library'));
  assert.ok(!t.has('lost') && !t.has('the'));
});

test('extractColors maps aliases', () => {
  assert.deepEqual([...extractColors('Navy and GRAY bag')].sort(), ['blue', 'grey']);
});

test('strong match: black wallet in the library, one day apart', () => {
  const lost = item({ type: 'lost', title: 'Black leather wallet', category: 'Wallet', location: 'Library', color: 'Black', daysAgo: 2, description: 'Black bi-fold leather wallet with a small silver zipper coin pocket. Left on a study desk.' });
  const found = item({ type: 'found', title: 'Black wallet found on study desk', category: 'Wallet', location: 'Library', color: 'Black', daysAgo: 1, description: 'Black leather wallet with a silver coin zipper, found on a study desk in the library.' });
  const [m] = findMatches(lost, [found], LOCATIONS);
  assert.ok(m, 'should match');
  assert.ok(m.score >= 75, `score ${m.score}`);
  assert.equal(m.confidence, 'strong');
});

test('synonym match: "iPhone" vs "mobile phone"', () => {
  const lost = item({ type: 'lost', title: 'Blue iPhone with clear case', category: 'Phone', location: 'Cafeteria', color: 'Blue', daysAgo: 3, description: 'Blue iPhone in a clear case with a sticker on the back.' });
  const found = item({ type: 'found', title: 'Mobile phone, blue case', category: 'Phone', location: 'Cafeteria', color: 'Blue', daysAgo: 2, description: 'Blue mobile phone with a transparent case and a sticker on the back.' });
  assert.ok(findMatches(lost, [found], LOCATIONS)[0].score >= 70);
});

test('colour matters: green flask beats red bottle', () => {
  const lost = item({ type: 'lost', title: 'Green steel water bottle', category: 'Water Bottle', location: 'Sports Ground', color: 'Green', daysAgo: 2, description: 'Green stainless steel water bottle with a dent and a sticker.' });
  const green = item({ type: 'found', title: 'Green flask near the courts', category: 'Water Bottle', location: 'Sports Ground', color: 'Green', daysAgo: 1, description: 'Green steel flask with a dent at the base and a sticker.' });
  const red = item({ type: 'found', title: 'Red plastic water bottle', category: 'Water Bottle', location: 'Cafeteria', color: 'Red', daysAgo: 1, description: 'Red plastic water bottle with a flip-top lid.' });
  const res = findMatches(lost, [red, green], LOCATIONS);
  assert.equal(res[0].item.id, green.id);
});

test('nearby locations earn half the location points', () => {
  const a = item({ type: 'lost', title: 'Car key', category: 'Keys', location: 'Parking Area', daysAgo: 1, description: 'x' });
  const b = item({ type: 'found', title: 'Car key', category: 'Keys', location: 'Main Gate', daysAgo: 0, description: 'x' });
  const loc = scorePair(a, b, LOCATIONS).reasons.find((r) => r.factor === 'location');
  assert.equal(loc.points, 7.5);
});

test('never compares same type, itself, or found-before-lost', () => {
  const a = item({ type: 'lost', title: 'Black wallet', category: 'Wallet', location: 'Library', daysAgo: 1, description: 'black wallet' });
  const same = item({ type: 'lost', title: 'Black wallet', category: 'Wallet', location: 'Library', daysAgo: 1, description: 'black wallet' });
  assert.equal(findMatches(a, [a, same], LOCATIONS).length, 0);
  const early = item({ type: 'found', title: 'Black wallet', category: 'Wallet', location: 'Library', daysAgo: 9, description: 'black wallet' });
  assert.equal(scorePair(a, early, LOCATIONS).reasons.find((r) => r.factor === 'date').points, 0);
});

test('same place and day but unrelated item is not suggested', () => {
  const a = item({ type: 'lost', title: 'Black wallet', category: 'Wallet', location: 'Library', daysAgo: 0, description: 'black leather wallet' });
  const b = item({ type: 'found', title: 'Chemistry textbook', category: 'Books & Stationery', location: 'Library', daysAgo: 0, description: 'green cover textbook' });
  assert.equal(findMatches(a, [b], LOCATIONS).length, 0);
});

test('confidence labels', () => {
  assert.deepEqual([80, 60, 45].map(confidenceLabel), ['strong', 'likely', 'possible']);
});
