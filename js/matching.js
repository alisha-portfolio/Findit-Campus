// Smart matching: compares a lost report with found reports (or vice versa)
// and returns a 0-100 similarity score plus a human-readable explanation.
// Ported unchanged from the old backend/services/matching.js (only the field
// name event_date -> eventDate differs). It is a SUGGESTION engine only: an
// administrator always verifies ownership before anything is handed over.
//
// Score = category (25) + title (25) + description keywords (20) + location (15) + date (15) = 100

export const WEIGHTS = { category: 25, title: 25, description: 20, location: 15, date: 15 };
export const MIN_SCORE = 40;
export const MAX_RESULTS = 10;
const DATE_WINDOW_DAYS = 14;

const STOP_WORDS = new Set(
  ('a an the of in on at my our your with and or to for from is it its was were be been this that these those ' +
    'lost found near left has have had who which some very please contact return reward item thing one ' +
    'around inside outside between about into over under there here also pls plz').split(' ')
);

const SYNONYMS = {
  mobile: 'phone', cellphone: 'phone', smartphone: 'phone', iphone: 'phone', android: 'phone', handset: 'phone',
  flask: 'bottle', tumbler: 'bottle', thermos: 'bottle', canteen: 'bottle',
  backpack: 'bag', rucksack: 'bag', satchel: 'bag', handbag: 'bag', schoolbag: 'bag', tote: 'bag', pouch: 'bag',
  purse: 'wallet', billfold: 'wallet', cardholder: 'wallet',
  keychain: 'key', keyring: 'key', fob: 'key',
  airpod: 'earphone', earbud: 'earphone', headphone: 'earphone', headset: 'earphone', earpod: 'earphone',
  spectacle: 'glass', eyeglass: 'glass',
  textbook: 'book', novel: 'book', notebook: 'book',
  calc: 'calculator',
  smartwatch: 'watch', wristwatch: 'watch',
  coat: 'jacket', hoodie: 'jacket', sweater: 'jacket', sweatshirt: 'jacket',
  cable: 'charger', adapter: 'charger', powerbank: 'charger',
  pendrive: 'usb', flashdrive: 'usb',
};

const COLOR_ALIASES = {
  black: 'black', white: 'white', grey: 'grey', gray: 'grey', silver: 'silver', red: 'red', maroon: 'red',
  blue: 'blue', navy: 'blue', green: 'green', yellow: 'yellow', orange: 'orange', purple: 'purple',
  pink: 'pink', brown: 'brown', beige: 'beige', cream: 'beige', gold: 'gold', golden: 'gold', teal: 'teal',
};

const RELATED_CATEGORIES = [
  ['Phone', 'Electronics'], ['Wallet', 'ID Card'], ['Wallet', 'Documents'], ['ID Card', 'Documents'],
  ['Bag', 'Books & Stationery'], ['Keys', 'Accessories'], ['Clothing', 'Accessories'],
];

