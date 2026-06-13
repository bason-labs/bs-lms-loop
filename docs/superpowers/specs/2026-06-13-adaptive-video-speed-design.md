# Adaptive Video Speed Design

**Date:** 2026-06-13
**Status:** Approved

## Overview

Replace the user-configurable video speed slider with a hardcoded adaptive speed schedule that starts fast and steps down on each retry. Remove the entire Behavior section from the popup.

## Speed Schedule

| `verify.tries` | Speed | When |
|---|---|---|
| 0 | 16× | Normal first play |
| 1 | 5× | First retry (lesson not marked complete) |
| 2 | 2× | Second retry |
| ≥ 3 | 1× | Third retry and beyond (real-time) |

After a lesson passes, `verify` is cleared and the next lesson starts at tries=0 (16×).

## Components

### `content/controller.js`

- Rename `videoRetrySpeed(token)` → `videoPlaybackSpeed(token)`
- Replace the `Math.min(tries + 1, 5)` formula with a hardcoded table lookup:

```js
const SPEED_TABLE = [16, 5, 2, 1];
return SPEED_TABLE[Math.min(tries, SPEED_TABLE.length - 1)];
```

- Always returns a number (no longer returns `null` for tries=0), so the fallback to `config.video.playbackRate` in `content_video.js` is no longer needed.
- Update both call sites (top-frame line ~285 and child-frame line ~303) to use the new function name.

### `content/content_video.js`

- `handleVideo(config, retrySpeed)` → `handleVideo(config, speed)`
- Simplify `content_video.js:64`:
  - Before: `const rate = (retrySpeed != null ? retrySpeed : config.video.playbackRate) || 1;`
  - After: `const rate = speed || 1;`

### `lib/storage.js`

- Remove `playbackRate` from `DEFAULT_CONFIG.video`. The object becomes:
  ```js
  video: { skipToEnd: true, waitForTriggerMs: 1500 }
  ```
- `quiz.fallback` and `quiz.searchStrategy` remain in `DEFAULT_CONFIG` at their existing defaults (`'random'` and `'llm-only'`) — they are still read by backend logic, just no longer exposed in the popup.

### `popup/popup.html`

- Delete the entire `<section class="card reveal" style="--d:3">` Behavior block (the collapsible section containing the video speed slider, no-key quiz fallback, and quiz strategy toggles).

### `popup/popup.js`

- Remove `paintRate()` function.
- Remove `playbackRate` from `fill()` and `persist()`.
- Remove `fallback` and `quizStrategy` from `fill()` and `persist()`.
- Remove quiz-strategy disable logic from `syncProvider()` (keep only the baseUrl visibility and model placeholder logic).
- Change `['mode', 'fallback', 'quizStrategy'].forEach(...)` listener → `['mode']` only.
- Remove `$('playbackRate')` `input` and `change` listeners.
- Remove `$('adv-toggle')` click listener.
- Remove Behavior-related i18n keys from both `en` and `vi` dictionaries:
  `sec_behavior`, `lbl_video`, `lbl_fallback`, `fb_random`, `fb_skip`, `lbl_quiz_strategy`, `qs_llm_only`, `qs_llm_search`, `qs_note`.

## Testing

### Automated

- `test/storage.test.mjs`: The existing assertion `DEFAULT_CONFIG.quiz.fallback === 'random'` continues to pass. No new unit tests needed — `videoPlaybackSpeed` is a trivial table lookup with no async logic.

### Manual checklist

- [ ] Fresh install: video lesson plays at 16×
- [ ] After one failed completion check: lesson replays at 5×
- [ ] After two failed checks: replays at 2×
- [ ] After three or more failed checks: replays at 1×
- [ ] After lesson passes: next lesson plays at 16×
- [ ] Popup no longer shows Behavior section
- [ ] No JS errors in popup or service worker console

## Migration

No storage migration needed. `video.playbackRate` is removed from DEFAULT_CONFIG and is no longer written by `persist()`. Existing users with a stored `playbackRate` value are unaffected — `content_video.js` no longer reads it.
