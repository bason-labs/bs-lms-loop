# Adaptive Video Speed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the user-configurable video speed slider with a hardcoded 16×→5×→2×→1× descent tied to retry count, and delete the Behavior section from the popup.

**Architecture:** All speed logic lives in `videoPlaybackSpeed()` in `controller.js` — a synchronous table lookup keyed on `verify.tries`. `content_video.js` consumes the result directly. The popup Behavior `<section>` and all its backing JS/i18n are deleted; DEFAULT_CONFIG loses the now-unused `video.playbackRate` field.

**Tech Stack:** Vanilla ES6+ JS, Chrome MV3, Node 22 `node:test` for unit tests.

---

## File Map

| File | Change |
|---|---|
| `content/controller.js` | Rename `videoRetrySpeed` → `videoPlaybackSpeed`; replace formula with table; update 2 call sites |
| `content/content_video.js` | Rename parameter `retrySpeed` → `speed`; simplify rate calculation |
| `lib/storage.js` | Remove `playbackRate` from `DEFAULT_CONFIG.video` |
| `popup/popup.html` | Delete entire Behavior `<section>` (lines 104–137) |
| `popup/popup.js` | Remove `paintRate()`, Behavior entries from `fill()`/`persist()`, quiz-strategy logic from `syncProvider()`, 3 event listeners, i18n keys |

---

## Task 1: Replace `videoRetrySpeed` with hardcoded table in controller.js

**Files:**
- Modify: `content/controller.js:197-202` (function body) and lines ~285, ~303 (call sites)

- [ ] **Step 1: Replace the function**

Find and replace the entire `videoRetrySpeed` function (lines 197–202):

```js
// BEFORE
async function videoRetrySpeed(token) {
  const rs = await chrome.runtime.sendMessage({ type: 'GET_RUNSTATE' }).catch(() => null);
  const tries = rs?.verify?.token === token ? (rs.verify.tries || 0) : 0;
  return tries > 0 ? Math.min(tries + 1, 5) : null;
}
```

```js
// AFTER
async function videoPlaybackSpeed(token) {
  const SPEED_TABLE = [16, 5, 2, 1];
  const rs = await chrome.runtime.sendMessage({ type: 'GET_RUNSTATE' }).catch(() => null);
  const tries = rs?.verify?.token === token ? (rs.verify.tries || 0) : 0;
  return SPEED_TABLE[Math.min(tries, SPEED_TABLE.length - 1)];
}
```

- [ ] **Step 2: Update top-frame call site (~line 285)**

```js
// BEFORE
if (type === 'video') await NS.video.handleVideo(config, await videoRetrySpeed(lessonToken()));
```

```js
// AFTER
if (type === 'video') await NS.video.handleVideo(config, await videoPlaybackSpeed(lessonToken()));
```

- [ ] **Step 3: Update child-frame call site (~line 303)**

```js
// BEFORE
if (type === 'video') { await NS.video.handleVideo(config, await videoRetrySpeed(lessonToken())); handled = true; }
```

```js
// AFTER
if (type === 'video') { await NS.video.handleVideo(config, await videoPlaybackSpeed(lessonToken())); handled = true; }
```

- [ ] **Step 4: Syntax-check**

```bash
node --check content/controller.js
```

Expected: no output (clean).

- [ ] **Step 5: Commit**

```bash
git add content/controller.js
git commit -m "feat(video): replace videoRetrySpeed with hardcoded 16x→5x→2x→1x table"
```

---

## Task 2: Simplify handleVideo signature in content_video.js

**Files:**
- Modify: `content/content_video.js:56,64,66`

- [ ] **Step 1: Rename parameter and simplify rate calculation**

Line 56 — rename the second parameter:
```js
// BEFORE
async function handleVideo(config, retrySpeed) {
```
```js
// AFTER
async function handleVideo(config, speed) {
```

Line 64 — simplify rate calculation (speed is always a number now):
```js
// BEFORE
const rate = (retrySpeed != null ? retrySpeed : config.video.playbackRate) || 1;
```
```js
// AFTER
const rate = speed || 1;
```

