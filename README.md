# FindIt Campus (HTML + CSS + Vanilla JS + Firebase)

Lost & Found for **Mehran University of Engineering and Technology (MUET)**.
A static website: no React, no Node server, no SQLite. Data lives in **Firebase Firestore**, photos in **Firebase Storage**, administrator login uses **Firebase Authentication**. The design (`css/style.css`) is the original stylesheet, unchanged.

```
findit-campus/
├── index.html  browse.html  report.html  item-details.html  claim-status.html  about.html  404.html
├── admin-login.html  admin-dashboard.html  seed.html (optional demo data)
├── css/style.css            original stylesheet (unchanged)
├── js/
│   ├── firebase-config.js   <- YOU edit this (Firebase web config)
│   ├── config.js            categories, locations, admin contact defaults
│   ├── firebase-auth.js     Firebase app + sign-in
│   ├── database.js          all Firestore reads/writes
│   ├── storage.js           photo upload
│   ├── matching.js          smart-match scoring (ported unchanged)
│   ├── app.js  utils.js     header/footer, UI pieces, validation
│   └── home.js browse.js reports.js item.js claims.js admin.js seed.js
├── firebase/                firestore.rules  storage.rules  firestore.indexes.json  firebase.json
├── tests/                   node logic tests + browser smoke test
└── assets/favicon.svg
```

## How data is stored

| Collection | Contents | Who can read |
|---|---|---|
| `items/{id}` | public report (title, category, location, date, colour, photo, status, visibility, link) | everyone (visible ones); admins (all) |
| `contacts/{id}` | reporter name, email, phone | **admins only** |
| `claims/{id}` | claimant name, contact, proof | **admins only** |
| `claimStatus/{code}` | status + admin note of one claim; the secret claim code is the document id | anyone who knows the code (cannot be listed) |
| `admins/{uid}` | marks an administrator | the user themself; created by hand only |
| `settings/site` | optional: university name and admin contact card | everyone (admins write) |

Students never log in: when they submit a report or claim the site signs them in **anonymously** behind the scenes (same experience as before). Administrators sign in with email + password.

---

## 1. Create the Firebase project
1. Go to <https://console.firebase.google.com> -> **Add project** -> name it `findit-campus`. (Google Analytics is not needed.)
2. **Project settings (gear) -> General -> Your apps -> `</>` Web** -> register an app (no hosting). Copy the `firebaseConfig` values.

## 2. Turn on the services
1. **Build -> Authentication -> Get started -> Sign-in method**: enable **Anonymous** and **Email/Password**.
2. **Build -> Firestore Database -> Create database** -> *Production mode* -> choose a region near you.
3. **Build -> Storage -> Get started** -> Production mode.
   > Note: as far as I know, Firebase now asks new projects to upgrade to the pay-as-you-go **Blaze** plan before Storage can be created. Usage at campus scale is normally inside the free quota, and you can set a budget alert. Check the current rules on the Firebase pricing page.

## 3. Paste your config
Open `js/firebase-config.js` and replace every `YOUR_...` value. These values identify the project; they are **not secrets**. Never put a service-account key or an admin password in this project.

## 4. Publish the security rules
- **Firestore Database -> Rules**: paste the whole of `firebase/firestore.rules` -> **Publish**.
- **Storage -> Rules**: paste `firebase/storage.rules` -> **Publish**.

## 5. Create the Firestore index (one time)
Browse needs an index on `items (visibility ↑, createdAt ↓)`. Either:
- open the site, open the browser console (F12) on **Browse**; Firebase prints a link, click it and press **Create**; or
- **Firestore -> Indexes -> Composite -> Add**: collection `items`, fields `visibility` Ascending, `createdAt` Descending. Wait until it says *Enabled* (a few minutes).

## 6. Create the first administrator (securely)
There is deliberately **no sign-up page and no default password**.
1. **Authentication -> Users -> Add user**: your admin email + a strong password (10+ characters). Copy the user's **UID**.
2. **Firestore -> Start collection** `admins` -> Document ID = **that UID** -> add field `email` (string) = the admin email. Save.
3. Open `admin-login.html` and sign in.

