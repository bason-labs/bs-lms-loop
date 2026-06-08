# Google Sign-In + Admin Whitelist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the LMS Loop extension behind Google sign-in, allowing only accounts an admin has added to a Firebase-backed whitelist; provide a hosted admin page to manage that whitelist.

**Architecture:** The extension uses `chrome.identity.getAuthToken` to get the signed-in Chrome user's Google email, hashes it (SHA-256), and checks for a matching doc in a public-read Firestore `whitelist` collection. The whole popup is gated: not-signed-in → sign-in screen; signed-in-but-not-listed → "no access"; listed → the normal popup, and Start is blocked unless allowed. A separate static admin web app (Firebase Hosting + Firebase Auth) lets admins add/remove whitelist entries; entries are keyed by the email's SHA-256 hash (admin-only writes) so public reads never expose real emails.

**Tech Stack:** Vanilla JS (extension, unchanged stack), Web Crypto `crypto.subtle` (SHA-256), `chrome.identity`, Firestore REST (read), Firebase JS SDK v10 modular (admin page only), Firebase Hosting + Firestore Security Rules. Dev tests: Node's built-in `node:test`.

---

## Testing model

- **Automated (TDD):** the pure helpers in `lib/auth.js` (email normalize, SHA-256 hash, Firestore URL build, userinfo/whitelist response parsing) via `node --test`. Node 22's global `crypto.subtle` runs the same hashing code as the browser.
- **Browser-verified:** anything touching `chrome.identity`, live Firestore, the popup UI, and the admin page — each such task ends with a concrete manual checklist.

`lib/auth.js` is an **ES module** imported by the background worker and the popup (both module contexts). Content scripts are untouched.

---

## File Structure

| File | Responsibility | Loaded as |
|------|----------------|-----------|
| `config/app_config.js` | Firebase project id + OAuth client id constants (set in Phase 0) | ES module |
| `lib/auth.js` | Pure auth helpers + `getGoogleEmail`/`checkAccess`/`signOut` | ES module |
| `test/auth.test.mjs` | Unit tests for the pure helpers | dev-only |
| `manifest.json` | add `identity` permission, `oauth2`, `key`, host perms | — |
| `background/service_worker.js` | `CHECK_ACCESS`/`GET_AUTH`/`SIGN_OUT` messages; gate START | ES module worker |
| `popup/popup.html` | add a sign-in / no-access gate screen | — |
| `popup/popup.css` | gate screen styles | — |
| `popup/popup.js` | show gate vs app based on auth; sign-in/out wiring | module |
| `admin/index.html` | admin web app shell | Firebase Hosting page |
| `admin/admin.js` | Google sign-in + list/add/remove whitelist | Hosting page module |
| `admin/admin.css` | admin styling | — |
| `firestore.rules` | public read / admin write security rules | Firebase config |
| `firebase.json`, `.firebaserc` | Hosting + Firestore deploy config | Firebase config |

**Storage:** add an `auth` key to `chrome.storage.local`: `{ email, allowed, checkedAt }`.

**Message contract additions (popup → background):** `CHECK_ACCESS {interactive}` → `{allowed, email}`; `GET_AUTH` → `auth` object; `SIGN_OUT` → `{ok}`.

---

# PHASE 0 — Firebase + OAuth setup (manual, with committed config)

## Task 0: Create the Firebase project, OAuth client, and config files

**Files:**
- Create: `config/app_config.js`
- Create: `firebase.json`, `.firebaserc`, `firestore.rules`
- Create: `admin/.gitkeep`

- [ ] **Step 1: Firebase project + Firestore**

In the Firebase console (console.firebase.google.com): create a project (note the **Project ID**). Build → Firestore Database → Create database → production mode. Build → Authentication → Sign-in method → enable **Google**.

- [ ] **Step 2: Seed the admin + a test whitelist entry**

In Firestore, create collection `admins` with a document whose **ID is your admin Google email** (e.g. `ba.huynh@gradion.com`), fields: `{ role: "admin" }`. Leave `whitelist` empty for now (the admin page will fill it).

- [ ] **Step 3: OAuth client for the extension**

