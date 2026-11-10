// Small helpers shared by every page: safe HTML templates, formatting, validation.
import { CATEGORIES, LOCATIONS } from './config.js';

// ---------------------------------------------------------------- safe HTML
// html`...` escapes every ${value} automatically (prevents XSS from user text).
// Use raw(...) or nested html`...` for markup you trust.
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(String(s));
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const part = (v) => (v instanceof Safe ? v.s : Array.isArray(v) ? v.map(part).join('') : v === null || v === undefined || v === false ? '' : esc(v));
export function html(strings, ...vals) {
  return new Safe(strings.reduce((out, s, i) => out + s + (i < vals.length ? part(vals[i]) : ''), ''));
}
export const render = (el, safe) => { el.innerHTML = safe instanceof Safe ? safe.s : String(safe); };

// ---------------------------------------------------------------- formatting
export const CATEGORY_ICONS = {
  Wallet: '👛', Phone: '📱', Keys: '🔑', 'ID Card': '🪪', Bag: '🎒', 'Water Bottle': '🧴',
  'Books & Stationery': '📚', Electronics: '💻', Clothing: '👕', Accessories: '💍', Documents: '📄', Other: '📦',
};
export const categoryIcon = (c) => CATEGORY_ICONS[c] || '📦';
export const STATUS_LABELS = { open: 'Open', returned: 'Returned', closed: 'Closed' };

/** Firestore Timestamp | Date | ISO string | 'YYYY-MM-DD' -> Date (or null). */
export function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(String(v).length === 10 ? `${v}T00:00:00` : v);
  return Number.isNaN(d.getTime()) ? null : d;
}
export function formatDate(value) {
  const d = toDate(value);
  return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}
/** Today's date as YYYY-MM-DD in the visitor's own time zone. */
export function todayLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const shortId = (id) => String(id || '').slice(0, 6).toUpperCase();
export const getParam = (name) => new URLSearchParams(location.search).get(name) || '';

export function debounce(fn, ms = 350) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// -------------------------------------------------------------- validation
// Ported 1:1 from the old backend/services/validation.js.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export function cleanLine(v) {
  return typeof v === 'string' ? v.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim() : '';
}
export function cleanText(v) {
  return typeof v === 'string'
    ? v.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
    : '';
}
export const isValidEmail = (v) => EMAIL_RE.test(v);
export const isValidPhone = (v) => /^\+?\d{7,15}$/.test(v.replace(/[\s\-().]/g, ''));
export const isValidContact = (v) => isValidEmail(v) || isValidPhone(v);
export function isValidDateString(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
const toDateString = (d) => d.toISOString().slice(0, 10);

function checkLength(errors, field, value, label, min, max) {
  if (!value) errors[field] = `${label} is required.`;
  else if (value.length < min) errors[field] = `${label} must be at least ${min} characters.`;
  else if (value.length > max) errors[field] = `${label} must be at most ${max} characters.`;
}

/** Returns { values, errors }. `errors` is {} when the input is valid. */
export function validateReport(b, now = new Date()) {
  const errors = {};
  const type = cleanLine(b.type).toLowerCase();
  if (!['lost', 'found'].includes(type)) errors.type = 'Choose whether the item was lost or found.';
  const title = cleanLine(b.title);
  checkLength(errors, 'title', title, 'Item name', 3, 100);
  const category = cleanLine(b.category);
  if (!CATEGORIES.includes(category)) errors.category = 'Choose a category from the list.';
  const description = cleanText(b.description);
  checkLength(errors, 'description', description, 'Description', 10, 1000);
  const location = cleanLine(b.location);
  if (!LOCATIONS.some((l) => l.name === location)) errors.location = 'Choose a campus location from the list.';

  const eventDate = cleanLine(b.event_date);
  if (!isValidDateString(eventDate)) {
    errors.event_date = 'Enter a valid date.';
  } else {
    const latest = new Date(now.getTime() + 24 * 3600 * 1000);
    const earliest = new Date(now.getTime() - 365 * 24 * 3600 * 1000);
    if (eventDate > toDateString(latest)) errors.event_date = 'The date cannot be in the future.';
    else if (eventDate < toDateString(earliest)) errors.event_date = 'Reports older than one year are not accepted.';
  }
  const contactName = cleanLine(b.contact_name);
  checkLength(errors, 'contact_name', contactName, 'Your name', 2, 100);
  const color = cleanLine(b.color);
  checkLength(errors, 'color', color, 'Colour', 3, 40);
  const contact = cleanLine(b.contact);
  if (!contact) errors.contact = 'Your email address is required.';
  else if (contact.length > 120 || !isValidEmail(contact)) errors.contact = 'Enter a valid email address, for example name@gmail.com.';
  const contactPhone = cleanLine(b.contact_phone);
  if (!contactPhone) errors.contact_phone = 'Your phone number is required.';
  else if (contactPhone.length > 30 || !isValidPhone(contactPhone)) errors.contact_phone = 'Enter a valid phone number, for example 0300 1234567.';

  return {
    errors,
    values: { type, title, category, description, location, event_date: eventDate, color, contact_name: contactName, contact, contact_phone: contactPhone },
  };
}

export function validateClaim(b) {
  const errors = {};
  const name = cleanLine(b.claimant_name);
  checkLength(errors, 'claimant_name', name, 'Your name', 2, 100);
  const contact = cleanLine(b.claimant_contact);
  if (!contact) errors.claimant_contact = 'Contact details are required.';
  else if (contact.length > 120 || !isValidContact(contact)) errors.claimant_contact = 'Enter a valid email address or phone number.';
  const proof = cleanText(b.proof);
  checkLength(errors, 'proof', proof, 'Proof of ownership', 20, 1500);
  return { errors, values: { claimant_name: name, claimant_contact: contact, proof } };
}

// ------------------------------------------------------------------ codes
/** Short human-friendly claim code, e.g. "K7QX-4MPD-93TF" (no look-alike characters). */
export function newClaimCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars -> uniform with a byte % 32
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const c = Array.from(bytes, (b) => alphabet[b % 32]);
  return [c.slice(0, 4), c.slice(4, 8), c.slice(8, 12)].map((g) => g.join('')).join('-');
}
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Rejects with `message` if `promise` has not finished after `ms` (Firebase can wait silently when a service is not set up). */
export function withTimeout(promise, ms, message) {
  let t;
  const timer = new Promise((_, reject) => { t = setTimeout(() => reject(Object.assign(new Error(message), { code: 'app/timeout' })), ms); });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

// ----------------------------------------------------------------- errors
/** Turns Firebase / network errors into messages a student can understand. */
export function friendlyError(err) {
  const code = err?.code || '';
  if (code === 'permission-denied' || code === 'storage/unauthorized') return 'You do not have permission to do that. If this keeps happening, please contact the administrator.';
  if (code === 'unavailable' || code === 'storage/retry-limit-exceeded' || code === 'auth/network-request-failed') return 'Cannot reach the server. Check your internet connection and try again.';
  if (code === 'failed-precondition' && /index/i.test(err.message || '')) return 'The database needs a one-time index (see README, step "Create the Firestore index"). Open the browser console and click the link Firebase prints.';
  if (code === 'resource-exhausted') return 'The service is busy right now. Please try again later.';
  if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') return 'Anonymous sign-in is not enabled in Firebase yet (see README, Authentication step).';
  return err?.message || 'Something went wrong. Please try again.';
}
