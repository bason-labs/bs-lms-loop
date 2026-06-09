# LMS Loop — Chrome Extension Design Spec

**Date:** 2026-06-08
**Status:** Approved for planning
**Author:** bason-labs

## 1. Overview

A Manifest V3 Chrome Extension that automates progress through a **dynamic/unknown LMS**.
It classifies the current lesson by reading the live DOM and handles three lesson types:

1. **Video lessons** — set playback rate / seek to end, wait for the real completion
   trigger (not a fixed timer), then click "Next".
2. **Document lessons** — extract readable text (main content, same-origin iframes, PDF
   links/embeds) into a local knowledge base used later as RAG context.
3. **Quiz lessons** — conditional branching:
   - **API key present:** scrape question + options, send to the background worker, which
     calls the configured LLM with RAG context, returns a structured answer; the content
     script maps it to the right input, selects/fills, submits, clicks "Next".
   - **No API key:** fallback per config — `skip` (just Next) or `random` fill to force
     unlock — then submit + Next.

The extension is designed for **maximum navigation resilience**: it handles both SPA
(no reload) and full-page-reload navigation, classifies lesson type dynamically, and fills
whatever input shapes appear (radio, checkbox/multi-select, text).

## 2. Constraints & Stack

- **Manifest V3**, strict compliance: service worker background, no remote/eval'd code.
- **No framework, no build step, no bundler, zero runtime dependencies.** Vanilla ES6+ JS,
  plain HTML + CSS. The folder *is* the unpacked extension (`Load unpacked`).
- `lib/*` are native **ES modules** (imported by the `"type":"module"` service worker and
  the popup). `content/*` + `config/selectors.js` are **classic scripts** sharing one
  isolated-world global (`window.__LMS`), so they need no message-passing among themselves.
- Persistence via `chrome.storage.local`.
- Optional dev-only tooling (ESLint/Prettier, zip packaging) is explicitly **out of scope**
  for v0.1 and not shipped in the extension.

## 3. Key Architectural Decision — LLM fetch lives in the background worker

A content-script `fetch` to an LLM endpoint is governed by the **LMS page's
Content-Security-Policy** (`connect-src`), which most LMS platforms lock down — calls get
blocked. A **background service-worker** fetch uses the extension's `host_permissions` and
**bypasses page CSP**. It also makes run-state survive full-page reloads, since the worker +
`chrome.storage` are the source of truth (the content script is destroyed on reload).

Therefore:
- **Content scripts are thin** — scrape and actuate the DOM only.
- **Background worker owns** run-state, storage orchestration, and **all** LLM fetches.
- Content → background via `chrome.runtime.sendMessage` for `SOLVE_QUIZ`,
  `SAVE_LESSON_TEXT`, `UPDATE_RUNSTATE`, `GET_CONFIG`, `CONTROL`.

Rejected alternatives: content-centric (breaks on CSP, loses state on reload); offscreen
document for fetch (unnecessary complexity).

## 4. File Tree

```
bs-lms-loop/
├── manifest.json
├── README.md
├── icons/
│   ├── icon16.png  ├── icon48.png  └── icon128.png
│
├── popup/
│   ├── popup.html          # provider select, API key, mode toggles, Start/Stop, status
│   ├── popup.css
│   └── popup.js            # reads/writes config, sends control msgs to background
│
├── background/
│   └── service_worker.js   # "type":"module" — state machine owner + message router + LLM
│
├── content/                # injected together, share window.__LMS namespace
│   ├── controller.js       # per-page orchestrator (listed last)
│   ├── detector.js         # classify lesson: video | doc | quiz | unknown
│   ├── content_video.js    # video detection, speed/seek, completion monitoring
│   ├── content_doc.js      # text/PDF/iframe extraction → storage
│   ├── content_quiz.js     # scrape Q+options, request answer, fill inputs, submit
│   └── content.css         # floating status badge overlay
│
├── lib/                    # shared helpers (see per-file loading notes below)
│   ├── llm_adapter.js      # ES module — imported by service_worker.js
│   ├── storage.js          # ES module — imported by service_worker.js AND popup.js
│   └── dom_utils.js        # classic script — loaded in the content bundle (window.__LMS)
│
└── config/
    └── selectors.js        # tunable heuristic profiles (classic script in content bundle)
```

Note: `dom_utils.js` is used by content scripts; it is authored as a classic script and
listed in the `content_scripts.js` array (attaching helpers to `window.__LMS`). It is *not*
imported as an ES module by content scripts. The service worker has its own module-scoped
helpers where needed.

## 5. manifest.json