Load the extension unpacked once and copy its ID from `chrome://extensions`. To keep that ID stable, generate a key:
```bash
# from the project root — produces a stable key for manifest "key"
openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -outform DER | openssl base64 -A
```
Save the printed base64 string. In Google Cloud Console (the Firebase project's GCP project) → APIs & Services → Credentials → Create OAuth client ID → **Chrome Extension** → enter the extension ID. Copy the **Client ID**.

- [ ] **Step 4: Write `config/app_config.js`** (fill with YOUR real values from Steps 1 & 3)

```js
// config/app_config.js — project-specific configuration (set during Phase 0 setup).
export const FIREBASE_PROJECT_ID = 'your-firebase-project-id';
export const OAUTH_CLIENT_ID = 'your-oauth-client-id.apps.googleusercontent.com';
```
(The admin page's public web config lives separately in `admin/admin.js` — Task 7 — because Firebase Hosting only serves files under `admin/`.)

- [ ] **Step 5: Write `firestore.rules`**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    function isAdmin() {
      return request.auth != null
        && exists(/databases/$(db)/documents/admins/$(request.auth.token.email));
    }
    match /whitelist/{doc} {
      allow read: if true;        // extension reads one hashed doc; no emails exposed
      allow write: if isAdmin();  // only admins add/remove
    }
    match /admins/{email} {
      allow read: if isAdmin();
      allow write: if false;      // manage admins in the console
    }
  }
}
```

- [ ] **Step 6: Write `firebase.json` and `.firebaserc`**

`firebase.json`:
```json
{
  "firestore": { "rules": "firestore.rules" },
  "hosting": { "public": "admin", "ignore": ["firebase.json", "**/.*", "**/node_modules/**"] }
}
```
`.firebaserc` (replace with your project id):
```json
{ "projects": { "default": "your-firebase-project-id" } }
```

- [ ] **Step 7: Deploy rules** (requires `npm i -g firebase-tools` + `firebase login`)

Run: `firebase deploy --only firestore:rules`
Expected: "Deploy complete!"

- [ ] **Step 8: Commit**

```bash
mkdir -p admin && touch admin/.gitkeep
git add config/app_config.js firebase.json .firebaserc firestore.rules admin/.gitkeep
git commit -m "chore: Firebase project config + Firestore whitelist rules"
```

---

# PHASE 1 — Extension auth library (TDD)

## Task 1: Pure auth helpers

**Files:**
- Create: `lib/auth.js`
- Test: `test/auth.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/auth.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { normalizeEmail, emailHash, parseUserinfo, whitelistDocUrl, parseWhitelistDoc } from '../lib/auth.js';

test('normalizeEmail trims and lowercases', () => {
  assert.equal(normalizeEmail('  Foo@Bar.COM '), 'foo@bar.com');
  assert.equal(normalizeEmail(null), '');
});

test('emailHash is SHA-256 of the normalized email', async () => {
  const expected = createHash('sha256').update('a@b.com').digest('hex');
  assert.equal(await emailHash('  A@B.com '), expected);
});

test('parseUserinfo extracts a normalized, verified email or null', () => {
  assert.equal(parseUserinfo({ email: 'X@Y.com', email_verified: true }), 'x@y.com');
  assert.equal(parseUserinfo({ email: 'x@y.com' }), 'x@y.com');
  assert.equal(parseUserinfo({ email: 'x@y.com', email_verified: false }), null);
  assert.equal(parseUserinfo({}), null);
});

test('whitelistDocUrl points at the right Firestore document', () => {
  assert.equal(
    whitelistDocUrl('proj', 'abc123'),
    'https://firestore.googleapis.com/v1/projects/proj/databases/(default)/documents/whitelist/abc123'
  );
});