function stem(word) {
  if (word.length <= 3) return word;
  if (word.endsWith('sses')) return word.slice(0, -2);
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

export function tokenize(text) {
  const out = new Set();
  const words = String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
  for (const raw of words) {
    if (!raw || STOP_WORDS.has(raw)) continue;
    if (raw.length < 2 && !/\d/.test(raw)) continue;
    const stemmed = stem(raw);
    if (STOP_WORDS.has(stemmed)) continue;
    out.add(stemmed);
    const canon = SYNONYMS[raw] ?? SYNONYMS[stemmed];
    if (canon) out.add(canon);
  }
  return out;
}

export function extractColors(text) {
  const found = new Set();
  for (const w of String(text || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/)) {
    if (COLOR_ALIASES[w]) found.add(COLOR_ALIASES[w]);
  }
  return found;
}

const intersection = (a, b) => [...a].filter((x) => b.has(x));
function dice(a, b) {
  if (!a.size || !b.size) return 0;
  return (2 * intersection(a, b).length) / (a.size + b.size);
}
const round1 = (n) => Math.round(n * 10) / 10;
const dayNumber = (s) => Math.floor(Date.parse(`${s}T00:00:00Z`) / 86400000);

function categoryFactor(a, b) {
  const max = WEIGHTS.category;
  if (a.category === b.category) return { points: max, detail: `Same category (${a.category}).`, matched: true };
  if (a.category === 'Other' || b.category === 'Other') {
    return { points: round1(max * 0.3), detail: 'One report uses the generic "Other" category.', matched: false };
  }
  const related = RELATED_CATEGORIES.some(([x, y]) => (x === a.category && y === b.category) || (y === a.category && x === b.category));
  if (related) return { points: round1(max * 0.4), detail: `Related categories (${a.category} / ${b.category}).`, matched: false };
  return { points: 0, detail: `Different categories (${a.category} vs ${b.category}).`, matched: false };
}

function titleFactor(a, b) {
  const ta = tokenize(a.title);
  const tb = tokenize(b.title);
  const shared = intersection(ta, tb);
  const ratio = dice(ta, tb);
  return {
    points: round1(WEIGHTS.title * ratio),
    detail: shared.length ? `Titles share: ${shared.join(', ')}.` : 'Titles share no meaningful words.',
    matched: ratio >= 0.4,
    ratio,
  };
}

function descriptionFactor(a, b) {
  const ta = tokenize(`${a.title} ${a.color || ''} ${a.description}`);
  const tb = tokenize(`${b.title} ${b.color || ''} ${b.description}`);
  const shared = intersection(ta, tb);
  let ratio = Math.min(1, dice(ta, tb) / 0.6);
  const ca = extractColors(`${a.title} ${a.color || ''} ${a.description}`);
  const cb = extractColors(`${b.title} ${b.color || ''} ${b.description}`);
  const sharedColors = intersection(ca, cb);
  let colorNote = '';
  if (ca.size && cb.size) {
    if (sharedColors.length) {
      ratio = Math.min(1, ratio + 0.2);
      colorNote = ` Same colour: ${sharedColors.join(', ')}.`;
    } else {
      ratio *= 0.4;
      colorNote = ` Different colours mentioned (${[...ca].join('/')} vs ${[...cb].join('/')}).`;
    }
  }
  return {
    points: round1(WEIGHTS.description * ratio),
    detail: (shared.length ? `Shared keywords: ${shared.slice(0, 6).join(', ')}.` : 'No shared keywords in the descriptions.') + colorNote,
    matched: ratio >= 0.4,
  };
}

function locationFactor(a, b, locations) {
  const max = WEIGHTS.location;
  if (a.location === b.location) return { points: max, detail: `Same location (${a.location}).`, matched: true };
  const za = locations.find((l) => l.name === a.location)?.zone;
  const zb = locations.find((l) => l.name === b.location)?.zone;
  if (za && za === zb && za !== 'other') {
    return { points: round1(max * 0.5), detail: `Nearby areas (${a.location} / ${b.location}).`, matched: false };
  }
  return { points: 0, detail: `Different locations (${a.location} vs ${b.location}).`, matched: false };
}

function dateFactor(a, b) {
  const max = WEIGHTS.date;
  const lost = a.type === 'lost' ? a : b;
  const found = a.type === 'found' ? a : b;
  const gap = dayNumber(found.eventDate) - dayNumber(lost.eventDate);
  if (gap < -1) return { points: 0, detail: 'Reported found before it was reported lost.', matched: false };
  const days = Math.max(0, gap);
  const points = round1(max * Math.max(0, 1 - days / DATE_WINDOW_DAYS));
  const detail = days === 0 ? 'Lost and found on the same day.' : `Found ${days} day${days === 1 ? '' : 's'} after it was lost.`;
  return { points, detail, matched: days <= 3 };
}

export function scorePair(a, b, locations) {
  const factors = {
    category: categoryFactor(a, b),
    title: titleFactor(a, b),
    description: descriptionFactor(a, b),
    location: locationFactor(a, b, locations),
    date: dateFactor(a, b),
  };
  const total = Object.values(factors).reduce((sum, f) => sum + f.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(total)));
  const reasons = Object.entries(factors).map(([factor, f]) => ({ factor, points: f.points, max: WEIGHTS[factor], matched: f.matched, detail: f.detail }));
  return { score, reasons, titleRatio: factors.title.ratio, categoryPoints: factors.category.points };
}

export function confidenceLabel(score) {
  if (score >= 75) return 'strong';
  if (score >= 55) return 'likely';
  return 'possible';
}

/** Best opposite-type candidates for `item`, sorted best-first: [{ item, score, confidence, reasons }]. */
export function findMatches(item, candidates, locations, { minScore = MIN_SCORE, limit = MAX_RESULTS } = {}) {
  const results = [];
  for (const other of candidates) {
    if (other.id === item.id || other.type === item.type) continue;
    const { score, reasons, titleRatio, categoryPoints } = scorePair(item, other, locations);
    const topical = categoryPoints > 0 || titleRatio >= 0.5;
    if (score < minScore || !topical) continue;
    results.push({ item: other, score, confidence: confidenceLabel(score), reasons });
  }
  results.sort((x, y) => y.score - x.score || String(y.item.id).localeCompare(String(x.item.id)));
  return results.slice(0, limit);
}