Line 66 — remove now-meaningless `retry` field from the log:
```js
// BEFORE
NS.log?.('video: watching through at speed', { count: vids.length, rate, retry: retrySpeed != null, duration: v.duration });
```
```js
// AFTER
NS.log?.('video: watching through at speed', { count: vids.length, rate, duration: v.duration });
```

- [ ] **Step 2: Syntax-check**

```bash
node --check content/content_video.js
```

Expected: no output (clean).

- [ ] **Step 3: Commit**

```bash
git add content/content_video.js
git commit -m "refactor(video): rename retrySpeed→speed, drop config.video.playbackRate fallback"
```

---

## Task 3: Remove playbackRate from DEFAULT_CONFIG

**Files:**
- Modify: `lib/storage.js:15`
- Test: `test/storage.test.mjs` (verify existing tests still pass — no new tests needed)

- [ ] **Step 1: Remove the field**

In `lib/storage.js`, line 15, change the `video` object:

```js
// BEFORE
video: { skipToEnd: true, playbackRate: 1, waitForTriggerMs: 1500 },
```

```js
// AFTER
video: { skipToEnd: true, waitForTriggerMs: 1500 },
```

- [ ] **Step 2: Run tests**

```bash
node --test
```

Expected: all tests pass (the only reference to this area in tests is `DEFAULT_CONFIG.quiz.fallback === 'random'`, which is unaffected).

- [ ] **Step 3: Commit**

```bash
git add lib/storage.js
git commit -m "chore(config): remove unused video.playbackRate from DEFAULT_CONFIG"
```

---

## Task 4: Delete Behavior section from popup.html

**Files:**
- Modify: `popup/popup.html:104-137`

- [ ] **Step 1: Delete the Behavior section**

Remove the entire `<section>` block from line 104 to 137 (inclusive). The block starts with:
```html
<section class="card reveal" style="--d:3">
```
and ends with the matching `</section>` before the `<footer>`. After deletion, the `<footer>` (currently line 139) follows directly after the Intelligence card's closing `</section>`.

The resulting file around that area should look like:
```html
  </section>

  <footer class="foot reveal" style="--d:4">
    <span id="foot-msg" data-i18n="foot">Runs on the active tab · state survives reloads</span>
  </footer>
```

- [ ] **Step 2: Commit**

```bash
git add popup/popup.html
git commit -m "feat(popup): remove Behavior section (video speed, quiz fallback, quiz strategy)"
```

---

## Task 5: Remove Behavior code from popup.js

**Files:**
- Modify: `popup/popup.js`

This task has multiple small removals. Apply them in order, then verify with a single syntax check at the end.

- [ ] **Step 1: Remove `paintRate()` function**

Delete the entire function (lines 117–122):
```js
// DELETE THIS
function paintRate() {
  const r = $('playbackRate');
  const pct = ((r.value - r.min) / (r.max - r.min)) * 100;
  r.style.setProperty('--fill', pct + '%');
  $('rate-value').textContent = '×' + r.value;
}
```

- [ ] **Step 2: Trim `fill()` to remove Behavior fields**

In the `fill(cfg)` function, remove these three lines:
```js
// DELETE THESE
  setGroup('fallback', cfg.quiz.fallback);
  setGroup('quizStrategy', cfg.quiz.searchStrategy || 'llm-only');
  $('playbackRate').value = cfg.video.playbackRate;
  paintRate();
```

The function should now read:
```js
function fill(cfg) {
  setGroup('provider', cfg.llm.provider);
  setGroup('mode', cfg.mode);
  $('apiKey').value = cfg.llm.apiKey;
  $('model').value = cfg.llm.model;
  $('baseUrl').value = cfg.llm.baseUrl;
  syncProvider();
}
```

- [ ] **Step 3: Trim `persist()` to remove Behavior fields**

In the `persist()` function, remove these three lines:
```js
// DELETE THESE
  cfg.video.playbackRate = Number($('playbackRate').value) || 1;
  cfg.quiz.fallback = getGroup('fallback');
  cfg.quiz.searchStrategy = getGroup('quizStrategy') || 'llm-only';
```