```jsonc
{
  "manifest_version": 3,
  "name": "LMS Loop",
  "version": "0.1.0",
  "permissions": ["storage", "scripting", "activeTab", "tabs"],
  "host_permissions": [
    "<all_urls>",
    "https://api.openai.com/*",
    "https://api.anthropic.com/*",
    "https://generativelanguage.googleapis.com/*"
  ],
  "background": { "service_worker": "background/service_worker.js", "type": "module" },
  "action": { "default_popup": "popup/popup.html" },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": [
      "config/selectors.js",
      "lib/dom_utils.js",
      "content/detector.js",
      "content/content_video.js",
      "content/content_doc.js",
      "content/content_quiz.js",
      "content/controller.js"
    ],
    "css": ["content/content.css"],
    "run_at": "document_idle"
  }],
  "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
}
```

`<all_urls>` satisfies the generic requirement and can be narrowed to specific LMS origins
later. No `web_accessible_resources` needed (no page-world injection).

## 6. File Responsibilities

- **popup/popup.html + popup.js** — Select provider, enter/validate API key (with a
  "Test key" button that asks background to do a minimal probe call), toggle `auto` vs `step`
  mode, set video playback rate and quiz-fallback behavior, Start/Stop. `popup.js` imports
  `lib/storage.js` to persist `config`, sends `START`/`STOP`/`STEP` `CONTROL` messages, and
  renders live `runState`.
- **background/service_worker.js** — Owns the run-state machine; the only place LLM fetches
  happen. Message router for `GET_CONFIG`, `SOLVE_QUIZ`, `SAVE_LESSON_TEXT`,
  `UPDATE_RUNSTATE`, `CONTROL`. On `SOLVE_QUIZ`, assembles RAG context from `kb`, calls
  `llm_adapter`, returns a structured answer. Persists `runState`. Re-asserts the loop after
  navigation via `chrome.tabs.onUpdated`.
- **content/detector.js** — Heuristic classifier returning `{type, confidence, nodes}`:
  `video` if a seekable/playing `<video>` (or known player iframe) exists; `quiz` if a
  form/container with radio/checkbox groups or answer inputs + a submit control; else `doc`.
  Uses `config/selectors.js` profiles with generic fallbacks.
- **content/content_video.js** — Sets `playbackRate`, optionally seeks `currentTime →
  duration`, monitors for the real completion trigger (Next enabling / progress event / DOM
  mutation) via `MutationObserver` rather than fixed sleeps. Reports completion.
- **content/content_doc.js** — Extracts readable text from main content node, same-origin
  iframes, and PDF links/embeds (records URL + visible text; deep PDF parsing is optional and
  deferred). Sends `SAVE_LESSON_TEXT` keyed by derived `lessonId`.
- **content/content_quiz.js** — Scrapes question stem + each option's text and input element.
  Key present → `SOLVE_QUIZ` round-trip, map answer back to input, click (radio/checkbox) or
  type (text), submit, Next. No key → fallback (`skip` or `random` fill → submit → Next). All
  clicks via `dom_utils` simulated events.
- **content/controller.js** — Per-page orchestrator. On load: read `runState` + `config`; if
  running, `detector` → matching handler → on success `UPDATE_RUNSTATE` and click Next; then
  react to SPA mutations (re-run) or let reload re-inject and resume. Renders status badge.
- **lib/llm_adapter.js** — Provider-agnostic. `buildRequest(provider, {model, key, baseUrl},
  messages)` → `{url, headers, body}` per provider (OpenAI `chat/completions`, Bearer;
  Anthropic `messages`, `x-api-key` + `anthropic-dangerous-direct-browser-access`; Gemini key
  as query param; `custom` via `baseUrl`). `parseResponse(provider, json)` normalizes to text.
  Prompts the model to return strict JSON `{answerIndices, answerText, reason}`.
- **lib/storage.js** — Typed get/set wrappers for `config` / `kb` / `runState`;
  `deriveLessonId(url, title)` for stable keys; KB append preserving `order`.
- **lib/dom_utils.js** — `waitFor(selectorOrFn)`, `clickByText(candidates)`,
  `simulateClick(el)`, robust query helpers. Shared via `window.__LMS`.
- **config/selectors.js** — Editable heuristic profiles: next-button text candidates
  (`["Next","Continue","Tiếp","次へ", ...]`), submit candidates, option/container selectors,
  plus a generic fallback profile. The tuning knob without touching logic.

## 7. Storage Schemas (`chrome.storage.local`)

