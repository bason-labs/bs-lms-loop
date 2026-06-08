# LMS Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a framework-free Manifest V3 Chrome extension that auto-progresses a dynamic LMS — speeding/seeking videos, scraping document text into a RAG knowledge base, and answering quizzes via a provider-agnostic LLM (with a safe no-key fallback).

**Architecture:** Background service worker owns run-state, storage orchestration, and ALL LLM fetches (bypasses page CSP, survives reloads). Content scripts are thin DOM scrapers/actuators sharing one isolated-world namespace (`window.__LMS`). Popup edits config and sends control messages.

**Tech Stack:** Vanilla ES6+ JS, plain HTML/CSS, `chrome.storage.local`, `chrome.runtime` messaging, `MutationObserver`, `fetch`. No bundler, no runtime deps. Dev-time unit tests use Node's built-in `node:test` (Node ≥18) — ignored by Chrome.

## Testing Model (read before starting)

Two tiers, by what is mechanically testable without a browser:

- **Automated (TDD):** Pure-logic ES modules — `lib/llm_adapter.js` and the pure helpers in `lib/storage.js`/`lib/dom_utils.js`. Tests live in `test/*.test.mjs`, run with `node --test`. Write the test first, watch it fail, implement, watch it pass, commit.
- **Browser-verified:** `chrome.*`/DOM-bound code (service-worker wiring, content handlers, popup). Each such task ends with a concrete **Verify in browser** checklist (load unpacked → action → observed result). Treat the checklist as the acceptance gate; commit only after it passes.

`lib/*.js` use `export`/`import`, so a root `package.json` with `{"type":"module"}` is required for Node to parse them as ESM. Chrome ignores `package.json`. Classic content scripts (`content/*`, `config/selectors.js`, `lib/dom_utils.js`) attach to `globalThis.__LMS` and are loaded via the manifest `content_scripts.js` array, never imported as modules.

---

## File Structure

| File | Responsibility | Loaded as |
|------|----------------|-----------|
| `package.json` | Dev-only: declares ESM + `test` script | (Chrome ignores) |
| `manifest.json` | MV3 declaration | — |
| `lib/storage.js` | Defaults, pure KB/id helpers, `chrome.storage.local` I/O | ES module |
| `lib/llm_adapter.js` | Provider-agnostic request build + response/answer parse + `callLlm` | ES module |
| `lib/dom_utils.js` | `norm`, `waitFor`, `findClickableByText`, `findFirst`, `simulateClick`, `setNativeValue`, `deriveLessonId` | classic |
| `config/selectors.js` | Tunable heuristic profiles | classic |
| `background/service_worker.js` | Message router, run-state, LLM calls, RAG, resume-on-nav | ES module worker |
| `content/detector.js` | Classify lesson video/quiz/doc | classic |
| `content/content_video.js` | Speed/seek video, wait for completion trigger | classic |
| `content/content_doc.js` | Extract readable text → `SAVE_LESSON_TEXT` | classic |
| `content/content_quiz.js` | Scrape Q+options, solve/fallback, select+submit | classic |
| `content/controller.js` | Per-page orchestrator + status badge (loaded last) | classic |
| `content/content.css` | Status-badge styling | classic CSS |
| `popup/popup.html`/`popup.css`/`popup.js` | Config UI + Start/Stop/Test | module script |
| `icons/icon{16,48,128}.png` | Extension icons | — |
| `test/*.test.mjs` | Node unit tests | dev-only |

**Message contract (content/popup → background):** `GET_CONFIG`, `GET_RUNSTATE`, `UPDATE_RUNSTATE {patch}`, `SAVE_LESSON_TEXT {lesson}`, `CONTROL {action}`, `SOLVE_QUIZ {payload}`, `TEST_KEY {llm}`. Background → content: `RESUME`.

---

# PHASE 1 — Skeleton, popup, state

## Task 1: Project scaffold + package.json

**Files:**
- Create: `package.json`
- Create: `.gitignore`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "lms-loop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Write `.gitignore`**

```
node_modules/
*.zip
.DS_Store
```

- [ ] **Step 3: Verify Node runs the (empty) suite without error**

Run: `node --test`
Expected: exits 0 with "tests 0" (no test files yet).

- [ ] **Step 4: Commit**

```bash
git add package.json .gitignore
git commit -m "chore: project scaffold (ESM + node:test)"
```

## Task 2: Storage module (pure helpers TDD + I/O wrappers)

**Files:**
- Create: `lib/storage.js`
- Test: `test/storage.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/storage.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendLessonToKb, DEFAULT_CONFIG, DEFAULT_RUNSTATE } from '../lib/storage.js';

test('appendLessonToKb adds a new lesson and records order', () => {
  const kb = { courseId: null, order: [], lessons: {} };
  const next = appendLessonToKb(kb, { id: 'L1', text: 'a' });
  assert.deepEqual(next.order, ['L1']);
  assert.equal(next.lessons.L1.text, 'a');
});

test('appendLessonToKb does not mutate input and merges existing', () => {
  const kb = { courseId: 'c', order: ['L1'], lessons: { L1: { id: 'L1', text: 'a', title: 't' } } };
  const next = appendLessonToKb(kb, { id: 'L1', text: 'b' });
  assert.equal(kb.lessons.L1.text, 'a');     // input untouched
  assert.equal(next.lessons.L1.text, 'b');   // value updated
  assert.equal(next.lessons.L1.title, 't');  // existing field merged
  assert.deepEqual(next.order, ['L1']);      // no duplicate id
});

test('defaults match spec shape', () => {
  assert.equal(DEFAULT_CONFIG.llm.provider, 'openai');
  assert.equal(DEFAULT_CONFIG.quiz.fallback, 'random');
  assert.equal(DEFAULT_RUNSTATE.status, 'idle');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/storage.test.mjs`