The function should now read:
```js
async function persist() {
  const cfg = await getConfig();
  cfg.llm.provider = getGroup('provider');
  cfg.llm.apiKey = $('apiKey').value.trim();
  cfg.llm.model = $('model').value.trim();
  cfg.llm.baseUrl = $('baseUrl').value.trim();
  cfg.mode = getGroup('mode');
  await setConfig(cfg);
}
```

- [ ] **Step 4: Trim `syncProvider()` to remove quiz-strategy logic**

Remove the quiz-strategy block from `syncProvider()`:
```js
// DELETE THESE
  const searchSupported = p === 'gemini' || p === 'openai';
  const searchBtn = groupEl('quizStrategy').querySelector('[data-value="llm-search"]');
  searchBtn.classList.toggle('is-disabled', !searchSupported);
  searchBtn.disabled = !searchSupported;
  $('quiz-strategy-note').hidden = searchSupported;

  if (!searchSupported && getGroup('quizStrategy') === 'llm-search') {
    setGroup('quizStrategy', 'llm-only');
    persist();
  }
```

The function should now read:
```js
function syncProvider() {
  const p = getGroup('provider');
  $('baseUrl-field').hidden = p !== 'custom';
  $('model').placeholder = MODEL_HINT[p] || 'model';
}
```

- [ ] **Step 5: Trim the segmented-group listener array**

```js
// BEFORE
['mode', 'fallback', 'quizStrategy'].forEach((name) => {
```
```js
// AFTER
['mode'].forEach((name) => {
```

- [ ] **Step 6: Remove playbackRate and adv-toggle event listeners**

Delete these three blocks:
```js
// DELETE
$('playbackRate').addEventListener('input', paintRate);
$('playbackRate').addEventListener('change', persist);
```
```js
// DELETE
$('adv-toggle').addEventListener('click', () => {
  const body = $('adv-body');
  const open = body.hidden;
  body.hidden = !open;
  $('adv-toggle').setAttribute('aria-expanded', String(open));
});
```

- [ ] **Step 7: Remove Behavior i18n keys from `en` dictionary**

Delete these keys from the `en` object inside `I18N`:
```js
// DELETE from en:
    sec_behavior: 'Behavior', lbl_video: 'Video speed', lbl_fallback: 'No-key quiz fallback',
    fb_random: 'Random fill', fb_skip: 'Skip',
    lbl_quiz_strategy: 'Quiz strategy',
    qs_llm_only: 'LLM Only', qs_llm_search: 'LLM + Search',
    qs_note: 'Search requires Gemini or OpenAI',
```

- [ ] **Step 8: Remove Behavior i18n keys from `vi` dictionary**

Delete these keys from the `vi` object inside `I18N`:
```js
// DELETE from vi:
    sec_behavior: 'Hành vi', lbl_video: 'Tốc độ video', lbl_fallback: 'Khi không có khóa',
    fb_random: 'Điền ngẫu nhiên', fb_skip: 'Bỏ qua',
    lbl_quiz_strategy: 'Chiến lược trắc nghiệm',
    qs_llm_only: 'Chỉ AI', qs_llm_search: 'AI + Tìm kiếm',
    qs_note: 'Tìm kiếm yêu cầu Gemini hoặc OpenAI',
```

- [ ] **Step 9: Syntax-check**

```bash
node --check popup/popup.js
```

Expected: no output (clean).

- [ ] **Step 10: Run full test suite**

```bash
node --test
```

Expected: all tests pass.

- [ ] **Step 11: Commit**

```bash
git add popup/popup.js
git commit -m "feat(popup): remove Behavior section JS — paintRate, fallback/quizStrategy/playbackRate wiring, i18n keys"
```

---

## Manual Verification Checklist

After all tasks are complete, load the extension in Chrome and verify:

- [ ] Open a video lesson → loop starts, video plays at 16×
- [ ] Simulate a failed completion (force `verify.tries = 1` via the service worker or just observe a real retry) → video replays at 5×
- [ ] `verify.tries = 2` → video replays at 2×
- [ ] `verify.tries = 3` → video replays at 1×
- [ ] After lesson passes, `verify` is cleared → next video plays at 16×
- [ ] Popup opens with no Behavior section visible
- [ ] No JS console errors in popup, service worker, or content scripts
- [ ] Dark/light theme and EN/VI language switch still work
