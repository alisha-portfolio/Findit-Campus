// Firestore access. Replaces the old Express API + SQLite.
//
// Collections (see README for the full picture):
//   items/{itemId}        PUBLIC report fields (no contact details)
//   contacts/{itemId}     PRIVATE reporter name/email/phone      (admin read only)
//   claims/{claimId}      PRIVATE claim: claimant + proof        (admin read only)
//   claimStatus/{code}    PUBLIC-BY-CODE claim status (the secret claim code is the document id)
//   admins/{uid}          marks an administrator account         (set manually in the console)
//   settings/site         optional overrides for the site/contact card
import {
  getFirestore, collection, doc, getDoc, getDocs, writeBatch, query, where, orderBy, limit,
  serverTimestamp, getCountFromServer,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { app } from './firebase-auth.js';
import { compressImage, uploadItemImage } from './storage.js';
import { findMatches } from './matching.js';
import { ADMIN_CONTACT, IMAGE_MODE, LOCATIONS, MAX_ITEMS_LOADED, UNIVERSITY_NAME } from './config.js';
import { newClaimCode, sha256Hex, toDate, withTimeout } from './utils.js';

export const db = getFirestore(app);

const fromDoc = (d) => {
  const x = d.data();
  return { id: d.id, ...x, createdAt: toDate(x.createdAt), updatedAt: toDate(x.updatedAt), reviewedAt: toDate(x.reviewedAt) };
};

// ------------------------------------------------------------------ settings
/** Site name + admin contact card. Firestore settings/site overrides config.js; failure falls back silently. */
export async function loadSiteSettings() {
  const out = { universityName: UNIVERSITY_NAME, adminContact: { ...ADMIN_CONTACT } };
  try {
    const s = await getDoc(doc(db, 'settings', 'site'));
    if (s.exists()) {
      const d = s.data();
      if (typeof d.universityName === 'string' && d.universityName) out.universityName = d.universityName;
      if (d.adminContact && typeof d.adminContact === 'object') Object.assign(out.adminContact, d.adminContact);
    }
  } catch { /* defaults are fine */ }
  return out;
}

// -------------------------------------------------------------- public reads
export async function listPublicItems(max = MAX_ITEMS_LOADED) {
  // Needs the composite index (visibility ASC, createdAt DESC): see firebase/firestore.indexes.json
  const q = query(collection(db, 'items'), where('visibility', '==', 'visible'), orderBy('createdAt', 'desc'), limit(max));
  return (await getDocs(q)).docs.map(fromDoc);
}

/** Hidden reports behave as if they do not exist (the rules enforce this too). */
export async function getPublicItem(id) {
  try {
    const s = await getDoc(doc(db, 'items', id));
    if (!s.exists()) return null;
    const item = fromDoc(s);
    return item.visibility === 'visible' ? item : null;
  } catch (err) {
    if (err.code === 'permission-denied') return null;
    throw err;
  }
}

/** Larger photo of a report (free-plan mode). Returns a data URL or null. */
export async function getFullImage(id) {
  try {
    const s = await getDoc(doc(db, 'images', id));
    return s.exists() ? s.data().data : null;
  } catch { return null; }
}

export async function getStats() {
  const count = async (...cond) => (await getCountFromServer(query(collection(db, 'items'), where('visibility', '==', 'visible'), ...cond.map((c) => where(...c))))).data().count;
  const [lost, found, returned] = await Promise.all([
    count(['type', '==', 'lost'], ['status', '==', 'open']),
    count(['type', '==', 'found'], ['status', '==', 'open']),
    count(['status', '==', 'returned']),
  ]);
  return { lost, found, returned };
}

async function openCandidates(type) {
  const q = query(collection(db, 'items'), where('visibility', '==', 'visible'), where('status', '==', 'open'), where('type', '==', type));
  return (await getDocs(q)).docs.map(fromDoc);
}

/** Suggested matches for a visible, open report (public data only). */
export async function getMatches(item) {
  if (item.status !== 'open') return [];
  const others = await openCandidates(item.type === 'lost' ? 'found' : 'lost');
  return findMatches(item, others, LOCATIONS);
}

// ------------------------------------------------------------------- writes
export function newItemId() { return doc(collection(db, 'items')).id; }

/** Creates the public report + the private contact document in ONE atomic batch. Returns the new item id. */
export async function createReport(values, imageFile, user) {
  const id = newItemId();
  let image = { url: null, path: null };
  let fullImage = null; // only used in 'firestore' image mode
  if (imageFile && IMAGE_MODE === 'firestore') {
    const { thumb, full } = await compressImage(imageFile);
    image = { url: thumb, path: null };
    fullImage = full;
  } else if (imageFile) {
    image = await withTimeout(uploadItemImage(id, imageFile), 25000, 'The photo upload did not finish. Firebase Storage may not be set up yet (it needs the Blaze plan). You can also post the report without a photo.');
  }
  const batch = writeBatch(db);
  batch.set(doc(db, 'items', id), {
    type: values.type, title: values.title, category: values.category, description: values.description,
    location: values.location, eventDate: values.event_date, color: values.color,
    imageUrl: image.url, imagePath: image.path,
    status: 'open', visibility: 'visible', linkedItemId: null,
    ownerUid: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'contacts', id), {
    contactName: values.contact_name, contact: values.contact, contactPhone: values.contact_phone,
    ownerUid: user.uid, createdAt: serverTimestamp(),
  });
  if (fullImage) batch.set(doc(db, 'images', id), { data: fullImage, ownerUid: user.uid, createdAt: serverTimestamp() });
  await withTimeout(batch.commit(), 20000, 'The database did not respond. Check your internet connection and that Firestore is created in your Firebase project.');
  return id;
}

/**
 * Creates a claim (private) + its public status document (keyed by the secret code).
 * The claim id is item + hash(contact), so the same person cannot submit the same claim twice.
 */
export async function createClaim(item, values, user) {
  const code = newClaimCode();
  const hash = (await sha256Hex(values.claimant_contact.toLowerCase())).slice(0, 20);
  const claimId = `${item.id}_${hash}`;
  const batch = writeBatch(db);
  batch.set(doc(db, 'claims', claimId), {
    itemId: item.id, itemTitle: item.title,
    claimantName: values.claimant_name, claimantContact: values.claimant_contact, proof: values.proof,
    status: 'pending', adminNote: null, reviewedBy: null, reviewedAt: null,
    statusCode: code, ownerUid: user.uid, createdAt: serverTimestamp(),
  });
  batch.set(doc(db, 'claimStatus', code), {
    status: 'pending', itemId: item.id, itemTitle: item.title, adminNote: null, reviewedAt: null, createdAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (err) {
    // Rules reject re-creating an existing claim id, which is how a duplicate shows up here.
    if (err.code === 'permission-denied') throw Object.assign(new Error('This claim could not be submitted. You may already have a claim for this item, or the item is no longer available.'), { code: 'app/claim-rejected' });
    throw err;
  }
  return { claimCode: code };
}

/** Claim status by secret code (public by design: the code is the password). */
export async function getClaimStatus(code) {
  const clean = String(code || '').trim().toUpperCase().slice(0, 20);
  if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(clean)) return null;
  const s = await getDoc(doc(db, 'claimStatus', clean));
  return s.exists() ? fromDoc(s) : null;
}

// -------------------------------------------------------------------- admin
/** true if admins/{uid} exists. Throws on rule/network errors so the caller can show the real reason. */
export async function isAdminUser(uid) {
  return (await getDoc(doc(db, 'admins', uid))).exists();
}

/** Everything the dashboard needs, in three reads. Rules reject non-admins. */
export async function adminLoadAll() {
  const [itemsSnap, contactsSnap, claimsSnap] = await Promise.all([
    getDocs(query(collection(db, 'items'), orderBy('createdAt', 'desc'), limit(MAX_ITEMS_LOADED))),
    getDocs(collection(db, 'contacts')),
    getDocs(query(collection(db, 'claims'), orderBy('createdAt', 'desc'), limit(MAX_ITEMS_LOADED))),
  ]);
  const contacts = new Map(contactsSnap.docs.map((d) => [d.id, d.data()]));
  const items = itemsSnap.docs.map((d) => {
    const it = fromDoc(d);
    const c = contacts.get(d.id) || {};
    return { ...it, contactName: c.contactName || '', contact: c.contact || '', contactPhone: c.contactPhone || '' };
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  const claims = claimsSnap.docs.map((d) => {
    const c = fromDoc(d);
    const it = byId.get(c.itemId);
    return { ...c, itemStatus: it?.status || 'closed', finderName: it?.contactName || '', finderContact: it?.contact || '', finderPhone: it?.contactPhone || '' };
  });
  return { items, claims };
}

/** Admin suggested matches (uses the already-loaded private contact data). */
export function adminMatches(item, allItems) {
  const candidates = allItems.filter((i) => i.type !== item.type && i.status === 'open' && i.visibility === 'visible');
  return findMatches(item, candidates, LOCATIONS);
}

/** Change status and/or visibility. Returning an item also finishes its linked report. */
export async function adminUpdateItem(item, patch, allItems) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'items', item.id), { ...patch, updatedAt: serverTimestamp() });
  if (patch.status === 'returned' && item.linkedItemId) {
    const other = allItems.find((i) => i.id === item.linkedItemId);
    if (other && other.status !== 'returned') batch.update(doc(db, 'items', other.id), { status: 'returned', updatedAt: serverTimestamp() });
  }
  await batch.commit();
}

/** Link one lost with one found report (replaces any earlier link of either) in one atomic batch. */
export async function adminLinkItems(a, b, allItems) {
  if (a.id === b.id || a.type === b.type) throw new Error('Link one lost report with one found report.');
  if (a.status !== 'open' || b.status !== 'open') throw new Error('Only open reports can be linked.');
  const links = new Map(); // item id -> new linkedItemId
  for (const x of allItems) {
    if (x.linkedItemId && (x.linkedItemId === a.id || x.linkedItemId === b.id || x.id === a.id || x.id === b.id)) links.set(x.id, null);
  }
  links.set(a.id, b.id);
  links.set(b.id, a.id);
  const batch = writeBatch(db);
  for (const [id, linkedItemId] of links) batch.update(doc(db, 'items', id), { linkedItemId, updatedAt: serverTimestamp() });
  await batch.commit();
}

export async function adminUnlinkItem(item, allItems) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'items', item.id), { linkedItemId: null, updatedAt: serverTimestamp() });
  if (item.linkedItemId && allItems.some((i) => i.id === item.linkedItemId)) {
    batch.update(doc(db, 'items', item.linkedItemId), { linkedItemId: null, updatedAt: serverTimestamp() });
  }
  await batch.commit();
}

/** Approve or reject a pending claim. Approving does NOT mark the item returned (that is a separate step). */
export async function adminReviewClaim(claim, decision, note, adminUid, allClaims, allItems) {
  if (claim.status !== 'pending') throw new Error(`This claim was already ${claim.status}.`);
  if (decision === 'approved') {
    const item = allItems.find((i) => i.id === claim.itemId);
    if (!item || item.status !== 'open') throw new Error('The item is no longer open, so this claim cannot be approved.');
    if (allClaims.some((c) => c.itemId === claim.itemId && c.status === 'approved')) throw new Error('Another claim for this item is already approved.');
  }
  const batch = writeBatch(db);
  batch.update(doc(db, 'claims', claim.id), { status: decision, adminNote: note || null, reviewedBy: adminUid, reviewedAt: serverTimestamp() });
  batch.update(doc(db, 'claimStatus', claim.statusCode), { status: decision, adminNote: note || null, reviewedAt: serverTimestamp() });
  await batch.commit();
}