Expected: FAIL — cannot find module `../lib/storage.js`.

- [ ] **Step 3: Implement `lib/storage.js`**

```js
// lib/storage.js — defaults, pure helpers, and chrome.storage.local I/O (ES module)

export const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  mode: 'auto',                                   // 'auto' | 'step'
  llm: { provider: 'openai', apiKey: '', model: 'gpt-4o-mini', baseUrl: '', temperature: 0 },
  video: { skipToEnd: true, playbackRate: 16, waitForTriggerMs: 1500 },
  quiz: { useAiWhenKeyPresent: true, fallback: 'random', forceSubmit: true }, // fallback: 'skip'|'random'
  delays: { betweenLessonsMs: 1200, actionMs: 400 }
});

export const DEFAULT_RUNSTATE = Object.freeze({
  status: 'idle', currentLessonId: null, currentType: null,
  lastAction: null, error: null, updatedAt: 0
});

// Pure: returns a NEW kb with `lesson` merged in; preserves order, no duplicate ids.
export function appendLessonToKb(kb, lesson) {
  const base = kb && kb.lessons ? kb : { courseId: kb?.courseId ?? null, order: [], lessons: {} };
  const order = base.order.includes(lesson.id) ? base.order : [...base.order, lesson.id];
  return {
    ...base,
    order,
    lessons: { ...base.lessons, [lesson.id]: { ...base.lessons[lesson.id], ...lesson } }
  };
}

// ---- chrome.storage.local I/O (browser only; chrome referenced inside fns, not at import) ----
async function getKey(key, fallback) {
  const out = await chrome.storage.local.get(key);
  return out[key] ?? fallback;
}
export const getConfig = () => getKey('config', structuredClone(DEFAULT_CONFIG));
export const setConfig = (config) => chrome.storage.local.set({ config });
export const getRunState = () => getKey('runState', structuredClone(DEFAULT_RUNSTATE));
export async function setRunState(patch) {
  const cur = await getRunState();
  const next = { ...cur, ...patch, updatedAt: Date.now() };
  await chrome.storage.local.set({ runState: next });
  return next;
}
export const getKb = () => getKey('kb', { courseId: null, order: [], lessons: {} });
export async function saveLessonText(lesson) {
  const next = appendLessonToKb(await getKb(), lesson);
  await chrome.storage.local.set({ kb: next });
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/storage.test.mjs`
Expected: PASS — 3 tests, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add lib/storage.js test/storage.test.mjs
git commit -m "feat: storage module with pure KB helpers + chrome.storage I/O"
```

## Task 3: DOM utils (pure helpers TDD + browser helpers)

**Files:**
- Create: `lib/dom_utils.js`
- Test: `test/dom_utils.test.mjs`

- [ ] **Step 1: Write the failing test** (loads the classic script via indirect `eval`; only pure fns are called)

```js
// test/dom_utils.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

(0, eval)(readFileSync(new URL('../lib/dom_utils.js', import.meta.url), 'utf8'));
const dom = globalThis.__LMS.dom;

test('norm collapses whitespace and lowercases', () => {
  assert.equal(dom.norm('  Next   Lesson \n'), 'next lesson');
});

test('deriveLessonId is stable for same url+title', () => {
  const a = dom.deriveLessonId('https://lms/x/1#m', 'Intro');
  const b = dom.deriveLessonId('https://lms/x/1#m', 'Intro');
  assert.equal(a, b);
  assert.match(a, /^L[0-9a-z]+$/);
});

