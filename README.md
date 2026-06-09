<div align="center">

<img src="docs/logo.svg" alt="LMS Loop logo" width="108" height="108">

# LMS Loop

**A zero-dependency Chrome extension that auto-progresses your way through an Open edX LMS.**

It watches each lesson, figures out what kind of content it is, handles it, and clicks **Next** — playing videos to a real completion, archiving documents into a local knowledge base, and solving (or skipping) quizzes along the way.

<p>
  <img alt="Manifest V3" src="https://img.shields.io/badge/Manifest-V3-4285F4?logo=googlechrome&logoColor=white">
  <img alt="Vanilla JS" src="https://img.shields.io/badge/JavaScript-Vanilla%20ES6%2B-F7DF1E?logo=javascript&logoColor=black">
  <img alt="No dependencies" src="https://img.shields.io/badge/dependencies-0-success">
  <img alt="No build step" src="https://img.shields.io/badge/build%20step-none-blueviolet">
  <img alt="Tests" src="https://img.shields.io/badge/tests-node%3Atest-43853D?logo=nodedotjs&logoColor=white">
</p>

</div>

---

> [!NOTE]
> Built and tested against **HUTECH eLearning**, which runs on **Open edX**. The DOM heuristics live in one tunable file (`config/selectors.js`), so adapting it to another edX-style LMS usually means editing selectors — not logic.

## ✨ Features

- 🎬 **Videos** — plays through at speed until the LMS records a genuine `ended` event, so completion actually sticks.
- 📄 **Documents** — extracts readable text into a local knowledge base as it goes.
- 🧠 **Quizzes** — solves them with an LLM when an API key is configured, or cleanly **skips** them when one isn't.
- 🧭 **Auto-navigation** — starts from a course overview and jumps straight to the first incomplete lesson.
- ✅ **Real completion, not fake clicks** — verifies each unit is marked complete after navigating; if not, it goes **Back** and retries (bounded).
- 🔒 **Sign-in gate** — Google OAuth with a Firebase-backed admin **whitelist** (emails are SHA-256 hashed; public reads never expose them).
- 🎨 **Polished popup** — dark/light themes and EN/VI localization.
- 🪶 **Zero runtime dependencies** — the folder *is* the unpacked extension. No bundler, no build step.

## 🧩 How a lesson gets handled

```
        ┌──────────────────────────────────────────────────────┐
        │  Top frame (parent)                                    │
        │  • owns Next / Back / badge / navigation               │
        │  • defers to the child when content lives in an iframe │
        └───────────────▲──────────────────────┬────────────────┘
                        │ ADVANCE (relayed)     │ navigate
            REQUEST_ADVANCE                     ▼
        ┌───────────────┴──────────────────────────────────────┐
        │  Child iframe (cross-origin edX content)              │
        │  ┌─────────┐   ┌──────────┐   ┌────────┐              │
        │  │  detect │──▶│  handle  │──▶│  ask   │              │
        │  │  type   │   │ video /  │   │ parent │              │
        │  └─────────┘   │ doc /quiz│   │to next │              │
        │                └──────────┘   └────────┘              │
        └───────────────────────────────────────────────────────┘
```

Open edX renders the lesson (including the `<video>`) inside a **cross-origin child iframe**, while the **Next** button lives in the parent. So content scripts run in **all frames**: the child handles what it can see and asks the top frame to advance; the top frame navigates. Every signal is scoped by a **lesson token** (the edX `vertical+block@<id>`, shared by both URLs) to prevent cross-lesson bleed.

**Completion is recorded by edX on navigation**, not from in-place playback — which is why the loop always verifies the *previous* unit on the *next* page and redoes it if needed.

## 🚀 Getting started

### 1. Load the extension

```text
1. Open chrome://extensions
2. Enable "Developer mode" (top-right)
3. Click "Load unpacked" and select this folder
```

> [!TIP]
> After any code change: click ↻ on the extension card **and refresh the LMS tab** — content scripts only re-inject on page load.

### 2. Configure (optional)

Open the popup and add an LLM API key if you want quizzes solved instead of skipped. Supported providers:

