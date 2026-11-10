// Report a lost / found item (was Report.jsx).
import { initPage, Alert, fillSelect, showFieldErrors, clearFieldErrors, withBusy } from './app.js';
import { createReport } from './database.js';
import { ensureUser } from './firebase-auth.js';
import { checkImage } from './storage.js';
import { CATEGORIES, LOCATIONS, MAX_IMAGE_MB } from './config.js';
import { getParam, html, render, todayLocal, validateReport, friendlyError } from './utils.js';

await initPage('report');

const form = document.getElementById('report-form');
const alertEl = document.getElementById('form-alert');
const btn = document.getElementById('submit-btn');
const preview = document.getElementById('preview');
const previewImg = document.getElementById('preview-img');
let image = null;
let previewUrl = null;

fillSelect(form.category, CATEGORIES, 'Choose a category…');
fillSelect(form.location, LOCATIONS.map((l) => l.name), 'Choose a location…');
document.querySelector('[data-max-mb]').textContent = MAX_IMAGE_MB;
form.event_date.value = todayLocal();
form.event_date.max = todayLocal();

// ---- lost / found toggle (texts change like in the React version)
function syncType() {
  const isLost = form.elements.type.value === 'lost';
  document.getElementById('seg-lost').classList.toggle('on', isLost);
  document.getElementById('seg-found').classList.toggle('on', !isLost);
  document.getElementById('report-title').textContent = isLost ? 'Report a lost item' : 'Report a found item';
  document.getElementById('report-intro').textContent = isLost
    ? 'Tell us what you lost and where. The administrator will compare your report with found items and contact you if something matches.'
    : 'Thank you for helping! Describe what you found, then hand the item to the lost & found administrator. The owner is never given your details.';
  document.querySelector('label[for="location"]').firstChild.textContent = isLost ? 'Where did you lose it?' : 'Where did you find it?';
  document.querySelector('label[for="event_date"]').firstChild.textContent = isLost ? 'Date lost' : 'Date found';
  document.getElementById('other-party').textContent = isLost ? 'finder' : 'owner';
  btn.textContent = isLost ? 'Post lost item report' : 'Post found item report';
}
const initial = getParam('type') === 'found' ? 'found' : 'lost';
form.querySelector(`input[name="type"][value="${initial}"]`).checked = true;
form.addEventListener('change', (e) => { if (e.target.name === 'type') syncType(); });
syncType();

// ---- photo picker with preview
function clearImage() {
  image = null;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  form.image.value = '';
  preview.hidden = true;
}
form.image.addEventListener('change', async () => {
  const file = form.image.files?.[0];
  showFieldErrors(form, {});
  if (!file) return clearImage();
  const problem = await checkImage(file);
  if (problem) { clearImage(); return showFieldErrors(form, { image: problem }); }
  image = file;
  previewUrl = URL.createObjectURL(file);
  previewImg.src = previewUrl;
  preview.hidden = false;
});
document.getElementById('remove-photo').addEventListener('click', clearImage);

// ---- submit
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  render(alertEl, html``);
  clearFieldErrors(form);
  const { values, errors } = validateReport(Object.fromEntries(new FormData(form)));
  if (Object.keys(errors).length) {
    showFieldErrors(form, errors);
    render(alertEl, Alert('error', 'Your report was not sent', 'Please fix the highlighted fields.'));
    form.querySelector('.has-error input, .has-error select, .has-error textarea')?.focus();
    return;
  }
  await withBusy(btn, 'Posting…', async () => {
    try {
      const user = await ensureUser();
      const id = await createReport(values, image, user);
      location.href = `item-details.html?id=${encodeURIComponent(id)}&posted=1`;
    } catch (err) {
      render(alertEl, Alert('error', 'Your report was not sent', friendlyError(err)));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
});