test('parseWhitelistDoc: allowed when doc exists and not explicitly inactive', () => {
  assert.deepEqual(parseWhitelistDoc(200, { fields: {} }), { allowed: true });
  assert.deepEqual(parseWhitelistDoc(200, { fields: { active: { booleanValue: false } } }), { allowed: false });
  assert.deepEqual(parseWhitelistDoc(404, { error: {} }), { allowed: false });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/auth.test.mjs`
Expected: FAIL — cannot find module `../lib/auth.js`.

- [ ] **Step 3: Implement `lib/auth.js`**

```js
// lib/auth.js — Google sign-in + Firestore whitelist check (ES module: background + popup).
import { FIREBASE_PROJECT_ID } from '../config/app_config.js';

// ---- pure helpers (unit-tested) ----
export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export async function emailHash(email) {
  const data = new TextEncoder().encode(normalizeEmail(email));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function parseUserinfo(json) {
  return json && json.email && json.email_verified !== false ? normalizeEmail(json.email) : null;
}

export function whitelistDocUrl(projectId, hash) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/whitelist/${hash}`;
}

export function parseWhitelistDoc(status, json) {
  if (status === 200 && json && json.fields) {
    const active = json.fields.active ? json.fields.active.booleanValue !== false : true;
    return { allowed: active };
  }
  return { allowed: false };
}

// ---- browser-only (chrome.identity + fetch) ----
export function getAuthToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      const err = chrome.runtime.lastError;
      if (err || !token) return reject(new Error(err?.message || 'no auth token'));
      resolve(token);
    });
  });
}

export async function getGoogleEmail(interactive = true) {
  const token = await getAuthToken(interactive);
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    chrome.identity.removeCachedAuthToken?.({ token });
    throw new Error(`userinfo HTTP ${res.status}`);
  }
  return parseUserinfo(await res.json());
}

export async function checkAccess(interactive = true) {
  const email = await getGoogleEmail(interactive);
  if (!email) return { allowed: false, email: null };
  const hash = await emailHash(email);
  const res = await fetch(whitelistDocUrl(FIREBASE_PROJECT_ID, hash));
  const json = await res.json().catch(() => null);
  return { ...parseWhitelistDoc(res.status, json), email };
}

export function signOut() {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (chrome.runtime.lastError || !token) return resolve();
      chrome.identity.removeCachedAuthToken({ token }, () => {
        fetch(`https://accounts.google.com/o/oauth2/revoke?token=${encodeURIComponent(token)}`).finally(resolve);
      });
    });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/auth.test.mjs`
Expected: PASS — 5 tests.

- [ ] **Step 5: Run the full suite**

Run: `node --test`
Expected: all prior tests + the 5 new ones pass.

- [ ] **Step 6: Commit**

```bash
git add lib/auth.js test/auth.test.mjs
git commit -m "feat: auth helpers — Google email + Firestore whitelist check (TDD)"
```

---

# PHASE 2 — Manifest + background gate

## Task 2: Manifest permissions and OAuth

**Files:**
- Modify: `manifest.json`

- [ ] **Step 1: Add `identity` permission, `oauth2`, `key`, and host permissions**

Add `"identity"` to `permissions`; add the Firestore/Google hosts to `host_permissions`; add top-level `oauth2` and `key`. The resulting `manifest.json` head should read:

```jsonc
{
  "manifest_version": 3,
  "name": "LMS Loop",
  "version": "0.1.0",
  "key": "PASTE_THE_BASE64_KEY_FROM_PHASE_0_STEP_3",
  "permissions": ["storage", "scripting", "activeTab", "tabs", "identity"],
  "host_permissions": [
    "<all_urls>",
    "https://api.openai.com/*",
    "https://api.anthropic.com/*",
    "https://generativelanguage.googleapis.com/*",
    "https://www.googleapis.com/*",
    "https://firestore.googleapis.com/*",
    "https://accounts.google.com/*"
  ],
  "oauth2": {
    "client_id": "PASTE_THE_OAUTH_CLIENT_ID_FROM_PHASE_0_STEP_3",
    "scopes": ["openid", "email", "profile"]
  },
  // …unchanged: background, action, content_scripts, icons
}
```
Keep every existing field (`background`, `action`, `content_scripts`, `icons`) exactly as-is.

- [ ] **Step 2: Verify the manifest parses and loads**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"`
Expected: `manifest ok`. Then reload unpacked in Chrome — no errors; the extension ID matches the one your OAuth client was created for.

- [ ] **Step 3: Commit**

