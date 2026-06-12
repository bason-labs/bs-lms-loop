# Quiz Solver Enhancement — Design Spec

**Date:** 2026-06-12
**Status:** Approved

---

## Goal

Upgrade the quiz solver to reliably handle all three question types (multiple-choice, dropdown select, fill-in-the-blank) with a confidence-gated two-tier answer strategy: cheap LLM-direct first, provider-native web search as an automatic fallback when confidence is low. A session cache eliminates repeat LLM calls on lesson retries.

---

## Scope

- **In scope:** Multiple-choice (radio/checkbox), dropdown (`<select>`), fill-in-the-blank (`textarea`, `input[type="text"]`), confidence-gated search, session cache, UI toggle, course title context extraction.
- **Out of scope:** Anthropic / Custom provider search (not supported by those APIs). Retry on wrong answer (loop moves on — by design). Persistent cross-session answer cache.

---

## Architecture

Two-tier pipeline, all quiz solving stays in the service worker:

```
content_quiz.js                    service_worker.js                LLM API
───────────────                    ─────────────────                ───────
scrapeGroups()
+ courseTitle (.course-title)
        │
        │  SOLVE_QUIZ { questions, courseTitle }
        ▼
                           hash(questions) → session cache hit?
                                   │ no
                                   ▼
                           Tier 1: LLM-direct
                           prompt includes courseTitle + KB context
                           requests confidence 0–10 per answer
                                   │                                ──▶ call
                                   ▼
                           min(confidence) < 7
                           AND searchStrategy = 'llm-search'
                           AND provider ∈ {gemini, openai}?
                                   │ yes
                                   ▼
                           Tier 2: same prompt
                           + provider-native search enabled          ──▶ call
                                   │
                                   ▼
                           write to session cache
                           return { answers }
        │
        ▼
applyAnswer() per group
(radio / checkbox / select / text)
```

**Key properties:**
- Confident answers (≥ 7/10) cost exactly one LLM text call.
- Repeated questions within a session cost zero (session cache).
- Wrong answers are accepted; loop advances (no retry).

---

## Components

### 1. Course Title Extraction

**Selector:** `courseTitleSelector: '.course-title'` added to `config/selectors.js`.

Extracted in `content_quiz.js` inside `scrapeGroups()`:
```js
const courseTitle = NS.dom.norm(
  document.querySelector(NS.selectors.courseTitleSelector)?.innerText
) || '';
```

Included in every `SOLVE_QUIZ` message as `payload.courseTitle`. Used in the LLM prompt as: *"This question is from a course titled: {courseTitle}."*

### 2. Confidence Threshold

Added to `config/app_config.js`:
```js
export const QUIZ_CONFIDENCE_THRESHOLD = 7;
```

Imported by `background/service_worker.js`. Tunable without touching logic.

### 3. LLM Prompt — Confidence Scoring

`buildSolveMultiPrompt({ questions, context, courseTitle })` updated system prompt:

```
You are answering quiz questions from a course titled: "{courseTitle}".
Use ONLY the provided context when relevant.
Reply with STRICT JSON only, no prose:
{"answers":[{"qi":0,"answerIndices":[<int>...],"answerText":["..."],"confidence":<0-10>,"reason":"..."},...]}
confidence: 10 = certain, 7 = fairly sure, below 7 = uncertain (factual recall needed).
qi: zero-based question index.
answerIndices: zero-based indices into that question's Options list. Select ALL correct options.
For text-input questions leave answerIndices [] and put the answer in answerText.
```

`parseMultiAnswerJson` updated to extract `confidence`, defaulting to `10` when missing (fail-open — avoids burning search tokens on malformed responses):
```js
confidence: Number.isFinite(a.confidence) ? Math.round(a.confidence) : 10
```

### 4. Provider-Specific Search

**Gemini** — same endpoint, one extra body field:
```js
// buildSearchRequest('gemini', cfg, messages):
body: { ...existingGeminiBody, tools: [{ googleSearch: {} }] }
```

**OpenAI** — different endpoint and body shape:
```js
// buildSearchRequest('openai', cfg, messages):
{
  url: `${baseUrl || 'https://api.openai.com'}/v1/responses`,
  headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
  body: {
    model,
    input: messages.map(m => ({ role: m.role, content: m.content })),
    tools: [{ type: 'web_search_preview' }]
  }
}

// parseSearchResponse('openai', json):
// json.output[] → find {type:'message'} → content[{type:'output_text'}] → .text
```

**Anthropic / Custom** — `buildSearchRequest` throws `UnsupportedSearchProvider`. The confidence gate already guards against calling this for non-Gemini/OpenAI providers.

New exports in `lib/llm_adapter.js`:
- `buildSearchRequest(provider, cfg, messages)` — search-enabled request descriptor
- `parseSearchResponse(provider, json)` — normalises search response to plain text

`parseMultiAnswerJson` is then applied to that text identically to Tier 1.

### 5. Session Cache

Storage: `chrome.storage.session` (MV3, cleared on browser close).

Cache key: SHA-256 hash of question text + options (computed in service worker using `crypto.subtle`):
```js
async function hashQuestions(questions) {
  const text = questions.map(q => q.question + q.options.join('|')).join('||');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return 'qcache_' + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('');
}
```

What is cached: the full `{ answers }` result — whichever tier produced it.
Cache hit returns immediately, skipping both tiers entirely.

### 6. `solveQuiz()` Logic (service_worker.js)

