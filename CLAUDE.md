# CLAUDE.md

Guidance for working in this repo.

## What this is

**LMS Loop** — a Manifest V3 Chrome extension that auto-progresses an LMS (built/tested against **HUTECH eLearning**, which is **Open edX**). It detects each lesson's type, handles it, and clicks Next:
- **Video** → play through at speed to a real `ended` so the LMS records completion.
- **Document** → extract readable text into a local knowledge base.
- **Quiz** → AI solve (when configured) or **skip** when no API key.

Plus: a Google **sign-in gate** with a Firebase-backed admin **whitelist** (feature code complete; Firebase/OAuth setup is manual — see below).

## Stack & hard constraints

- **Vanilla ES6+ JS, plain HTML/CSS. No framework, no bundler, no build step, zero runtime deps.** The folder *is* the unpacked extension.
- `lib/*` and `background/`, `popup/` are **ES modules**. `content/*` + `config/selectors.js` are **classic scripts** loaded together via `manifest.content_scripts` and share one isolated-world global, `window.__LMS` (alias `NS`). Classic scripts CANNOT `import`; reference helpers via `NS.*` at call time.
- Dev tests use Node's built-in **`node:test`** only (Node ≥18; repo uses 22). `package.json` has `{"type":"module"}` so Node parses `lib/*.js` as ESM. Chrome ignores `package.json`.

## Commands

- **Test:** `node --test` (run from repo root). Keep it green before committing.
- **Syntax-check a file:** `node --check path/to/file.js`
- **Load in Chrome:** `chrome://extensions` → Developer mode → Load unpacked → this folder.
- **Reload after a change:** click ↻ on the extension card **and refresh the LMS tab** (content scripts only re-inject on page load).

## Testing model (important)

- **Unit-test (TDD) only the pure logic** that needs no browser: `lib/auth.js`, `lib/llm_adapter.js`, and the pure helpers in `lib/storage.js` / `lib/dom_utils.js`. Hashing uses `crypto.subtle` so the same code runs in Node and the browser.
- **Everything DOM/`chrome.*`/Firebase-bound is browser-verified by the human** (content scripts, service-worker wiring, popup, admin app). Don't try to unit-test those — add a clear manual checklist instead.

## Architecture

- **Background-centric:** the service worker (`background/service_worker.js`) owns run-state, storage, all LLM `fetch`es (content-script fetches are blocked by page CSP), the auth check, and cross-frame message relays.
- **Content scripts run in ALL frames** (`all_frames: true`). Open edX renders the lesson (incl. the `<video>`) in a cross-origin child iframe while Next lives in the parent, so:
  - The **child frame** handles the media/quiz it can see, then asks the top frame to advance (`REQUEST_ADVANCE` → relayed as `ADVANCE`).
  - The **top frame** navigates/stops/shows the badge. It defers to the child when content is in an iframe.
  - Signals are scoped by a **lesson token** (the edX `vertical+block@<id>`, shared by parent + iframe URLs) to avoid cross-lesson bleed.
- **Completion is recorded by edX on navigation**, not from in-place playback: finish video → click Next → on the next page verify the prior unit is marked complete; if not, go **Back** and redo (bounded retries).
- **Run scoping:** the loop binds to the tab where Start was clicked (`runState.tabId` + `isTargetTab`). Closing that tab or **reloading the page** stops the loop. Already-completed lessons are skipped.
- **Auth gate:** popup is gated behind Google sign-in (`chrome.identity.getAuthToken` → verified email → SHA-256 → public-read Firestore `whitelist/{hash}`). Admin app (`admin/`) manages the whitelist (admin-only writes, hashed doc ids so public reads never expose emails).

## File map

- `manifest.json` — MV3 config (permissions, oauth2, content_scripts order matters).
- `background/service_worker.js` — message router, run-state, LLM calls, auth, relays.
- `lib/` — `storage.js`, `dom_utils.js` (classic, `NS.dom`), `llm_adapter.js`, `auth.js`.
- `content/` — `cursor.js`, `detector.js`, `content_video.js`, `content_doc.js`, `content_quiz.js`, `controller.js` (orchestrator, loaded last), `content.css`.
- `config/selectors.js` — **tunable per-LMS heuristics** (next/prev/submit/content selectors). Tune here first when a new LMS misbehaves; avoid hardcoding selectors in logic.
- `popup/` — config UI + Google sign-in gate (themed to bs-kara: dark/light, EN/VI i18n).
- `admin/` — Firebase-hosted whitelist admin page.
- `test/*.test.mjs` — Node unit tests.
- `docs/superpowers/specs|plans/` — design spec + implementation plans (source of truth for intent).

## Conventions

- Match the surrounding style; keep files small and single-purpose.
- Content-side helpers go on `NS.*` (e.g. `NS.dom`, `NS.detector`, `NS.video`); they're available at call time regardless of script order.
- Per-LMS DOM strings belong in `config/selectors.js`, not in logic.
- Conventional-commit messages (`feat:`, `fix:`, `chore:`, `docs:`, `style:`). Commit only when asked; this project works on the `feat/lms-loop-extension` branch.
- Keep `node --test` green; `node --check` any JS you touch.

## Manual / external setup (not in code)

The Google-auth feature needs one-time setup the code can't do: create the Firebase project + Firestore + Google Auth, seed `admins/{email}`, generate the manifest `key` + OAuth client (Chrome Extension type), fill placeholders in `config/app_config.js` / `manifest.json` / `admin/admin.js` / `.firebaserc`, then `firebase deploy`. Full steps: `docs/superpowers/plans/2026-06-08-google-auth-whitelist.md` (Phase 0).