test('deriveLessonId differs across lessons', () => {
  assert.notEqual(dom.deriveLessonId('https://lms/x/1', 'A'), dom.deriveLessonId('https://lms/x/2', 'A'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dom_utils.test.mjs`
Expected: FAIL — `ENOENT` reading `lib/dom_utils.js`.

- [ ] **Step 3: Implement `lib/dom_utils.js`**

```js
// lib/dom_utils.js — DOM helpers shared via window.__LMS (classic script).
// Only norm/deriveLessonId are pure; the rest touch document/window at CALL time.
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  function deriveLessonId(url, title = '') {
    let path = url;
    try { const u = new URL(url); path = u.pathname + u.hash; } catch { /* keep raw */ }
    const basis = `${path}::${title}`.trim();
    let h = 5381;
    for (let i = 0; i < basis.length; i++) h = ((h << 5) + h + basis.charCodeAt(i)) >>> 0;
    return 'L' + h.toString(36);
  }

  function waitFor(fnOrSel, { timeout = 8000, interval = 200 } = {}) {
    const test = typeof fnOrSel === 'function' ? fnOrSel : () => document.querySelector(fnOrSel);
    return new Promise((resolve) => {
      const start = Date.now();
      (function tick() {
        let r; try { r = test(); } catch { r = null; }
        if (r) return resolve(r);
        if (Date.now() - start >= timeout) return resolve(null);
        setTimeout(tick, interval);
      })();
    });
  }

  function findClickableByText(candidates) {
    const wanted = candidates.map(norm);
    const els = [...document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"]')];
    return els.find((el) => {
      const t = norm(el.innerText || el.value || el.getAttribute('aria-label'));
      return t && wanted.some((w) => t === w || t.includes(w));
    }) || null;
  }

  function findFirst(selectors) {
    for (const sel of selectors) { const el = document.querySelector(sel); if (el) return el; }
    return null;
  }

  function simulateClick(el) {
    if (!el) return false;
    el.scrollIntoView?.({ block: 'center' });
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    return true;
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter ? setter.call(el, value) : (el.value = value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  NS.dom = { norm, deriveLessonId, waitFor, findClickableByText, findFirst, simulateClick, setNativeValue };
})();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/dom_utils.test.mjs`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/dom_utils.js test/dom_utils.test.mjs
git commit -m "feat: dom_utils helpers (pure deriveLessonId/norm tested)"
```

## Task 4: Selector profiles

**Files:**
- Create: `config/selectors.js`

- [ ] **Step 1: Implement `config/selectors.js`**

```js
// config/selectors.js — tunable heuristic profiles (classic script). Edit here to tune an LMS.
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});
  NS.selectors = {
    nextButtonText: ['next', 'continue', 'next lesson', 'proceed', 'tiếp', 'tiếp theo', 'tiếp tục', '次へ', '下一步', 'siguiente'],
    submitButtonText: ['submit', 'check', 'finish', 'done', 'nộp', 'kiểm tra', 'gửi', '提出', '提交'],
    nextSelectors: ['[data-testid*="next" i]', 'button.next', 'a.next', '.btn-next', '[aria-label*="next" i]'],
    submitSelectors: ['button[type="submit"]', '.btn-submit', '[data-testid*="submit" i]'],
    contentSelectors: ['main', 'article', '#content', '.lesson-content', '.content', '[role="main"]'],
    questionSelectors: ['.question', '.quiz-question', '[data-testid*="question" i]', 'legend', 'fieldset > p']
  };
})();
```

- [ ] **Step 2: Commit**

```bash
git add config/selectors.js
git commit -m "feat: tunable selector profiles"
```

## Task 5: manifest, icons, content.css, minimal controller

**Files:**
- Create: `manifest.json`
- Create: `content/content.css`
- Create: `content/controller.js`
- Create: `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`

- [ ] **Step 1: Write `manifest.json`**

```json
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
  "content_scripts": [
    {
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
    }
  ],
  "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
}
```

> Note: the manifest references content files created in later phases (`detector.js`, `content_video.js`, `content_doc.js`, `content_quiz.js`). Create empty placeholder files now so the extension loads without error: each placeholder is a single line `;` — they will be overwritten in their tasks.

- [ ] **Step 2: Create placeholder content files**

Create these four files each containing exactly `;`:
`content/detector.js`, `content/content_video.js`, `content/content_doc.js`, `content/content_quiz.js`

- [ ] **Step 3: Write `content/content.css`**

```css
#__lms_badge {
  position: fixed; z-index: 2147483647; top: 8px; right: 8px;
  background: #111; color: #19e019; font: 12px/1.4 ui-monospace, monospace;
  padding: 6px 10px; border-radius: 6px; opacity: .92; pointer-events: none;
}
```

- [ ] **Step 4: Write minimal `content/controller.js` (status badge only — replaced in Phase 2)**

```js
// content/controller.js — Phase 1: reflect run-state in a floating badge.
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});
  function badge(text) {
    let el = document.getElementById('__lms_badge');
    if (!el) { el = document.createElement('div'); el.id = '__lms_badge'; document.documentElement.appendChild(el); }
    el.textContent = `LMS Loop: ${text}`;
  }
  async function maybeRun() {
    const rs = await chrome.runtime.sendMessage({ type: 'GET_RUNSTATE' }).catch(() => null);
    badge(rs?.status || 'idle');
  }
  chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === 'RESUME') maybeRun(); });
  NS.maybeRun = maybeRun;
  maybeRun();
})();
```

- [ ] **Step 5: Create placeholder icons**

Generate three solid PNGs (any tool). One-liner if ImageMagick is present:
```bash
for s in 16 48 128; do convert -size ${s}x${s} xc:#1b6fff icons/icon${s}.png 2>/dev/null; done || echo "create icons/icon16.png, icon48.png, icon128.png manually (any PNG)"
```
Any valid PNG at those sizes is acceptable.

- [ ] **Step 6: Commit**

```bash
git add manifest.json content/ icons/
git commit -m "feat: manifest, badge controller, content.css, icons"
```

## Task 6: Background service worker (router subset)

**Files:**
- Create: `background/service_worker.js`

- [ ] **Step 1: Implement `background/service_worker.js`**

```js
// background/service_worker.js — message router + run-state owner (ES module worker).
import { getConfig, getRunState, setRunState, saveLessonText } from '../lib/storage.js';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse).catch((e) => sendResponse({ error: String(e?.message || e) }));
  return true; // keep channel open for async response
});

async function handle(msg) {
  switch (msg?.type) {
    case 'GET_CONFIG': return await getConfig();
    case 'GET_RUNSTATE': return await getRunState();
    case 'UPDATE_RUNSTATE': return { ok: true, runState: await setRunState(msg.patch || {}) };
    case 'SAVE_LESSON_TEXT': await saveLessonText(msg.lesson); return { ok: true };
    case 'CONTROL': return await control(msg.action);
    default: throw new Error(`Unknown message: ${msg?.type}`);
  }
}

async function control(action) {
  const map = { START: 'running', STOP: 'idle', STEP: 'running' };
  const status = map[action];
  if (!status) throw new Error(`Bad control action: ${action}`);
  return { ok: true, runState: await setRunState({ status, error: null }) };
}

// Resume the loop after navigation: nudge the content script when a running tab finishes loading.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'complete') return;
  const rs = await getRunState();
  if (rs.status === 'running') chrome.tabs.sendMessage(tabId, { type: 'RESUME' }).catch(() => {});
});
```

- [ ] **Step 2: Commit**

```bash
git add background/service_worker.js
git commit -m "feat: background message router + run-state + resume-on-nav"
```

## Task 7: Popup UI

**Files:**
- Create: `popup/popup.html`, `popup/popup.css`, `popup/popup.js`

- [ ] **Step 1: Write `popup/popup.html`**

```html
<!doctype html>
<html>
<head><meta charset="utf-8"><link rel="stylesheet" href="popup.css"></head>
<body>
  <h1>LMS Loop</h1>
  <label>Provider
    <select id="provider">
      <option value="openai">OpenAI</option>
      <option value="anthropic">Anthropic</option>
      <option value="gemini">Gemini</option>
      <option value="custom">Custom</option>
    </select>
  </label>
  <label>API Key <input id="apiKey" type="password" placeholder="blank = skip/guess quizzes"></label>
  <label>Model <input id="model" type="text"></label>
  <label>Base URL (custom) <input id="baseUrl" type="text" placeholder="https://..."></label>
  <label>Mode
    <select id="mode"><option value="auto">Auto loop</option><option value="step">Step</option></select>
  </label>
  <label>Video speed <input id="playbackRate" type="number" min="1" max="16" step="1"></label>
  <label>No-key quiz fallback
    <select id="fallback"><option value="random">Random fill</option><option value="skip">Skip</option></select>
  </label>
  <div class="row">
    <button id="start">Start</button>
    <button id="stop">Stop</button>
    <button id="test">Test key</button>
  </div>
  <p id="status">idle</p>
  <script type="module" src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `popup/popup.css`**

```css
body { width: 280px; font: 13px system-ui, sans-serif; padding: 10px; }
h1 { font-size: 15px; margin: 0 0 8px; }
label { display: block; margin: 6px 0; }
label input, label select { width: 100%; box-sizing: border-box; }
.row { display: flex; gap: 6px; margin-top: 10px; }
.row button { flex: 1; padding: 6px; cursor: pointer; }
#status { margin-top: 8px; font-family: ui-monospace, monospace; color: #333; }
```

- [ ] **Step 3: Write `popup/popup.js`** (TEST_KEY responds only after Phase 4; START/STOP work now)

```js
import { getConfig, setConfig } from '../lib/storage.js';

const $ = (id) => document.getElementById(id);
const watched = ['provider', 'apiKey', 'model', 'baseUrl', 'mode', 'playbackRate', 'fallback'];

function fill(cfg) {
  $('provider').value = cfg.llm.provider;
  $('apiKey').value = cfg.llm.apiKey;
  $('model').value = cfg.llm.model;
  $('baseUrl').value = cfg.llm.baseUrl;
  $('mode').value = cfg.mode;
  $('playbackRate').value = cfg.video.playbackRate;
  $('fallback').value = cfg.quiz.fallback;
}

async function persist() {
  const cfg = await getConfig();
  cfg.llm.provider = $('provider').value;
  cfg.llm.apiKey = $('apiKey').value.trim();
  cfg.llm.model = $('model').value.trim();
  cfg.llm.baseUrl = $('baseUrl').value.trim();
  cfg.mode = $('mode').value;
  cfg.video.playbackRate = Number($('playbackRate').value) || 8;
  cfg.quiz.fallback = $('fallback').value;
  await setConfig(cfg);
}

async function control(action) {
  await persist();
  const res = await chrome.runtime.sendMessage({ type: 'CONTROL', action });
  $('status').textContent = res?.runState?.status || res?.error || 'unknown';
}

$('start').addEventListener('click', () => control('START'));
$('stop').addEventListener('click', () => control('STOP'));
$('test').addEventListener('click', async () => {
  await persist();
  const cfg = await getConfig();
  $('status').textContent = 'testing…';
  const res = await chrome.runtime.sendMessage({ type: 'TEST_KEY', llm: cfg.llm });
  $('status').textContent = res?.ok ? 'key OK' : `key failed: ${res?.error || ''}`;
});
watched.forEach((f) => $(f).addEventListener('change', persist));

(async () => {
  fill(await getConfig());
  const rs = await chrome.runtime.sendMessage({ type: 'GET_RUNSTATE' }).catch(() => null);
  $('status').textContent = rs?.status || 'idle';
})();
```

- [ ] **Step 4: Verify in browser (Phase 1 acceptance gate)**

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → select project root. Expect zero errors.
2. Open any web page → top-right badge shows `LMS Loop: idle`.
3. Click the toolbar icon → popup opens. Change provider/model/fallback → reload popup → values persist.
4. Click **Start** → status shows `running`. Reload the page → badge still shows `running` (state survived reload). Click **Stop** → `idle`.
5. Open the service-worker console (`chrome://extensions` → "service worker" link) → no uncaught errors.

- [ ] **Step 5: Commit**

```bash
git add popup/
git commit -m "feat: popup config UI + control wiring (Phase 1 complete)"
```

---

# PHASE 2 — Video + document mechanics

## Task 8: Detector (video/doc)

**Files:**
- Modify (overwrite placeholder): `content/detector.js`

- [ ] **Step 1: Implement `content/detector.js`**

```js
// content/detector.js — classify the current lesson (classic script). Quiz added in Phase 3.
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});
  function hasPlayableVideo() {
    const v = document.querySelector('video');
    if (v && (v.readyState > 0 || v.duration > 0 || v.src || v.currentSrc)) return v;
    return document.querySelector('iframe[src*="youtube"],iframe[src*="vimeo"],iframe[src*="player"]') || null;
  }
  function classify() {
    if (hasPlayableVideo()) return { type: 'video' };
    return { type: 'doc' };
  }
  NS.detector = { classify, hasPlayableVideo };
})();
```

- [ ] **Step 2: Commit**

```bash
git add content/detector.js
git commit -m "feat: lesson detector (video/doc)"
```

## Task 9: Video handler

**Files:**
- Modify (overwrite placeholder): `content/content_video.js`

- [ ] **Step 1: Implement `content/content_video.js`**

```js
// content/content_video.js — speed/seek a <video>, then wait for the real completion trigger.
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});
  async function handleVideo(config) {
    const v = document.querySelector('video');
    if (!v) return { ok: false, reason: 'no <video> (player may be in a cross-origin iframe)' };
    try {
      v.muted = true;
      v.playbackRate = config.video.playbackRate || 8;
      await v.play?.().catch(() => {});
      if (config.video.skipToEnd && isFinite(v.duration) && v.duration > 0) {
        v.currentTime = Math.max(0, v.duration - 0.5);
      }
    } catch { /* some players guard rate/seek */ }
    // Completion = video ended OR a Next control becomes enabled.
    const done = await NS.dom.waitFor(() => {
      if (v.ended) return true;
      const next = NS.dom.findClickableByText(NS.selectors.nextButtonText) || NS.dom.findFirst(NS.selectors.nextSelectors);
      return next && !next.disabled && next.getAttribute('aria-disabled') !== 'true' ? next : false;
    }, { timeout: 60000, interval: 500 });
    return { ok: !!done };
  }
  NS.video = { handleVideo };
})();
```

- [ ] **Step 2: Commit**

```bash
git add content/content_video.js
git commit -m "feat: video handler (speed/seek + completion wait)"
```

## Task 10: Document extractor

**Files:**
- Modify (overwrite placeholder): `content/content_doc.js`

- [ ] **Step 1: Implement `content/content_doc.js`**

```js
// content/content_doc.js — extract readable text and persist it to the KB via the worker.
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});
  function extractText() {
    const root = NS.dom.findFirst(NS.selectors.contentSelectors) || document.body;
    let text = (root.innerText || '').trim();
    for (const f of document.querySelectorAll('iframe')) {
      try { const d = f.contentDocument; if (d?.body) text += '\n\n' + (d.body.innerText || ''); } catch { /* cross-origin */ }
    }
    const pdfs = [...document.querySelectorAll('a[href$=".pdf"],embed[type="application/pdf"],object[type="application/pdf"]')]
      .map((el) => el.href || el.src || el.data).filter(Boolean);
    if (pdfs.length) text += '\n\n[PDF references]\n' + pdfs.join('\n');
    return text.trim();
  }
  async function handleDoc(lessonId, title) {
    const text = extractText();
    await chrome.runtime.sendMessage({
      type: 'SAVE_LESSON_TEXT',
      lesson: { id: lessonId, title, type: 'doc', url: location.href, text, capturedAt: Date.now() }
    });
    return { ok: true, chars: text.length };
  }
  NS.doc = { extractText, handleDoc };
})();
```

- [ ] **Step 2: Commit**

```bash
git add content/content_doc.js
git commit -m "feat: document text extraction -> SAVE_LESSON_TEXT"
```

## Task 11: Controller orchestrator (full, replaces Phase 1 badge)

**Files:**
- Modify (overwrite): `content/controller.js`

- [ ] **Step 1: Implement full `content/controller.js`** (the quiz branch is pre-wired and guarded with `NS.quiz` so Phase 3 needs no controller change)

```js
// content/controller.js — per-page orchestrator + status badge (loaded last).
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});
  let running = false;

  function badge(text) {
    let el = document.getElementById('__lms_badge');
    if (!el) { el = document.createElement('div'); el.id = '__lms_badge'; document.documentElement.appendChild(el); }
    el.textContent = `LMS Loop: ${text}`;
  }

  async function clickNext(config) {
    await NS.dom.waitFor(() => true, { timeout: config.delays.betweenLessonsMs });
    const next = NS.dom.findClickableByText(NS.selectors.nextButtonText) || NS.dom.findFirst(NS.selectors.nextSelectors);
    return next ? NS.dom.simulateClick(next) : false;
  }

  async function runOnce() {
    if (running) return;
    running = true;
    try {
      const config = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
      const { type } = NS.detector.classify();
      const lessonId = NS.dom.deriveLessonId(location.href, document.title);
      badge(`handling ${type}`);
      await chrome.runtime.sendMessage({
        type: 'UPDATE_RUNSTATE',
        patch: { currentType: type, currentLessonId: lessonId, lastAction: `handle:${type}` }
      });

      if (type === 'video') await NS.video.handleVideo(config);
      else if (type === 'quiz' && NS.quiz) await NS.quiz.handleQuiz(config);
      else await NS.doc.handleDoc(lessonId, document.title);

      const advanced = await clickNext(config);
      badge(advanced ? `advanced from ${type}` : `no Next (${type})`);
      if (config.mode === 'step') await chrome.runtime.sendMessage({ type: 'CONTROL', action: 'STOP' });
    } catch (e) {
      badge(`error: ${e?.message || e}`);
      await chrome.runtime.sendMessage({ type: 'UPDATE_RUNSTATE', patch: { error: String(e?.message || e) } });
    } finally {
      running = false;
    }
  }

  async function maybeRun() {
    const rs = await chrome.runtime.sendMessage({ type: 'GET_RUNSTATE' }).catch(() => null);
    badge(rs?.status || 'idle');
    if (rs?.status === 'running') runOnce();
  }

  chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === 'RESUME') maybeRun(); });

  // SPA resilience: re-evaluate after DOM settles (debounced).
  let t;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(maybeRun, 800); })
    .observe(document.documentElement, { childList: true, subtree: true });

  maybeRun();
})();
```

- [ ] **Step 2: Verify in browser (Phase 2 acceptance gate)**

1. Reload the unpacked extension.
2. **Doc:** open a content-heavy page → popup **Start**. In the service-worker console run `chrome.storage.local.get('kb', console.log)` → `kb.lessons` has an entry with non-empty `text` and the id appears in `kb.order`.
3. **Video:** open a page with an HTML5 `<video>` → **Start** → badge shows `handling video`; the video rate increases / seeks near end; once a real Next control enables, badge shows `advanced from video`.
4. **Loop across reloads:** with status `running`, trigger a full reload → the content script re-injects, reads `running`, and re-runs (badge cycles). No uncaught errors in either console.

- [ ] **Step 3: Commit**

```bash
git add content/controller.js
git commit -m "feat: controller orchestrator with auto-loop (Phase 2 complete)"
```

---

# PHASE 3 — Quiz scraping + branching (stub solver)

## Task 12: Detector — add quiz classification

**Files:**
- Modify (overwrite): `content/detector.js`

- [ ] **Step 1: Implement updated `content/detector.js`**

```js
// content/detector.js — classify the current lesson (classic script).
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});
  function hasPlayableVideo() {
    const v = document.querySelector('video');
    if (v && (v.readyState > 0 || v.duration > 0 || v.src || v.currentSrc)) return v;
    return document.querySelector('iframe[src*="youtube"],iframe[src*="vimeo"],iframe[src*="player"]') || null;
  }
  function hasQuiz() {
    const inputs = document.querySelectorAll('input[type="radio"],input[type="checkbox"],textarea,input[type="text"]');
    const submit = NS.dom.findClickableByText(NS.selectors.submitButtonText) || NS.dom.findFirst(NS.selectors.submitSelectors);
    return inputs.length > 0 && !!submit;
  }
  function classify() {
    if (hasPlayableVideo()) return { type: 'video' };
    if (hasQuiz()) return { type: 'quiz' };
    return { type: 'doc' };
  }
  NS.detector = { classify, hasPlayableVideo, hasQuiz };
})();
```

- [ ] **Step 2: Commit**

```bash
git add content/detector.js
git commit -m "feat: detector classifies quiz lessons"
```

## Task 13: Quiz handler (scrape + select/submit + no-key fallback)

**Files:**
- Modify (overwrite placeholder): `content/content_quiz.js`

- [ ] **Step 1: Implement `content/content_quiz.js`**

```js
// content/content_quiz.js — scrape question/options, solve via worker or fall back, then submit.
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});

  function scrape() {
    const qEl = NS.dom.findFirst(NS.selectors.questionSelectors);
    const question = (qEl?.innerText || document.title).trim();
    const choiceInputs = [...document.querySelectorAll('input[type="radio"],input[type="checkbox"]')];
    const options = choiceInputs.map((input, i) => {
      const label = input.closest('label')
        || (input.id && document.querySelector(`label[for="${input.id}"]`))
        || input.parentElement;
      return { index: i, text: NS.dom.norm(label?.innerText) || `option ${i}`, input };
    });
    const textInputs = [...document.querySelectorAll('textarea,input[type="text"]')];
    return { question, options, textInputs };
  }

  function pickRandom(n) { return n > 0 ? [Math.floor(Math.random() * n)] : []; }

  async function selectAndSubmit(indices, texts, scraped, config) {
    if (scraped.options.length && indices.length) {
      const chosen = new Set(indices);
      scraped.options.forEach((o) => { if (chosen.has(o.index) && !o.input.checked) NS.dom.simulateClick(o.input); });
    }
    if (scraped.textInputs.length) {
      const val = texts[0] || 'N/A';
      scraped.textInputs.forEach((t) => NS.dom.setNativeValue(t, val));
    }
    if (config.quiz.forceSubmit) {
      const submit = NS.dom.findClickableByText(NS.selectors.submitButtonText) || NS.dom.findFirst(NS.selectors.submitSelectors);
      if (submit) { NS.dom.simulateClick(submit); await NS.dom.waitFor(() => true, { timeout: config.delays.actionMs }); }
    }
    return { ok: true };
  }

  async function handleQuiz(config) {
    const scraped = scrape();
    if (config.llm.apiKey) {
      const res = await chrome.runtime.sendMessage({
        type: 'SOLVE_QUIZ',
        payload: { question: scraped.question, options: scraped.options.map((o) => o.text) }
      });
      if (res?.answer) return selectAndSubmit(res.answer.answerIndices, res.answer.answerText, scraped, config);
      // NO_KEY / error → fall through to fallback
    }
    if (config.quiz.fallback === 'skip') return { ok: true, skipped: true };
    return selectAndSubmit(pickRandom(scraped.options.length), [], scraped, config);
  }

  NS.quiz = { scrape, handleQuiz };
})();
```

- [ ] **Step 2: Commit**

```bash
git add content/content_quiz.js
git commit -m "feat: quiz scrape + select/submit + no-key fallback"
```

## Task 14: Background SOLVE_QUIZ (stub solver)

**Files:**
- Modify: `background/service_worker.js`

- [ ] **Step 1: Add the `SOLVE_QUIZ` case to `handle()`**

Add this line inside the `switch (msg?.type)` block, after the `CONTROL` case:

```js
    case 'SOLVE_QUIZ': return await solveQuiz(msg.payload);
```

- [ ] **Step 2: Add the stub `solveQuiz` function**

Insert above the `chrome.tabs.onUpdated` listener:

```js
// Phase 3: stubbed solver — deterministic pick to exercise the content↔bg round-trip.
async function solveQuiz(payload) {
  const config = await getConfig();
  if (!config.llm.apiKey) return { error: 'NO_KEY' };
  const n = (payload?.options || []).length;
  return { answer: { answerIndices: n ? [0] : [], answerText: [], reason: 'stub' } };
}
```

- [ ] **Step 3: Verify in browser (Phase 3 acceptance gate)**

Use a simple local quiz page (save as `quiz.html` and open via `file://` after enabling "Allow access to file URLs" for the extension, or use any LMS quiz):
```html
<!doctype html><meta charset="utf-8"><h2 class="question">Pick the correct color of the sky</h2>
<form>
  <label><input type="radio" name="q" value="0"> Green</label>
  <label><input type="radio" name="q" value="1"> Blue</label>
  <button type="submit">Submit</button>
</form>
```
1. **No key:** clear the API key in the popup, set fallback `random`, **Start** → a radio gets selected and Submit is clicked; badge `advanced from quiz`. Set fallback `skip` → no radio selected, just advances.
2. **Stub key:** enter any non-empty API key, **Start** → option index 0 ("Green") is selected and submitted (proves the `SOLVE_QUIZ` round-trip + index→input mapping). Service-worker console shows no errors.
3. **Checkbox/text variants:** swap radios for `type="checkbox"` and add a `<input type="text">` → confirm checkboxes get clicked and the text field is filled.

- [ ] **Step 4: Commit**

```bash
git add background/service_worker.js
git commit -m "feat: SOLVE_QUIZ round-trip with stub solver (Phase 3 complete)"
```

---

# PHASE 4 — Live AI integration

## Task 15: LLM adapter (provider-agnostic, TDD)

**Files:**
- Create: `lib/llm_adapter.js`
- Test: `test/llm_adapter.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/llm_adapter.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSolvePrompt, buildRequest, parseResponse, parseAnswerJson } from '../lib/llm_adapter.js';

test('buildSolvePrompt yields system+user with numbered options and context', () => {
  const m = buildSolvePrompt({ question: 'Q?', options: ['a', 'b'], context: 'ctx' });
  assert.equal(m[0].role, 'system');
  assert.equal(m[1].role, 'user');
  assert.match(m[1].content, /0\. a/);
  assert.match(m[1].content, /1\. b/);
  assert.match(m[1].content, /ctx/);
});

test('buildRequest openai: bearer auth + json mode', () => {
  const r = buildRequest('openai', { apiKey: 'k', model: 'gpt-4o-mini' }, buildSolvePrompt({ question: 'q', options: ['a'] }));
  assert.match(r.url, /openai\.com\/v1\/chat\/completions/);
  assert.equal(r.headers.authorization, 'Bearer k');
  assert.deepEqual(r.body.response_format, { type: 'json_object' });
});

test('buildRequest anthropic: browser header + system separated from messages', () => {
  const r = buildRequest('anthropic', { apiKey: 'k', model: 'claude-x' }, buildSolvePrompt({ question: 'q', options: ['a'] }));
  assert.equal(r.headers['x-api-key'], 'k');
  assert.equal(r.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.ok(r.body.system.length > 0);
  assert.ok(r.body.messages.every((m) => m.role !== 'system'));
});

test('buildRequest gemini: key in query + model in path', () => {
  const r = buildRequest('gemini', { apiKey: 'k', model: 'gemini-1.5-flash' }, buildSolvePrompt({ question: 'q', options: ['a'] }));
  assert.match(r.url, /key=k/);
  assert.match(r.url, /gemini-1\.5-flash:generateContent/);
});

test('buildRequest unknown provider throws', () => {
  assert.throws(() => buildRequest('nope', {}, []));
});

test('parseResponse extracts text per provider', () => {
  assert.equal(parseResponse('openai', { choices: [{ message: { content: 'x' } }] }), 'x');
  assert.equal(parseResponse('anthropic', { content: [{ text: 'a' }, { text: 'b' }] }), 'ab');
  assert.equal(parseResponse('gemini', { candidates: [{ content: { parts: [{ text: 'g' }] } }] }), 'g');
});

test('parseAnswerJson tolerates surrounding prose', () => {
  const a = parseAnswerJson('Sure: {"answerIndices":[1,2],"answerText":["b"],"reason":"r"} done');
  assert.deepEqual(a.answerIndices, [1, 2]);
  assert.deepEqual(a.answerText, ['b']);
  assert.equal(a.reason, 'r');
});

test('parseAnswerJson returns null on garbage', () => {
  assert.equal(parseAnswerJson('no json here'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/llm_adapter.test.mjs`
Expected: FAIL — cannot find module `../lib/llm_adapter.js`.

- [ ] **Step 3: Implement `lib/llm_adapter.js`**

```js
// lib/llm_adapter.js — provider-agnostic LLM request/response (ES module).

// Pure: neutral chat messages instructing strict-JSON output.
export function buildSolvePrompt({ question, options, context = '' }) {
  const optLines = options.map((o, i) => `${i}. ${o}`).join('\n');
  const system =
    'You are answering a multiple-choice quiz. Use ONLY the provided context when relevant. ' +
    'Reply with STRICT JSON only, no prose: {"answerIndices":[<int>...],"answerText":["..."],"reason":"..."}. ' +
    'answerIndices are zero-based indices into the options list; select ALL correct options.';
  const user = `Context:\n${context || '(none)'}\n\nQuestion:\n${question}\n\nOptions:\n${optLines}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

// Pure: per-provider HTTP request descriptor {url, headers, body}.
export function buildRequest(provider, cfg, messages) {
  const { apiKey, model, baseUrl, temperature = 0 } = cfg;
  const sys = messages.find((m) => m.role === 'system')?.content ?? '';
  const turns = messages.filter((m) => m.role !== 'system');
  switch (provider) {
    case 'openai':
      return {
        url: `${baseUrl || 'https://api.openai.com'}/v1/chat/completions`,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: { model, temperature, messages, response_format: { type: 'json_object' } }
      };
    case 'anthropic':
      return {
        url: `${baseUrl || 'https://api.anthropic.com'}/v1/messages`,
        headers: {
          'content-type': 'application/json', 'x-api-key': apiKey,
          'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: { model, max_tokens: 1024, temperature, system: sys,
          messages: turns.map((m) => ({ role: m.role, content: m.content })) }
      };
    case 'gemini':
      return {
        url: `${baseUrl || 'https://generativelanguage.googleapis.com'}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        headers: { 'content-type': 'application/json' },
        body: {
          systemInstruction: { parts: [{ text: sys }] },
          contents: turns.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: { temperature }
        }
      };
    case 'custom':
      return {
        url: `${baseUrl}/v1/chat/completions`,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: { model, temperature, messages }
      };
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// Pure: normalize provider response JSON → text.
export function parseResponse(provider, json) {
  switch (provider) {
    case 'openai':
    case 'custom': return json?.choices?.[0]?.message?.content ?? '';
    case 'anthropic': return (json?.content ?? []).map((b) => b.text ?? '').join('');
    case 'gemini': return (json?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    default: return '';
  }
}

// Pure: lenient extraction of the strict-JSON answer.
export function parseAnswerJson(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]);
    const answerIndices = Array.isArray(obj.answerIndices)
      ? obj.answerIndices.map(Number).filter(Number.isInteger) : [];
    const answerText = Array.isArray(obj.answerText)
      ? obj.answerText.map(String) : (obj.answerText != null ? [String(obj.answerText)] : []);
    return { answerIndices, answerText, reason: obj.reason ? String(obj.reason) : '' };
  } catch { return null; }
}

// Browser-only: perform the call. cfg = config.llm (includes provider).
export async function callLlm(cfg, { question, options, context }) {
  const messages = buildSolvePrompt({ question, options, context });
  const req = buildRequest(cfg.provider, cfg, messages);
  const res = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const answer = parseAnswerJson(parseResponse(cfg.provider, await res.json()));
  if (!answer) throw new Error('LLM returned unparseable answer');
  return answer;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/llm_adapter.test.mjs`
Expected: PASS — 8 tests.

- [ ] **Step 5: Run the full suite**

Run: `node --test`
Expected: PASS — all storage/dom_utils/llm_adapter tests green.

- [ ] **Step 6: Commit**

```bash
git add lib/llm_adapter.js test/llm_adapter.test.mjs
git commit -m "feat: provider-agnostic LLM adapter (TDD)"
```

## Task 16: Wire live solver + RAG + Test key into the worker

**Files:**
- Modify: `background/service_worker.js`

- [ ] **Step 1: Extend the import to add `getKb` and `callLlm`**

Replace the import block at the top with:

```js
import { getConfig, getRunState, setRunState, saveLessonText, getKb } from '../lib/storage.js';
import { callLlm } from '../lib/llm_adapter.js';
```

- [ ] **Step 2: Add the `TEST_KEY` case to `handle()`**

Add inside the `switch`, after the `SOLVE_QUIZ` case:

```js
    case 'TEST_KEY': return await testKey(msg.llm);
```

- [ ] **Step 3: Replace the stub `solveQuiz` with the live version + add `testKey`**

Replace the entire Phase-3 `solveQuiz` function with:

```js
// Phase 4: live solver — assemble RAG context from captured doc text, call the LLM, fall back on error.
async function solveQuiz(payload) {
  const config = await getConfig();
  if (!config.llm.apiKey) return { error: 'NO_KEY' };
  const kb = await getKb();
  const context = kb.order
    .map((id) => kb.lessons[id])
    .filter((l) => l && l.type === 'doc' && l.text)
    .map((l) => l.text)
    .join('\n\n')
    .slice(0, 12000);
  try {
    return { answer: await callLlm(config.llm, { ...payload, context }) };
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

async function testKey(llm) {
  try {
    await callLlm(llm, { question: 'Reply choosing index 0.', options: ['ok', 'no'], context: '' });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
```

- [ ] **Step 4: Verify in browser (Phase 4 acceptance gate)**

1. Reload the unpacked extension. Enter a **real** API key + matching provider/model in the popup.
2. Click **Test key** → status shows `key OK` (or a clear error if the key/model is wrong). Switch provider and repeat to confirm the adapter targets each endpoint.
3. On the local quiz fixture (Task 14), **Start** → the model's chosen option is selected and submitted; service-worker console shows the `SOLVE_QUIZ` returning an `answer` with `answerIndices`.
4. **RAG:** first visit a doc lesson (populates `kb`), then a related quiz → the answer reflects the captured context.
5. **Error fallback:** enter an invalid key → **Start** on the quiz → solve returns an error and the content script falls back to `random`/`skip` per config; `runState.error` is set but the loop does NOT halt (badge keeps advancing).

- [ ] **Step 5: Commit**

```bash
git add background/service_worker.js
git commit -m "feat: live LLM solver with RAG context + Test key + error fallback (Phase 4 complete)"
```

---

## Final verification

- [ ] Run `node --test` → all unit tests pass.
- [ ] Re-run each phase acceptance gate end-to-end on a real or fixture LMS page.
- [ ] Confirm: video speeds/seeks & advances; doc text lands in `kb`; quiz answers with a key, falls back without one; provider switch works; API errors degrade gracefully.

## Notes carried from the spec

- **Terms-of-use / integrity:** only run against courses you are authorized to automate.
- **API key at rest:** stored unencrypted in `chrome.storage.local` — fine for personal use, not for shared profiles.
- **`<all_urls>`:** broad by design; narrow `matches`/`host_permissions` to the real LMS origin to tighten the footprint once known.
- **Cross-origin video/quiz iframes:** handlers operate on same-origin DOM; players/quizzes inside cross-origin iframes are out of reach for v0.1 (would need `all_frames` + per-frame injection — deferred).