```bash
git add manifest.json
git commit -m "feat: manifest identity/oauth2 + Google/Firestore host permissions"
```

## Task 3: Background access check + Start gate

**Files:**
- Modify: `background/service_worker.js`

- [ ] **Step 1: Import auth and storage helpers**

At the top of `background/service_worker.js`, add to the imports:
```js
import { checkAccess, signOut } from '../lib/auth.js';
```
(Keep the existing `import { ... } from '../lib/storage.js';` and `import { callLlm } …` lines.)

- [ ] **Step 2: Add the auth message cases to `handle()`**

Inside the `switch (msg?.type)` in `handle()`, add these cases (e.g. right after `GET_CONFIG`):
```js
    case 'GET_AUTH': return (await chrome.storage.local.get('auth')).auth || { allowed: false, email: null, checkedAt: 0 };
    case 'CHECK_ACCESS': {
      let result;
      try { result = await checkAccess(msg.interactive !== false); }
      catch (e) { result = { allowed: false, email: null, error: String(e?.message || e) }; }
      const auth = { email: result.email, allowed: !!result.allowed, checkedAt: Date.now(), error: result.error || null };
      await chrome.storage.local.set({ auth });
      return auth;
    }
    case 'SIGN_OUT': {
      await signOut();
      await chrome.storage.local.set({ auth: { allowed: false, email: null, checkedAt: 0 } });
      return { ok: true };
    }
```

- [ ] **Step 3: Gate START in `control()`**

Replace the `START`/`STEP` branch of `control()` so it re-verifies access before running:
```js
async function control(action, tabId) {
  if (action === 'STOP') return { ok: true, runState: await setRunState({ status: 'idle', tabId: null }) };
  if (action === 'START' || action === 'STEP') {
    // Re-check access silently; block the loop if the account isn't whitelisted.
    let access = { allowed: false, email: null };
    try { access = await checkAccess(false); } catch { /* fail closed */ }
    if (!access.allowed) {
      await chrome.storage.local.set({ auth: { email: access.email, allowed: false, checkedAt: Date.now(), error: null } });
      return { ok: false, error: 'NOT_AUTHORIZED' };
    }
    const runState = await setRunState({ status: 'running', error: null, tabId: tabId ?? null });
    if (tabId != null) chrome.tabs.sendMessage(tabId, { type: 'RESUME' }).catch(() => {});
    return { ok: true, runState };
  }
  throw new Error(`Bad control action: ${action}`);
}
```

- [ ] **Step 4: Verify in browser**

Reload the extension. Open the service-worker console and run:
`chrome.runtime.sendMessage({type:'CHECK_ACCESS', interactive:true}, console.log)` → a Google consent/picker appears once; result logs `{email, allowed:false, …}` (no whitelist entry yet). Add your email via the admin app (Phase 4) and re-run → `allowed:true`. With `allowed:false`, `chrome.runtime.sendMessage({type:'CONTROL',action:'START',tabId:<id>}, console.log)` returns `{ok:false,error:'NOT_AUTHORIZED'}`.

- [ ] **Step 5: Commit**

```bash
git add background/service_worker.js
git commit -m "feat: background CHECK_ACCESS/GET_AUTH/SIGN_OUT + gate Start on whitelist"
```

---

# PHASE 3 — Popup sign-in gate

## Task 4: Gate screen markup + styles

**Files:**
- Modify: `popup/popup.html`
- Modify: `popup/popup.css`

- [ ] **Step 1: Add the gate overlay to `popup.html`**

Immediately after `<body>` (before `<div class="grain">`), add:
```html
  <div id="gate" class="gate" hidden>
    <span class="mark" aria-hidden="true">BS</span>
    <h1 class="gate-title" id="gate-title">Sign in</h1>
    <p class="gate-sub" id="gate-sub">Use your authorized Google account to continue.</p>
    <button id="signin" class="power" type="button"><span class="power-label">Sign in with Google</span></button>
    <button id="signout" class="ghost" type="button" hidden>Sign out</button>
  </div>
  <div id="app" hidden>
```
Then add a single closing `</div>` for `#app` immediately before the closing `<script type="module" src="popup.js"></script>` line at the end of the body, so the entire existing UI (header through footer) is wrapped in `#app`.

