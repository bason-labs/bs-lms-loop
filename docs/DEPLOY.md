# Deploying LMS Loop to the Chrome Web Store

Everything here that lives in the repo is already prepared. The remaining steps need
the Web Store dashboard and Google Cloud — they can't be done from code.

## What's already set up in the repo ✅

- **Packaging script** — `build/package.sh` produces a clean upload zip with only the
  runtime files, and refuses to build while `PASTE_THE_*` placeholders remain.
- **Privacy policy** — `PRIVACY.md` (host it and link it in the listing).
- **Listing copy + permission justifications** — `docs/STORE_LISTING.md`.

## What you must do manually 🔧

### 0. Prerequisites
- A Chrome Web Store **developer account** ($5 one-time): https://chrome.google.com/webstore/devconsole

### 1. Manifest `key`
`manifest.json` holds a `"key"` only to keep a stable local-dev extension ID; `build/package.sh`
strips it for the store build (the store assigns the ID itself).

### 2. Build the package
```bash
bash build/package.sh
# → build/lms-loop-<version>.zip
```
(Bump `version` in `manifest.json` for each new upload — the store rejects duplicate versions.)

### 3. Upload
Upload the zip in the dashboard.

### 4. Complete the listing
Use `docs/STORE_LISTING.md`:
- Name, summary, description, category, language.
- Upload **screenshots** (1280×800) and the icons (already in `icons/`).
- **Privacy policy URL** — host `PRIVACY.md` (e.g. GitHub Pages) and paste the URL.
- **Privacy practices tab** — paste the permission justifications; declare data usage
  (no personal data collected; nothing sold) and "no remote code."
- **Single purpose** — see the listing doc.

### 5. Set visibility & submit
- Visibility: **Public** (as chosen). Submit for review (usually a few days).

## ⚠️ Policy heads-up (Public listing)
An extension that auto-completes coursework can be flagged under the Web Store's
"deceptive/illegitimate use" and "respect other services" policies. To reduce rejection risk:
- Frame the listing around **review, accessibility, and personal productivity** (done in the copy).
- **Narrow the host permissions** to the specific LMS domain you target (see below) — broad
  `<all_urls>` access draws heavy review scrutiny.
- If rejected, consider **Unlisted** or **Private (trusted testers / Workspace domain)** instead.

## Scoping to a specific LMS domain (recommended before submitting)
The manifest ships with broad `<all_urls>` access so it works on any Open edX site. For a
smoother review, scope it to your LMS. In `manifest.json`, replace `<all_urls>` in BOTH
`content_scripts[0].matches` and `host_permissions` with your domain pattern, e.g.
`"https://*.your-lms.edu/*"`. If the LMS serves the lesson body from a different origin
(a CDN/subdomain), add that origin too. Verify by loading unpacked and watching the loop
run end-to-end first, then rebuild.