More admins: repeat 1-2. Remove an admin: delete their `admins/{uid}` document. Because the rules check this document on the server, hiding the button or editing the JavaScript gives nobody admin power. A normal Firebase user without an `admins` document is refused.

## 7. (Optional) Admin contact card without redeploying
Firestore -> collection `settings` -> document `site` -> fields:
`universityName` (string), `adminContact` (map: `name`, `email`, `phone`, `office_location`, `office_hours`). Otherwise the defaults in `js/config.js` are used. Edit `config.js` for categories/locations too, and keep the lists in `firestore.rules` identical.

## 8. Run it on your computer
ES modules need `http://`, not `file://`. In PowerShell inside the project folder:
```powershell
python -m http.server 8080
```
then open <http://localhost:8080>. (Or use the VS Code **Live Server** extension.) Add `localhost` to **Authentication -> Settings -> Authorized domains** if sign-in complains (it is there by default).

## 9. Deploy for free
**GitHub Pages**
1. Push the folder to a GitHub repository (repository root = this folder).
2. **Settings -> Pages -> Deploy from a branch -> main / (root)**.
3. Copy the final address (`https://<you>.github.io/<repo>/`) into **Firebase -> Authentication -> Settings -> Authorized domains** (add `<you>.github.io`).

**Vercel**: *Add New Project* -> import the repo -> Framework preset **Other**, no build command, output directory `.` -> Deploy. Then add the `*.vercel.app` domain to Firebase *Authorized domains*.

## 10. Optional demo data
Sign in as admin, open `seed.html`, press **Load demo data** (19 sample reports + 1 claim). Delete `seed.html` and `js/seed.js` before launch if you don't want them.

---

## What changed compared with the Node/React version
| Before | Now |
|---|---|
| Express API + SQLite | Firestore + security rules |
| `/uploads` folder | Firebase Storage (JPEG/PNG/WebP, < 3 MB, real file type checked) |
| Admin sessions in SQLite | Firebase Auth + `admins/{uid}` document checked by the rules |
| Numeric ids (`#12`) | Firestore ids (shown shortened, e.g. `#A1B2C3`) |
| Server-side search (`LIKE`) | newest 500 visible reports loaded and filtered in the browser |
| Server-side matching | same scoring code, run in the browser |
| Per-IP rate limits | strict rule validation + one-claim-per-person-per-item; add **App Check** for bot protection |

## Known limitations (please read)
- **Search scale**: Browse/admin load the newest 500 reports. Fine for one campus; larger sites need a search service.
- **Rate limiting**: there is no per-IP limiter on a static site. Turn on **Firebase App Check** (reCAPTCHA) and set a Firebase budget alert if abuse becomes a concern.
- **Claim again after rejection**: a claim ID is derived from item + contact, so the same contact can't claim the same item twice (even after rejection). Use a different contact or ask the admin.
- **Photos of hidden reports** stay reachable by direct URL (Firebase download links are unguessable but not private). Admins can delete the file in the Storage console.
- Failed uploads can leave an unused photo file (students can't delete files).
- The "date not in the future" and 1-year checks are done in the browser only; the rules check the date format.
- Several admins acting at once can race (e.g. two approvals); the dashboard re-checks before approving.

## Tests
```powershell
node --test tests/*.test.js          # 18 logic tests (matching, validation, escaping, claim codes)
```
`tests/e2e/run.mjs` is a browser smoke test using Playwright and an **in-memory fake of Firebase** (not your real project): `node tests/e2e/run.mjs`.

### Test the security rules yourself (5 minutes, Firebase console -> Firestore -> Rules -> Rules Playground)
| Simulate | Expected |
|---|---|
| unauthenticated **get** `/contacts/x` | Denied |
| authenticated (any uid) **get** `/claims/x` | Denied |
| authenticated **list** `/claimStatus` | Denied |
| unauthenticated **get** `/claimStatus/ABCD-EFGH-JKLM` | Allowed (if it exists) |
| authenticated **update** `/items/x` setting `status` | Denied |
| the same as the admin uid (after step 6) | Allowed |
| Storage: upload `items/x/<32hex>.png` 5 MB, or a `.exe` | Denied |