- [ ] **Step 2: Add gate styles to `popup.css`**

Append:
```css
.gate {
  display: grid;
  justify-items: center;
  text-align: center;
  gap: 8px;
  padding: 28px 18px 22px;
}
.gate .mark { width: 40px; height: 40px; font-size: 18px; border-radius: 11px; margin-bottom: 4px; }
.gate-title { font-family: var(--display); font-weight: 600; font-size: 22px; margin: 4px 0 0; color: var(--fg); }
.gate-sub { margin: 0 0 14px; font-size: 12px; color: var(--muted); max-width: 240px; }
.gate .power { width: auto; padding: 11px 18px; }
.gate .ghost { margin-top: 6px; }
.gate[data-state="denied"] .gate-title { color: var(--danger); }
```

- [ ] **Step 3: Commit**

```bash
git add popup/popup.html popup/popup.css
git commit -m "feat(popup): add sign-in / no-access gate screen"
```

## Task 5: Popup gate logic

**Files:**
- Modify: `popup/popup.js`

- [ ] **Step 1: Add gate rendering + wiring**

Add this block near the top of `popup.js` (after the `$` helper) — it shows the gate vs the app based on auth state:
```js
function showGate(auth) {
  const allowed = !!auth?.allowed;
  $('gate').hidden = allowed;
  $('app').hidden = !allowed;
  if (allowed) return;
  const denied = auth && auth.email && !auth.allowed;
  $('gate').dataset.state = denied ? 'denied' : 'signedout';
  $('gate-title').textContent = denied ? 'No access' : 'Sign in';
  $('gate-sub').textContent = denied
    ? `${auth.email} isn't on the allowed list. Ask an admin to add it.`
    : 'Use your authorized Google account to continue.';
  $('signin').querySelector('.power-label').textContent = denied ? 'Try another account' : 'Sign in with Google';
  $('signout').hidden = !denied;
}

async function refreshAuth(interactive) {
  const type = interactive ? 'CHECK_ACCESS' : 'GET_AUTH';
  const auth = await chrome.runtime.sendMessage({ type, interactive }).catch(() => null);
  showGate(auth);
  return auth;
}
```

- [ ] **Step 2: Wire the gate buttons**

Add these listeners (next to the other `addEventListener` calls):
```js
let polling = false;
function startPolling() {
  if (polling) return; // idempotent — never stack intervals
  polling = true;
  refresh();
  setInterval(refresh, 1500);
}

$('signin').addEventListener('click', async () => {
  $('gate-sub').textContent = 'Checking…';
  const auth = await refreshAuth(true);
  if (auth?.allowed) startPolling(); // begin live status once authorized via the gate
});
$('signout').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'SIGN_OUT' }).catch(() => {});
  await refreshAuth(false);
});
```

- [ ] **Step 3: Gate the boot sequence**

In the boot IIFE at the bottom of `popup.js`, after `fill(await getConfig())` and the `inert` line, add a cached-auth check before starting the status poll:
```js
  const auth = await refreshAuth(false);   // cached; no Google prompt on open
  if (!auth?.allowed) return;               // stay on the gate until signed in
  startPolling();
```
`startPolling()` (defined with the sign-in handler) starts the live status poll; it's idempotent so the gate sign-in path and boot both call it safely.

- [ ] **Step 4: Handle the START "not authorized" response**

In `control(action)`, after sending the `CONTROL` message, handle the gate flip — replace the response handling with:
```js
  const res = await chrome.runtime.sendMessage({ type: 'CONTROL', action, tabId }).catch((e) => ({ error: String(e) }));
  if (res?.error === 'NOT_AUTHORIZED') { await refreshAuth(false); return; }
  if (res?.runState) applyStatus(res.runState);
  else applyStatus({ status: 'error', error: res?.error || 'no response' });