```jsonc
// USER CONFIG
"config": {
  "enabled": false,
  "mode": "auto",                       // "auto" | "step"
  "llm": {
    "provider": "openai",               // "openai" | "anthropic" | "gemini" | "custom"
    "apiKey": "",
    "model": "gpt-4o-mini",
    "baseUrl": "",                       // used only for "custom"
    "temperature": 0
  },
  "video": { "skipToEnd": true, "playbackRate": 16, "waitForTriggerMs": 1500 },
  "quiz":  { "useAiWhenKeyPresent": true, "fallback": "random", "forceSubmit": true }, // fallback: "skip" | "random"
  "delays": { "betweenLessonsMs": 1200, "actionMs": 400 }
}

// ACCUMULATED KNOWLEDGE BASE (RAG source)
"kb": {
  "courseId": "<derived-from-origin+path>",
  "order": ["<lessonId>", "..."],
  "lessons": {
    "<lessonId>": {
      "id": "<lessonId>",
      "title": "Intro to X",
      "type": "doc",                    // "doc" | "video" | "quiz"
      "url": "https://lms/...",
      "text": "extracted readable text...",
      "capturedAt": 1733650000000
    }
  }
}

// RUN STATE (survives reloads; source of truth for the loop)
"runState": {
  "status": "idle",                     // "idle"|"running"|"paused"|"done"|"error"
  "currentLessonId": null,
  "currentType": null,                  // "video"|"doc"|"quiz"|"unknown"
  "lastAction": null,
  "error": null,
  "updatedAt": 0
}
```

## 8. Message Contract (content ↔ background)

| Message          | Direction          | Payload                                  | Response                          |
|------------------|--------------------|------------------------------------------|-----------------------------------|
| `GET_CONFIG`     | content → bg       | —                                        | `config`                          |
| `GET_RUNSTATE`   | content/popup → bg | —                                        | `runState`                        |
| `SAVE_LESSON_TEXT`| content → bg      | `{lesson: {id, title, type, url, text, capturedAt}}` | `{ok}`                |
| `SOLVE_QUIZ`     | content → bg       | `{payload: {question, options[]}}`       | `{answer: {answerIndices, answerText, reason}}` or `{error}` |
| `UPDATE_RUNSTATE`| content → bg       | `{patch}` (partial `runState`)           | `{ok, runState}`                  |
| `CONTROL`        | popup/content → bg | `{action: "START"|"STOP"|"STEP"}`        | `{ok, runState}`                  |
| `TEST_KEY`       | popup → bg         | `{llm}` (llm config)                     | `{ok}` or `{ok:false, error}`     |
| `RESUME`         | bg → content       | —                                        | (fire-and-forget)                 |

> Note: `SAVE_LESSON_TEXT` keys lessons by `id` (not `lessonId`); the `SOLVE_QUIZ` answer is nested under `answer`. These reflect the as-built implementation.

## 9. Implementation Roadmap

**Phase 1 — Skeleton, popup, state.**
`manifest.json`, icons, `lib/storage.js`, `background/service_worker.js` (message router +
`runState` persistence, no LLM yet), popup UI bound to `config`. Content bundle injects and
renders only a status badge.
*Acceptance:* Loads unpacked with no MV3 errors; popup writes `config`; badge reflects
`runState` across a reload; START/STOP flips `runState.status`.

**Phase 2 — Video + document mechanics.**
`detector.js` (video/doc), `content_video.js` (rate/seek + MutationObserver completion),
`content_doc.js` (text/iframe/PDF-link extraction → `SAVE_LESSON_TEXT`), auto-loop
Next-clicking in `controller.js` for these two types.
*Acceptance:* Video lessons speed/seek, wait for the real completion trigger, click Next; doc
text appears under `kb.lessons[id]` with correct `order`; loop advances through consecutive
video/doc lessons unattended on both SPA and reload navigation.

**Phase 3 — Quiz scraping + branching (no live AI).**
Extend `detector.js` for quiz; `content_quiz.js` scraping + input-mapping for
radio/checkbox/text; implement the **no-key branch** fully (`skip` and `random`); wire
`SOLVE_QUIZ` round-trip with a **stubbed** solver returning a deterministic pick.
*Acceptance:* Quizzes detected/classified; no-key fallback submits and advances reliably; with
the stub solver, the chosen option is correctly matched and actuated across radio/checkbox/text
layouts.

**Phase 4 — Live AI integration.**
`lib/llm_adapter.js` (per-provider request/parse), RAG payload assembly in background, strict
JSON answer parsing, popup "Test key" probe, robust error fallback (API error/timeout →
degrade to Phase-3 `random`/`skip` path, set `runState.error`, continue).
*Acceptance:* With a valid key, real questions answered, correct option selected, submitted,
Next clicked; switching provider changes the call correctly; any API failure transparently
falls back without halting the loop.

## 10. Risks & Notes

- **Terms-of-use / integrity:** Auto-answering assessments and force-filling random answers to
  unlock progress may violate the LMS's terms or training/academic-integrity rules. Use only on
  courses you are authorized to automate.
- **API key at rest:** Stored unencrypted in `chrome.storage.local` — acceptable for personal
  use, not for sharing a profile.
- **Heuristic fragility:** Generic selectors can misfire on unusual LMS markup;
  `config/selectors.js` is the mitigation and tuning surface.
- **`<all_urls>` scope:** Broad by design for "any LMS"; narrow to specific origins for a
  tighter security footprint when the target is known.
```