```
1. Check session cache → return if hit
2. Tier 1: buildSolveMultiPrompt(questions, courseTitle, context)
           buildRequest(provider, cfg, messages)
           fetch → parseResponse → parseMultiAnswerJson
3. minConfidence = min(answers[*].confidence)
4. if minConfidence < QUIZ_CONFIDENCE_THRESHOLD
      AND config.quiz.searchStrategy === 'llm-search'
      AND provider ∈ {gemini, openai}:
     Tier 2: buildSearchRequest(provider, cfg, messages)
             fetch → parseSearchResponse → parseMultiAnswerJson
             if Tier 2 succeeds → use Tier 2 answers (replace Tier 1)
             if Tier 2 throws / returns null → keep Tier 1 answers (fallback)
5. Store result in session cache
6. Return { answers }
```

### 7. UI Toggle — Quiz Strategy

Added to the popup quiz settings section, styled as two tabs matching the existing provider selector pattern:

```
Quiz Strategy
┌─────────────────┐  ┌─────────────────┐
│   LLM Only      │  │  LLM + Search   │
└─────────────────┘  └─────────────────┘
```

- **LLM Only** (default): Tier 1 only, no search regardless of confidence. Works for all providers.
- **LLM + Search**: Confidence-gated Tier 2 for Gemini/OpenAI. Toggle is greyed out with tooltip *"Search requires Gemini or OpenAI"* when another provider is active. If the user switches provider away from Gemini/OpenAI while `llm-search` is active, `searchStrategy` resets to `'llm-only'` automatically.

Stored as `config.quiz.searchStrategy: 'llm-only' | 'llm-search'` in `chrome.storage.local`.

Default in `lib/storage.js`: `searchStrategy: 'llm-only'`.

### 8. Answer Application — All Three Types

`applyAnswer(group, answerIndices, answerTexts, config)` in `content_quiz.js` handles:

| Input type | Detection | Action |
|-----------|-----------|--------|
| `input[type="radio"]` / `input[type="checkbox"]` | `group.options.length > 0` | Click inputs at `answerIndices` |
| `select` | `ti.tagName === 'SELECT'` | Find `<option>` whose text contains `answerTexts[0]` (case-insensitive); set `.selected`, dispatch `change` event |
| `textarea` / `input[type="text"]` | `ti.type === 'text' \|\| ti.tagName === 'TEXTAREA'` | `NS.dom.typeVisible(ti, answerTexts[0])` |

---

## Data Flow Summary

```
payload in:   { questions: [{question, options}], courseTitle }
cache key:    SHA-256(questions text)
LLM prompt:   system(courseTitle) + user(context + questions + numbered options)
LLM response: { answers: [{ qi, answerIndices, answerText, confidence, reason }] }
payload out:  { answers }   (same shape whether from cache, Tier 1, or Tier 2)
```

---

## Files Changed

| File | Change |
|------|--------|
| `config/selectors.js` | Add `courseTitleSelector`, `quizContainerSelectors`, `subQuestionSelectors`, `subQuestionTextSelectors` |
| `config/app_config.js` | Add `QUIZ_CONFIDENCE_THRESHOLD = 7` |
| `lib/storage.js` | Default `config.quiz.searchStrategy = 'llm-only'` |
| `lib/llm_adapter.js` | Update `buildSolveMultiPrompt` (courseTitle, confidence); update `parseMultiAnswerJson` (confidence field); add `buildSearchRequest`; add `parseSearchResponse` |
| `test/llm_adapter.test.mjs` | Tests for `buildSolveMultiPrompt` with courseTitle; `parseMultiAnswerJson` confidence field; `buildSearchRequest` (Gemini + OpenAI); `parseSearchResponse` |
| `background/service_worker.js` | `solveQuiz()`: session cache + two-tier logic; import `QUIZ_CONFIDENCE_THRESHOLD` |
| `content/content_quiz.js` | `scrapeGroups()` extracts courseTitle; `handleQuiz()` sends it in payload; `applyAnswer()` handles select |
| `popup/popup.js` + `popup.html` | Quiz strategy two-tab toggle; save/load `searchStrategy`; grey-out logic for non-Gemini/OpenAI providers |

---

## Testing

**Unit tests** (`node:test`, pure logic only):
- `buildSolveMultiPrompt`: courseTitle in system prompt, confidence instruction present
- `parseMultiAnswerJson`: confidence extracted; defaults to 10 when missing
- `buildSearchRequest`: Gemini adds `tools:[{googleSearch:{}}]`; OpenAI uses `/v1/responses` with `web_search_preview`
- `parseSearchResponse`: OpenAI output array parsed correctly
- `buildSearchRequest`: throws on Anthropic/Custom

**Manual checklist** (browser, real LMS):
- [ ] Single MCQ: Tier 1 selects correct radio, advances
- [ ] Multi-question block: all sub-questions filled, one Submit click
- [ ] Dropdown: `<select>` option matched and selected
- [ ] Fill-in-the-blank: textarea filled with LLM answer
- [ ] Low-confidence question + LMS + Search enabled: Tier 2 fires (check console log)
- [ ] Low-confidence question + LMS + Search disabled: Tier 1 result used
- [ ] Repeated lesson (retry): console shows "cache hit", no LLM call
- [ ] Non-Gemini/OpenAI provider: LLM+Search toggle is greyed out
- [ ] No API key: quiz skipped, loop advances
- [ ] Course title present: `.course-title` text appears in LLM prompt (log it)
- [ ] Course title absent: empty string sent, no crash
