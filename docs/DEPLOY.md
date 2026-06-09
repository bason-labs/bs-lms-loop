# Deploying LMS Loop to the Chrome Web Store

Everything here that lives in the repo is already prepared. The remaining steps need
the Web Store dashboard and Google Cloud — they can't be done from code.

## What's already set up in the repo ✅

- **Scoped permissions** — `manifest.json` is narrowed to `https://*.hutech.edu.vn/*`
  (content scripts + host access), instead of `<all_urls>`. Smoother review.
- **Packaging script** — `build/package.sh` produces a clean upload zip with only the
  runtime files, and refuses to build while `PASTE_THE_*` placeholders remain.
- **Privacy policy** — `PRIVACY.md` (host it and link it in the listing).
- **Listing copy + permission justifications** — `docs/STORE_LISTING.md`.

## What you must do manually 🔧

### 0. Prerequisites
- A Chrome Web Store **developer account** ($5 one-time): https://chrome.google.com/webstore/devconsole
- Complete the Firebase/OAuth one-time setup if not done — see
  `docs/superpowers/plans/2026-06-08-google-auth-whitelist.md` (Phase 0).

### 1. Fill the manifest placeholders
`manifest.json` still has two placeholders that block publishing:
- `"key"` → the base64 public key (from the dashboard after first upload, or generated in Phase 0).
- `"oauth2.client_id"` → your Chrome-Extension-type OAuth client ID.
Also fill `config/app_config.js` (`FIREBASE_PROJECT_ID`, `OAUTH_CLIENT_ID`).

> The OAuth client requires the extension's **permanent ID**, which the store assigns on
> first upload. This creates a chicken-and-egg — resolve it in step 3.

### 2. Build the package
```bash
bash build/package.sh
# → build/lms-loop-<version>.zip
```
(Bump `version` in `manifest.json` for each new upload — the store rejects duplicate versions.)

### 3. First upload → get the Extension ID (resolves the OAuth loop)
1. Upload the zip in the dashboard. The store assigns a **permanent Extension ID** + public key.
2. In **Google Cloud Console → Credentials**, create/confirm an **OAuth client of type
   "Chrome Extension"** using that ID.
3. Put that `client_id` into `manifest.json` (`oauth2.client_id`) and the assigned public
   key into `"key"`. Rebuild (`build/package.sh`) and re-upload.

### 4. Complete the listing
Use `docs/STORE_LISTING.md`:
- Name, summary, description, category, language.
- Upload **screenshots** (1280×800) and the icons (already in `icons/`).
- **Privacy policy URL** — host `PRIVACY.md` (e.g. on your Firebase site) and paste the URL.
- **Privacy practices tab** — paste the permission justifications; declare data usage
  (auth email used locally/hashed; nothing sold) and "no remote code."
- **Single purpose** — see the listing doc.

### 5. Set visibility & submit
- Visibility: **Public** (as chosen). Submit for review (usually a few days).

## ⚠️ Policy heads-up (Public listing)
An extension that auto-completes coursework can be flagged under the Web Store's
"deceptive/illegitimate use" and "respect other services" policies. To reduce rejection risk:
- Frame the listing around **review, accessibility, and personal productivity** (done in the copy).
- Keep permissions narrow (done).
- If rejected, consider **Unlisted** or **Private (trusted testers / Workspace domain)** instead.

## If the lesson iframe is served from another origin
The content scripts run in all frames but only match `*.hutech.edu.vn`. If HUTECH serves
the Open edX lesson body from a different host (a CDN/subdomain outside `hutech.edu.vn`),
add that origin to BOTH `content_scripts.matches` and `host_permissions` in `manifest.json`,
then rebuild. Verify by loading unpacked and watching the loop run end-to-end first.