```

- [ ] **Step 5: Verify in browser**

Reload the extension. Open the popup with no whitelist entry → the **gate** shows "Sign in". Click **Sign in with Google**, pick your account → it shows **"No access"** with your email + a Sign out button. Add your email in the admin app (Phase 4), reopen the popup (or click Sign in again) → the **full app** appears and Start works.

- [ ] **Step 6: Commit**

```bash
git add popup/popup.js
git commit -m "feat(popup): gate UI on Google sign-in + whitelist, handle NOT_AUTHORIZED"
```

---

# PHASE 4 — Admin web app

## Task 6: Admin page shell + styles

**Files:**
- Create: `admin/index.html`
- Create: `admin/admin.css`

- [ ] **Step 1: Write `admin/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LMS Loop — Access Admin</title>
  <link rel="stylesheet" href="admin.css">
</head>
<body>
  <header class="bar">
    <span class="brand">LMS Loop · Access</span>
    <span class="spacer"></span>
    <span id="who" class="who"></span>
    <button id="auth-btn" class="btn">Sign in</button>
  </header>

  <main class="wrap">
    <section id="gate" class="card">
      <p>Sign in with an admin Google account to manage the whitelist.</p>
    </section>

    <section id="panel" class="card" hidden>
      <h2>Allowed accounts</h2>
      <form id="add-form" class="add-row">
        <input id="email" class="input" type="email" placeholder="user@example.com" required>
        <button class="btn primary" type="submit">Add</button>
      </form>
      <p id="msg" class="msg"></p>
      <table class="list">
        <thead><tr><th>Email</th><th>Added</th><th></th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </section>
  </main>

  <script type="module" src="admin.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `admin/admin.css`**

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; color: #0f172a; background: #f7f8fa; }
.bar { display: flex; align-items: center; gap: 12px; padding: 12px 20px; background: #06100f; color: #e0ffff; }
.brand { font-weight: 700; letter-spacing: .02em; }
.spacer { flex: 1; }
.who { font-size: 13px; color: #7aa8a8; }
.wrap { max-width: 720px; margin: 24px auto; padding: 0 16px; }
.card { background: #fff; border: 1px solid #e3e7ec; border-radius: 12px; padding: 18px; box-shadow: 0 8px 24px -16px rgba(0,0,0,.3); }
h2 { margin: 0 0 12px; font-size: 16px; }
.add-row { display: flex; gap: 8px; margin-bottom: 8px; }
.input { flex: 1; padding: 9px 11px; border: 1px solid #c4d7d1; border-radius: 8px; font-size: 14px; }
.btn { padding: 8px 14px; border: 1px solid #c4d7d1; background: #fff; border-radius: 8px; cursor: pointer; font-weight: 600; }
.btn.primary { background: #15a3c7; border-color: #15a3c7; color: #fff; }
.msg { min-height: 18px; font-size: 13px; color: #c92d3a; }
.list { width: 100%; border-collapse: collapse; font-size: 14px; }
.list th, .list td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #eef1f4; }
.list .rm { color: #c92d3a; cursor: pointer; border: 0; background: none; font-weight: 600; }
```

- [ ] **Step 3: Commit**

```bash
git add admin/index.html admin/admin.css
git commit -m "feat(admin): whitelist admin page shell + styles"
```

## Task 7: Admin logic (Google sign-in + Firestore CRUD)

**Files:**
- Create: `admin/admin.js`

- [ ] **Step 1: Write `admin/admin.js`**

```js
// admin/admin.js — admin whitelist manager (Firebase modular SDK via CDN).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, collection, doc, setDoc, deleteDoc, getDocs, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// Public web config (safe to commit) — from Firebase console → Project settings → Web app.
const FIREBASE_WEB_CONFIG = {
  apiKey: 'your-web-api-key',
  authDomain: 'your-firebase-project-id.firebaseapp.com',
  projectId: 'your-firebase-project-id'
};

const app = initializeApp(FIREBASE_WEB_CONFIG);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);

const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
async function emailHash(email) {
  const data = new TextEncoder().encode(normalizeEmail(email));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const mask = (email) => email.replace(/^(.).*(@.*)$/, (_, a, b) => `${a}***${b}`);

$('auth-btn').addEventListener('click', async () => {
  if (auth.currentUser) await signOut(auth).catch((e) => { $('msg').textContent = e.message; });
  else signInWithPopup(auth, new GoogleAuthProvider()).catch((e) => { $('msg').textContent = e.message; });
});

onAuthStateChanged(auth, async (user) => {
  $('who').textContent = user ? user.email : '';
  $('auth-btn').textContent = user ? 'Sign out' : 'Sign in';
  $('gate').hidden = !!user;
  $('panel').hidden = !user;
  if (user) { try { await render(); } catch (e) { $('msg').textContent = `Not an admin? ${e.message}`; } }
});

$('add-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const email = normalizeEmail($('email').value);
  if (!email) return;
  $('msg').textContent = '';
  try {
    await setDoc(doc(db, 'whitelist', await emailHash(email)), {
      emailMasked: mask(email), addedBy: auth.currentUser.email, addedAt: serverTimestamp(), active: true
    });
    $('email').value = '';
    await render();
  } catch (e) { $('msg').textContent = e.message; }
});

async function render() {
  const snap = await getDocs(collection(db, 'whitelist'));
  const rows = $('rows');
  rows.innerHTML = '';
  snap.forEach((d) => {
    const v = d.data();
    const tr = document.createElement('tr');
    const when = v.addedAt?.toDate ? v.addedAt.toDate().toLocaleDateString() : '';
    const tdEmail = document.createElement('td');
    tdEmail.textContent = v.emailMasked || '(hidden)';   // textContent — never inject Firestore strings as HTML
    const tdWhen = document.createElement('td');
    tdWhen.textContent = when;
    tr.append(tdEmail, tdWhen);
    const td = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = 'rm'; btn.textContent = 'Remove';
    btn.addEventListener('click', async () => {
      try { await deleteDoc(doc(db, 'whitelist', d.id)); await render(); }
      catch (e) { $('msg').textContent = e.message; }
    });
    td.appendChild(btn); tr.appendChild(td); rows.appendChild(tr);
  });
}
```

- [ ] **Step 2: Deploy hosting**

Run: `firebase deploy --only hosting`
Expected: "Deploy complete!" with a Hosting URL (e.g. `https://your-project.web.app`).

- [ ] **Step 3: Verify the admin flow in the browser**

Open the Hosting URL → click **Sign in** → choose the Google account you seeded in `admins` (Phase 0 Step 2). The panel appears. Add an email → a row appears (masked). In the Firebase console, confirm a `whitelist/<64-hex-id>` doc exists with `emailMasked`. Signing in with a **non-admin** account shows a permissions error and no panel write.

- [ ] **Step 4: End-to-end check with the extension**

Add your own Google email in the admin app. In the extension popup, click **Sign in with Google** → the full app appears and **Start** works. Remove the email in the admin app, reopen the popup → it returns to **No access**.

- [ ] **Step 5: Commit**

```bash
git add admin/admin.js
git commit -m "feat(admin): Google sign-in + Firestore whitelist add/list/remove"
```

---

## Final verification

- [ ] `node --test` → all tests pass (existing suite + the 5 auth tests).
- [ ] `node --check lib/auth.js background/service_worker.js popup/popup.js admin/admin.js` → clean.
- [ ] Extension: not signed in → gate; signed in + not listed → "No access"; listed → full app, Start works; removing the email revokes access on next open/Start.
- [ ] Admin: only seeded admin accounts can add/remove; entries are stored hashed (no raw emails under public read).

## Notes / decisions

- **Why hashed doc ids:** the `whitelist` collection is public-read so the extension can check without authenticating to Firebase. Keying docs by `sha256(email)` means a public reader can't list real emails or test arbitrary ones without already knowing them. Only masked emails are stored for the admin's display.
- **Free tier:** Firestore reads/writes at this scale and Firebase Hosting are within the Spark (free) plan; no Cloud Functions/billing required.
- **Chrome-only:** `chrome.identity.getAuthToken` uses the Chrome profile's Google account. (A `launchWebAuthFlow` variant would be needed for other Chromium browsers — out of scope.)
- **Admin bootstrapping:** the first admin is added by creating an `admins/{email}` doc in the Firebase console; the rules intentionally forbid client writes to `admins`.
