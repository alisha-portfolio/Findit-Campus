import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReport, validateClaim, isValidEmail, isValidPhone, newClaimCode, esc, html, sha256Hex } from '../js/utils.js';

const NOW = new Date('2026-11-09T10:00:00Z');
const good = { type: 'lost', title: 'Black wallet', category: 'Wallet', description: 'Black leather wallet with zipper.', location: 'Library', event_date: '2026-11-08', color: 'Black', contact_name: 'Ali Khan', contact: 'ali@gmail.com', contact_phone: '0300 1234567' };

test('valid report passes and is cleaned', () => {
  const { errors, values } = validateReport({ ...good, title: '  Black   wallet  ' }, NOW);
  assert.deepEqual(errors, {});
  assert.equal(values.title, 'Black wallet');
});

test('every required report field is checked', () => {
  const { errors } = validateReport({}, NOW);
  for (const k of ['type', 'title', 'category', 'description', 'location', 'event_date', 'contact_name', 'color', 'contact', 'contact_phone']) assert.ok(errors[k], k);
});

test('category and location must come from the lists', () => {
  const { errors } = validateReport({ ...good, category: 'Spaceship', location: 'Moon' }, NOW);
  assert.ok(errors.category && errors.location);
});

test('dates: no future, no older than a year, real calendar dates only', () => {
  assert.ok(validateReport({ ...good, event_date: '2026-12-01' }, NOW).errors.event_date);
  assert.ok(validateReport({ ...good, event_date: '2025-01-01' }, NOW).errors.event_date);
  assert.ok(validateReport({ ...good, event_date: '2026-02-31' }, NOW).errors.event_date);
});

test('email and phone formats', () => {
  assert.ok(isValidEmail('a@b.co') && !isValidEmail('a@b') && !isValidEmail('a b@c.com'));
  assert.ok(isValidPhone('0300 1234567') && isValidPhone('+92-300-1234567') && !isValidPhone('12345'));
});

test('claim validation', () => {
  assert.deepEqual(validateClaim({ claimant_name: 'Sara', claimant_contact: 'sara@gmail.com', proof: 'Has a worn corner and a bus pass inside.' }).errors, {});
  const { errors } = validateClaim({ claimant_name: 'S', claimant_contact: 'nope', proof: 'short' });
  assert.ok(errors.claimant_name && errors.claimant_contact && errors.proof);
});

test('claim codes look like K7QX-4MPD-93TF and are unique', () => {
  const codes = new Set(Array.from({ length: 500 }, newClaimCode));
  assert.equal(codes.size, 500);
  for (const c of codes) assert.match(c, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
});

test('html`` escapes user text (XSS) but keeps nested templates', () => {
  assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(html`<b>${'<i>'}</b>${html`<u>ok</u>`}`.toString(), '<b>&lt;i&gt;</b><u>ok</u>');
  assert.equal(html`${['<a>', html`<b/>`]}`.toString(), '&lt;a&gt;<b/>');
});

test('sha256Hex', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