| Provider  | Used for      |
|-----------|---------------|
| OpenAI    | Quiz solving  |
| Anthropic | Quiz solving  |
| Gemini    | Quiz solving  |

No key? Quizzes are simply skipped — everything else still runs.

### 3. Run

Open your course and click **Start** in the popup. The loop binds to that tab.

> [!IMPORTANT]
> Closing the tab or **reloading the page** stops the loop. Already-completed lessons are skipped automatically.

## 🛠️ Development

```bash
# Run the unit tests (Node ≥ 18; repo uses 22)
node --test

# Syntax-check a single file
node --check path/to/file.js
```

### Testing philosophy

- **Unit-test only the pure logic** that needs no browser: `lib/auth.js`, `lib/llm_adapter.js`, and the pure helpers in `lib/storage.js` / `lib/dom_utils.js`. Hashing uses `crypto.subtle`, so the same code runs in Node and the browser.
- **Everything DOM / `chrome.*` / Firebase-bound is verified by hand** in the browser (content scripts, service worker, popup, admin app). Keep `node --test` green before committing.

## 🏛️ Architecture

The extension is **background-centric** — the service worker owns the hard parts:

- **`background/service_worker.js`** — run-state, storage, **all LLM `fetch`es** (content-script fetches are blocked by page CSP), the auth check, and cross-frame message relays.
- **Run scoping** — the loop binds to the tab where *Start* was clicked (`runState.tabId`). One run, one tab.
- **Auth gate** — `chrome.identity.getAuthToken` → verified email → SHA-256 → public-read Firestore `whitelist/{hash}`. The admin app manages the list with admin-only writes and hashed doc IDs, so public reads never leak emails.

## 🗂️ File map

| Path | Role |
|------|------|
| `manifest.json` | MV3 config — permissions, OAuth, content-script load order (matters!) |
| `background/service_worker.js` | Message router, run-state, LLM calls, auth, relays |
| `config/selectors.js` | **Tunable per-LMS heuristics** — tune here first when a new LMS misbehaves |
| `config/app_config.js` | Firebase / OAuth placeholders |
| `content/detector.js` | Classifies each lesson (video / doc / quiz / overview) |
| `content/content_video.js` · `content_doc.js` · `content_quiz.js` | Per-type handlers |
| `content/controller.js` | Orchestrator (loaded last) |
| `content/cursor.js` | Visual cursor / badge |
| `lib/` | `storage.js`, `dom_utils.js` (classic, `NS.dom`), `llm_adapter.js`, `auth.js` |
| `popup/` | Config UI + Google sign-in gate (themed, i18n) |
| `admin/` | Firebase-hosted whitelist admin page |
| `test/*.test.mjs` | Node unit tests |

## ⚙️ Stack & hard constraints

- **Vanilla ES6+ JS, plain HTML/CSS.** No framework, no bundler, no build step, zero runtime deps.
- `lib/*`, `background/`, `popup/` are **ES modules**. `content/*` + `config/selectors.js` are **classic scripts** sharing one isolated-world global, `window.__LMS` (alias `NS`) — they reference helpers via `NS.*` at call time (classic scripts can't `import`).
- Dev tests use Node's built-in **`node:test`** only. `package.json` has `{"type":"module"}` so Node parses `lib/*.js` as ESM; Chrome ignores `package.json`.

## 🔧 Manual / external setup

The Google-auth feature needs one-time setup the code can't do: create the Firebase project + Firestore + Google Auth, seed `admins/{email}`, generate the manifest `key` + OAuth client (Chrome Extension type), fill the placeholders in `config/app_config.js` / `manifest.json` / `admin/admin.js` / `.firebaserc`, then `firebase deploy`.

📖 Full steps: `docs/superpowers/plans/2026-06-08-google-auth-whitelist.md` (Phase 0).

## ⚠️ Responsible use

LMS Loop automates coursework. Use it only where automating your own progress is permitted — for accessibility, personal review, or platforms you administer. Respect your institution's academic-integrity policies and the LMS's terms of service. You're responsible for how you use it.

---

<div align="center">
<sub>Vanilla JS · Manifest V3 · No build step · Built for Open edX</sub>
</div>
