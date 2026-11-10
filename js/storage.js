// Firebase Storage: item photographs.
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';
import { app } from './firebase-auth.js';
import { MAX_IMAGE_MB } from './config.js';

const storage = getStorage(app);

/** Detects the real image type from the first bytes (the browser's MIME type is never trusted). */
export async function detectImageType(file) {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return { ext: 'png', mime: 'image/png' };
  const ascii = (from, to) => String.fromCharCode(...b.slice(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

/** Returns an error message for an unacceptable file, or '' if it is fine. */
export async function checkImage(file) {
  if (file.size > MAX_IMAGE_MB * 1024 * 1024) return `Image must be smaller than ${MAX_IMAGE_MB} MB.`;
  if (!(await detectImageType(file))) return 'Please choose a JPEG, PNG or WebP image.';
  return '';
}

/** Decodes the picture and draws it on a canvas of at most `max` pixels. Returns a JPEG data URL <= cap characters. */
async function toJpeg(bitmap, max, quality, cap) {
  for (const shrink of [1, 0.8, 0.65, 0.5]) {
    const scale = Math.min(1, (max * shrink) / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // PNG transparency -> white
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (let q = quality; q >= 0.4; q -= 0.1) {
      const url = canvas.toDataURL('image/jpeg', q);
      if (url.length <= cap) return url;
    }
  }
  throw new Error('This photo is too detailed to shrink. Please choose a simpler or smaller photo.');
}

/** Free-plan mode: returns { thumb, full } small JPEG data URLs that are stored in Firestore. */
export async function compressImage(file) {
  const problem = await checkImage(file);
  if (problem) throw new Error(problem);
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This image could not be read. Please choose another photo.');
  }
  const thumb = await toJpeg(bitmap, 280, 0.65, 50000);   // shown in lists
  const full = await toJpeg(bitmap, 1000, 0.75, 380000);  // shown on the item page
  bitmap.close?.();
  return { thumb, full };
}

/** Uploads under items/{itemId}/{random}.{ext}. Returns { url, path }. */
export async function uploadItemImage(itemId, file) {
  const problem = await checkImage(file);
  if (problem) throw new Error(problem);
  const type = await detectImageType(file);
  const name = Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, '0')).join('');
  const path = `items/${itemId}/${name}.${type.ext}`;
  const r = ref(storage, path);
  await uploadBytes(r, file, { contentType: type.mime });
  return { url: await getDownloadURL(r), path };
}
