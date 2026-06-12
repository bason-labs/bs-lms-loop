# Quiz Solver Full Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Supersedes:** `docs/superpowers/plans/2026-06-12-quiz-solver-enhanced.md` (partial, pre-design). Use this file.

**Goal:** Upgrade the quiz solver to handle multiple-choice, dropdown, and fill-in-the-blank questions with a two-tier confidence-gated answer strategy (LLM-direct first, provider-native web search as automatic fallback), session-level answer cache, course title context, and a UI toggle for the search strategy.

**Architecture:** The content script scrapes all question groups (including course title from `.course-title`) and sends a structured payload to the service worker. The service worker checks a session cache (SHA-256 keyed, `chrome.storage.session`), runs Tier 1 (LLM-direct with confidence scores), and conditionally runs Tier 2 (provider-native search via Gemini grounding or OpenAI `/v1/responses`) when min confidence < 7 and the user has enabled LLM+Search. The answer is cached and returned; the content script applies it to each question group by input type (radio/checkbox, select, textarea/text).

**Tech Stack:** Vanilla ES6+, MV3 Chrome extension, `node:test` for unit tests (pure logic only — DOM/chrome.* verified manually).

---

## File Map

| File | Change |
|------|--------|
| `config/selectors.js` | Add `courseTitleSelector`, `quizContainerSelectors`, `subQuestionSelectors`, `subQuestionTextSelectors` |
| `config/app_config.js` | Add `export const QUIZ_CONFIDENCE_THRESHOLD = 7` |
| `lib/storage.js` | Add `searchStrategy: 'llm-only'` to `DEFAULT_CONFIG.quiz` |
| `lib/llm_adapter.js` | Add/update: `buildSolveMultiPrompt` (courseTitle + confidence), `parseMultiAnswerJson` (confidence field), `buildSearchRequest`, `parseSearchResponse` |
| `test/llm_adapter.test.mjs` | New tests for all four functions above |
| `content/content_quiz.js` | Full rewrite: `scrapeGroups`, `applyAnswer` (all input types), `handleQuiz` |
| `background/service_worker.js` | Rewrite `solveQuiz`: session cache + two-tier logic; update imports |
| `popup/popup.html` | Add quiz strategy seg control in Behavior section |
| `popup/popup.js` | Wire quiz strategy: fill, persist, syncProvider grey-out, i18n |

---

## Task 1: Config Foundations

**Files:**
- Modify: `config/selectors.js`
- Modify: `config/app_config.js`
- Modify: `lib/storage.js`

No unit tests needed — pure config values.

- [ ] **Step 1: Update `config/selectors.js`**

Add four new keys inside `NS.selectors = { ... }` before the closing `};`:

```js
// config/selectors.js
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});
  NS.selectors = {
    primaryNextSelectors: ['.unit-navigation a.next-button[href]', 'a.next-button[href]'],
    primaryPrevSelectors: ['.unit-navigation a.previous-button[href]', 'a.previous-button[href]'],
    nextButtonText: ['next', 'continue', 'next lesson', 'proceed', 'tiếp', 'tiếp theo', 'tiếp tục', '次へ', '下一步', 'siguiente'],
    prevButtonText: ['previous', 'back', 'trước', 'quay lại', '前へ', '上一步', 'anterior'],
    submitButtonText: ['submit', 'check', 'finish', 'done', 'nộp', 'kiểm tra', 'gửi', '提出', '提交'],
    nextSelectors: ['[data-testid*="next" i]', 'a.next-button', 'button.next-button', 'button.next', 'a.next', '.btn-next', '[aria-label*="next" i]'],
    submitSelectors: ['button[type="submit"]', '.btn-submit', '[data-testid*="submit" i]'],
    contentSelectors: ['main', 'article', '#content', '.lesson-content', '.content', '[role="main"]'],
    questionSelectors: ['.question', '.quiz-question', '[data-testid*="question" i]', 'legend', 'fieldset > p'],
    courseOutlineSelector: 'ol[sectionids], a[href*="/courseware/"]',

    courseTitleSelector: '.course-title',

    quizContainerSelectors: [
      '.problems-wrapper', '.problem-wrapper', '.xblock-student_view',
      '[data-block-type="problem"]', '.problem', 'form.problem-form'
    ],

    subQuestionSelectors: [
      '.wrapper-problem-response', 'fieldset',
      '[role="radiogroup"]', '[role="group"]',
      '.choicegroup', '.textinputgroup', '.numericalresponse', '.formulaequationinput'
    ],

    subQuestionTextSelectors: [
      'legend', '.question-description-text', '.question-text',
      '.problem-header', 'label.response-label', 'p'
    ]
  };
})();
```

- [ ] **Step 2: Update `config/app_config.js`**

Add one line at the end of the file:

```js
export const FIREBASE_PROJECT_ID = 'bs-llm-loop';
export const OAUTH_CLIENT_ID = '518594584743-sa3i8kc7u7v7ko7lihjs8isaavv6iegh.apps.googleusercontent.com';
export const QUIZ_CONFIDENCE_THRESHOLD = 7;
```

- [ ] **Step 3: Update `lib/storage.js` default config**

Find:
```js
  quiz: { useAiWhenKeyPresent: true, fallback: 'random', forceSubmit: true },
```
Replace with:
```js
  quiz: { useAiWhenKeyPresent: true, fallback: 'random', forceSubmit: true, searchStrategy: 'llm-only' },
```

- [ ] **Step 4: Syntax-check all three files**

```bash
node --check config/selectors.js && node --check config/app_config.js && node --check lib/storage.js
```
Expected: no output (no errors).

- [ ] **Step 5: Run full test suite to confirm no regressions**

```bash
node --test
```
Expected: all existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add config/selectors.js config/app_config.js lib/storage.js
git commit -m "feat(quiz): config foundations — selectors, confidence threshold, searchStrategy default"
```

---

## Task 2: `buildSolveMultiPrompt` with courseTitle + confidence

**Files:**
- Modify: `lib/llm_adapter.js`
- Modify: `test/llm_adapter.test.mjs`

- [ ] **Step 1: Write failing tests first**

Add to the end of `test/llm_adapter.test.mjs`:

```js
test('buildSolveMultiPrompt: system contains courseTitle when provided', () => {
  const msgs = buildSolveMultiPrompt({
    questions: [{ question: 'What is 2+2?', options: ['3', '4', '5'] }],
    courseTitle: 'Python 101'
  });
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[0].content, /Python 101/);
});

test('buildSolveMultiPrompt: system omits course line when courseTitle is empty', () => {
  const msgs = buildSolveMultiPrompt({
    questions: [{ question: 'Q?', options: ['a'] }],
    courseTitle: ''
  });
  assert.doesNotMatch(msgs[0].content, /course titled/);
});

test('buildSolveMultiPrompt: system requests confidence field', () => {
  const msgs = buildSolveMultiPrompt({ questions: [{ question: 'Q?', options: ['a'] }] });
  assert.match(msgs[0].content, /confidence/);
  assert.match(msgs[0].content, /10=certain/);
});

test('buildSolveMultiPrompt: user body has Q1/Q2 sections with numbered options', () => {
  const msgs = buildSolveMultiPrompt({
    questions: [
      { question: 'What is 2+2?', options: ['3', '4'] },
      { question: 'Capital of France?', options: ['Berlin', 'Paris'] }
    ],
    context: 'math stuff'
  });
  assert.match(msgs[1].content, /Q1: What is 2\+2\?/);
  assert.match(msgs[1].content, /0\. 3/);
  assert.match(msgs[1].content, /Q2: Capital of France\?/);
  assert.match(msgs[1].content, /1\. Paris/);
  assert.match(msgs[1].content, /math stuff/);
});

test('buildSolveMultiPrompt: text-input question has no Options section', () => {
  const msgs = buildSolveMultiPrompt({ questions: [{ question: 'Explain it:', options: [] }] });
  assert.doesNotMatch(msgs[1].content, /Options:/);
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
node --test test/llm_adapter.test.mjs 2>&1 | tail -20
```
Expected: failures on the new `buildSolveMultiPrompt` tests (`buildSolveMultiPrompt is not a function`).

- [ ] **Step 3: Add `buildSolveMultiPrompt` to `lib/llm_adapter.js`**

Add after the existing `buildSolvePrompt` function (around line 11):

```js
// Pure: multi-question prompt with confidence scoring and course title context.
// questions = [{question: string, options: string[]}]
export function buildSolveMultiPrompt({ questions, context = '', courseTitle = '' }) {
  const qText = questions
    .map((q, qi) => {
      const opts = q.options.map((o, i) => `  ${i}. ${o}`).join('\n');
      return `Q${qi + 1}: ${q.question}${opts ? '\nOptions:\n' + opts : ''}`;
    })
    .join('\n\n');

  const titleLine = courseTitle ? `This question is from a course titled: "${courseTitle}".\n` : '';
  const system =
    `${titleLine}You are answering quiz questions. Use ONLY the provided context when relevant. ` +
    'Reply with STRICT JSON only, no prose: ' +
    '{"answers":[{"qi":0,"answerIndices":[<int>...],"answerText":["..."],"confidence":<0-10>,"reason":"..."},...]}. ' +
    'confidence: 10=certain, 7=fairly sure, below 7=uncertain (factual recall needed). ' +
    'qi: zero-based question index. answerIndices: zero-based indices into that question\'s Options list. ' +
    'Select ALL correct options. For text-input questions leave answerIndices [] and put the answer in answerText.';

  const user = `Context:\n${context || '(none)'}\n\nQuestions:\n${qText}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
node --test test/llm_adapter.test.mjs 2>&1 | tail -20
```
Expected: all tests pass.

- [ ] **Step 5: Syntax-check**

```bash
node --check lib/llm_adapter.js
```
Expected: no output.

---

## Task 3: `parseMultiAnswerJson` with confidence field

**Files:**
- Modify: `lib/llm_adapter.js`
- Modify: `test/llm_adapter.test.mjs`

- [ ] **Step 1: Write failing tests**

Add to the end of `test/llm_adapter.test.mjs`:

```js
test('parseMultiAnswerJson: returns array with qi, answerIndices, answerText, confidence', () => {
  const raw = '{"answers":[{"qi":0,"answerIndices":[1],"answerText":[],"confidence":9,"reason":"sure"}]}';
  const result = parseMultiAnswerJson(raw);
  assert.equal(result.length, 1);
  assert.equal(result[0].qi, 0);
  assert.deepEqual(result[0].answerIndices, [1]);
  assert.equal(result[0].confidence, 9);
  assert.equal(result[0].reason, 'sure');
});

test('parseMultiAnswerJson: confidence defaults to 10 when missing', () => {
  const raw = '{"answers":[{"qi":0,"answerIndices":[0],"answerText":[]}]}';
  const result = parseMultiAnswerJson(raw);
  assert.equal(result[0].confidence, 10);
});

test('parseMultiAnswerJson: text-input answer has answerText, empty answerIndices', () => {
  const raw = '{"answers":[{"qi":1,"answerIndices":[],"answerText":["Paris"],"confidence":8,"reason":"capital"}]}';
  const result = parseMultiAnswerJson(raw);
  assert.deepEqual(result[0].answerIndices, []);
  assert.deepEqual(result[0].answerText, ['Paris']);
});

test('parseMultiAnswerJson: returns null when answers key missing', () => {
  assert.equal(parseMultiAnswerJson('{"other":[]}'), null);
});

test('parseMultiAnswerJson: tolerates surrounding prose', () => {
  const raw = 'Here you go: {"answers":[{"qi":0,"answerIndices":[2],"answerText":[],"confidence":7,"reason":"r"}]} done';
  const result = parseMultiAnswerJson(raw);
  assert.equal(result[0].qi, 0);
  assert.deepEqual(result[0].answerIndices, [2]);
});

test('parseMultiAnswerJson: drops null/empty indices', () => {
  const raw = '{"answers":[{"qi":0,"answerIndices":[null,"",3],"answerText":[],"confidence":10,"reason":""}]}';
  const result = parseMultiAnswerJson(raw);
  assert.deepEqual(result[0].answerIndices, [3]);
});

test('parseMultiAnswerJson: returns null on garbage', () => {
  assert.equal(parseMultiAnswerJson('no json here'), null);
  assert.equal(parseMultiAnswerJson(null), null);
  assert.equal(parseMultiAnswerJson(''), null);
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
node --test test/llm_adapter.test.mjs 2>&1 | tail -20
```
Expected: failures on `parseMultiAnswerJson` tests.

- [ ] **Step 3: Add `parseMultiAnswerJson` to `lib/llm_adapter.js`**

Add after the existing `parseAnswerJson` function (around line 82):

```js
// Pure: extract structured multi-question answer array from LLM text.
// Returns [{qi, answerIndices, answerText, confidence, reason}] or null.
export function parseMultiAnswerJson(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]);
    if (!Array.isArray(obj.answers)) return null;
    return obj.answers.map((a) => ({
      qi: Number.isInteger(a.qi) ? a.qi : 0,
      answerIndices: Array.isArray(a.answerIndices)
        ? a.answerIndices.filter((v) => v !== null && v !== '').map(Number).filter(Number.isInteger)
        : [],
      answerText: Array.isArray(a.answerText)
        ? a.answerText.map(String)
        : a.answerText != null ? [String(a.answerText)] : [],
      confidence: Number.isFinite(a.confidence) ? Math.round(a.confidence) : 10,
      reason: a.reason ? String(a.reason) : ''
    }));
  } catch { return null; }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
node --test test/llm_adapter.test.mjs 2>&1 | tail -20
```
Expected: all tests pass.

- [ ] **Step 5: Syntax-check and full suite**

```bash
node --check lib/llm_adapter.js && node --test
```
Expected: no errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/llm_adapter.js test/llm_adapter.test.mjs
git commit -m "feat(quiz): buildSolveMultiPrompt + parseMultiAnswerJson with confidence scoring"
```

---

## Task 4: `buildSearchRequest` + `parseSearchResponse`

**Files:**
- Modify: `lib/llm_adapter.js`
- Modify: `test/llm_adapter.test.mjs`

- [ ] **Step 1: Write failing tests**

Add to the end of `test/llm_adapter.test.mjs`:

```js
test('buildSearchRequest gemini: same endpoint + googleSearch tool added', () => {
  const msgs = buildSolveMultiPrompt({ questions: [{ question: 'q', options: ['a'] }] });
  const r = buildSearchRequest('gemini', { apiKey: 'k', model: 'gemini-1.5-flash' }, msgs);
  assert.match(r.url, /generativelanguage\.googleapis\.com/);
  assert.ok(Array.isArray(r.body.tools));
  assert.deepEqual(r.body.tools[0], { googleSearch: {} });
});

test('buildSearchRequest openai: /v1/responses endpoint + web_search_preview tool', () => {
  const msgs = buildSolveMultiPrompt({ questions: [{ question: 'q', options: ['a'] }] });
  const r = buildSearchRequest('openai', { apiKey: 'k', model: 'gpt-4o' }, msgs);
  assert.match(r.url, /\/v1\/responses/);
  assert.equal(r.headers.authorization, 'Bearer k');
  assert.ok(Array.isArray(r.body.input));
  assert.deepEqual(r.body.tools[0], { type: 'web_search_preview' });
});

test('buildSearchRequest unsupported provider throws', () => {
  assert.throws(() => buildSearchRequest('anthropic', { apiKey: 'k' }, []));
  assert.throws(() => buildSearchRequest('custom', { apiKey: 'k' }, []));
});

test('parseSearchResponse gemini: delegates to parseResponse', () => {
  const json = { candidates: [{ content: { parts: [{ text: 'answer' }] } }] };
  assert.equal(parseSearchResponse('gemini', json), 'answer');
});

test('parseSearchResponse openai: extracts text from output array', () => {
  const json = {
    output: [
      { type: 'web_search_call', id: 'ws_1' },
      { type: 'message', content: [{ type: 'output_text', text: '{"answers":[]}' }] }
    ]
  };
  assert.equal(parseSearchResponse('openai', json), '{"answers":[]}');
});

test('parseSearchResponse openai: returns empty string on missing output', () => {
  assert.equal(parseSearchResponse('openai', {}), '');
  assert.equal(parseSearchResponse('openai', { output: [] }), '');
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
node --test test/llm_adapter.test.mjs 2>&1 | tail -20
```
Expected: failures on `buildSearchRequest` and `parseSearchResponse` tests.

- [ ] **Step 3: Add both functions to `lib/llm_adapter.js`**

Add after the existing `callLlm` export at the end of the file:

```js
// Pure: search-enabled request descriptor for Gemini (grounding) and OpenAI (Responses API).
// Throws for unsupported providers — caller must guard with provider check before calling.
export function buildSearchRequest(provider, cfg, messages) {
  const { apiKey, model, baseUrl } = cfg;
  const sys = messages.find((m) => m.role === 'system')?.content ?? '';
  const turns = messages.filter((m) => m.role !== 'system');

  switch (provider) {
    case 'gemini': {
      const base = buildRequest('gemini', cfg, messages);
      return { ...base, body: { ...base.body, tools: [{ googleSearch: {} }] } };
    }
    case 'openai':
      return {
        url: `${baseUrl || 'https://api.openai.com'}/v1/responses`,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: {
          model,
          input: [
            { role: 'system', content: sys },
            ...turns.map((m) => ({ role: m.role, content: m.content }))
          ],
          tools: [{ type: 'web_search_preview' }]
        }
      };
    default:
      throw new Error(`Search not supported for provider: ${provider}`);
  }
}

// Pure: normalise search-path response to plain text (same shape as parseResponse output).
export function parseSearchResponse(provider, json) {
  if (provider === 'gemini') return parseResponse('gemini', json);
  if (provider === 'openai') {
    const msg = (json?.output ?? []).find((o) => o.type === 'message');
    return (msg?.content ?? []).map((c) => c.text ?? '').join('');
  }
  return '';
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
node --test test/llm_adapter.test.mjs 2>&1 | tail -20
```
Expected: all tests pass.

- [ ] **Step 5: Syntax-check and full suite**

```bash
node --check lib/llm_adapter.js && node --test
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/llm_adapter.js test/llm_adapter.test.mjs
git commit -m "feat(quiz): buildSearchRequest + parseSearchResponse for Gemini grounding + OpenAI Responses API"
```

---

## Task 5: Enhanced `content/content_quiz.js` — All Input Types

**Files:**
- Modify: `content/content_quiz.js`

This is browser-only code — no unit tests. Verified manually in Task 8.

- [ ] **Step 1: Replace entire `content/content_quiz.js`**

```js
// content/content_quiz.js — multi-question scraper, confidence-gated solver, all input types.
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});

  // Extract visible text, converting img[alt] → inline "[image: alt]" tokens so the LLM
  // has visual context without a vision API call.
  function extractText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('img[alt]').forEach((img) => {
      const alt = img.getAttribute('alt').trim();
      if (alt) img.replaceWith(document.createTextNode(` [image: ${alt}] `));
    });
    return NS.dom.norm(clone.innerText);
  }

  // All radio/checkbox inputs in a container, with their label text.
  function extractOptions(container) {
    return [...container.querySelectorAll('input[type="radio"],input[type="checkbox"]')]
      .map((input, i) => {
        const label =
          input.closest('label') ||
          (input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`)) ||
          input.parentElement;
        return { index: i, text: NS.dom.norm(label?.innerText) || `option ${i}`, input };
      });
  }

  // Best question text from a sub-question container.
  function findQuestionText(container) {
    for (const sel of NS.selectors.subQuestionTextSelectors || ['legend', 'p', 'label']) {
      const el = container.querySelector(sel);
      const t = extractText(el);
      if (t && t.length > 4) return t;
    }
    return extractText(container).slice(0, 300);
  }

  // Outermost quiz block on the page.
  function findQuizContainer() {
    for (const sel of NS.selectors.quizContainerSelectors || ['.problem']) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return document.body;
  }

  // Introductory paragraphs before the first sub-question (shared scenario/passage text).
  function extractLeadContext(container, firstSubQ) {
    if (!firstSubQ) return '';
    const lines = [];
    for (const p of container.querySelectorAll('p, .problem-header, .introduction')) {
      if (firstSubQ.contains(p)) break;
      if (p.compareDocumentPosition(firstSubQ) & Node.DOCUMENT_POSITION_FOLLOWING) {
        const t = extractText(p);
        if (t) lines.push(t);
      }
    }
    return lines.join(' ').slice(0, 800);
  }

  // Returns { courseTitle, groups: [{question, options, textInputs}] }
  function scrapeGroups() {
    const courseTitle = NS.dom.norm(
      document.querySelector(NS.selectors.courseTitleSelector)?.innerText
    ) || '';

    const container = findQuizContainer();

    let subQContainers = [];
    for (const sel of NS.selectors.subQuestionSelectors || ['fieldset']) {
      subQContainers = [...container.querySelectorAll(sel)];
      if (subQContainers.length) break;
    }

    // Fallback: treat the whole container as one question.
    if (!subQContainers.length) {
      const qEl = NS.dom.findFirst(NS.selectors.questionSelectors);
      const question = (qEl ? extractText(qEl) : '') || document.title.trim();
      const options = extractOptions(container);
      const textInputs = [...container.querySelectorAll('textarea,input[type="text"],select')];
      return { courseTitle, groups: [{ question, options, textInputs }] };
    }

    const leadContext = extractLeadContext(container, subQContainers[0]);
    const prefix = leadContext ? `${leadContext}\n\n` : '';

    const groups = subQContainers.map((sub) => ({
      question: prefix + findQuestionText(sub),
      options: extractOptions(sub),
      textInputs: [...sub.querySelectorAll('textarea,input[type="text"],select')]
    }));
    return { courseTitle, groups };
  }

  // Apply one answer object to one group's DOM inputs (radio/checkbox, select, textarea/text).
  async function applyAnswer(group, answerIndices, answerTexts) {
    if (group.options.length && answerIndices.length) {
      const chosen = new Set(answerIndices);
      for (const o of group.options) {
        if (chosen.has(o.index) && !o.input.checked) await NS.dom.clickVisible(o.input, 'Answer');
      }
    }
    if (group.textInputs.length) {
      const val = (answerTexts && answerTexts[0]) || 'N/A';
      for (const ti of group.textInputs) {
        if (ti.tagName === 'SELECT') {
          const match = [...ti.options].find((o) => o.text.toLowerCase().includes(val.toLowerCase()));
          if (match) { match.selected = true; ti.dispatchEvent(new Event('change', { bubbles: true })); }
        } else {
          await NS.dom.typeVisible(ti, val, 'Type');
        }
      }
    }
  }

  async function handleQuiz(config) {
    if (!config.llm.apiKey) { NS.log?.('quiz: no API key — skipping'); return { ok: true, skipped: true }; }

    const { courseTitle, groups } = scrapeGroups();
    const payload = {
      courseTitle,
      questions: groups.map((g) => ({ question: g.question, options: g.options.map((o) => o.text) }))
    };

    const res = await chrome.runtime.sendMessage({ type: 'SOLVE_QUIZ', payload }).catch(() => null);
    if (!res?.answers) {
      NS.log?.('quiz: solver unavailable — skipping', res?.error || '');
      return { ok: true, skipped: true };
    }

    for (const ans of res.answers) {
      const group = groups[ans.qi];
      if (!group) continue;
      await applyAnswer(group, ans.answerIndices, ans.answerText);
    }

    if (config.quiz.forceSubmit) {
      const submit =
        NS.dom.findClickableByText(NS.selectors.submitButtonText) ||
        NS.dom.findFirst(NS.selectors.submitSelectors);
      if (submit) { await NS.dom.clickVisible(submit, 'Submit'); await NS.dom.sleep(config.delays.actionMs); }
    }
    return { ok: true };
  }

  NS.quiz = { scrapeGroups, handleQuiz };
})();
```

- [ ] **Step 2: Syntax-check**

```bash
node --check content/content_quiz.js
```
Expected: no output.

- [ ] **Step 3: Run full test suite**

```bash
node --test
```
Expected: all pass (this file has no unit tests).

- [ ] **Step 4: Commit**

```bash
git add content/content_quiz.js
git commit -m "feat(quiz): rewrite scraper — multi-question groups, image alt, select, course title"
```

---

## Task 6: Two-Tier `solveQuiz()` with Session Cache in `background/service_worker.js`

**Files:**
- Modify: `background/service_worker.js`

Browser-only — verified manually in Task 8.

- [ ] **Step 1: Update the import line at the top of `background/service_worker.js`**

Find:
```js
import { callLlm } from '../lib/llm_adapter.js';
```
Replace with:
```js
import { buildSolveMultiPrompt, parseMultiAnswerJson, buildSearchRequest, parseSearchResponse, buildRequest, parseResponse } from '../lib/llm_adapter.js';
import { QUIZ_CONFIDENCE_THRESHOLD } from '../config/app_config.js';
```

- [ ] **Step 2: Add `hashQuestions` helper before `solveQuiz`**

Find the comment `// Phase 4: live solver` and insert before it:

```js
async function hashQuestions(questions) {
  const text = questions.map((q) => q.question + q.options.join('|')).join('||');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return 'qcache_' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 3: Replace the entire `solveQuiz` function**

Find the existing `solveQuiz` function (starts at `// Phase 4: live solver`):
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
```

Replace with:

```js
// Assemble RAG context, run Tier 1 (LLM-direct), optionally Tier 2 (provider-native search),
// cache in chrome.storage.session for the duration of the browser session.
async function solveQuiz(payload) {
  const config = await getConfig();
  if (!config.llm.apiKey) return { error: 'NO_KEY' };

  const questions = payload.questions;
  if (!Array.isArray(questions) || !questions.length) return { error: 'NO_QUESTIONS' };

  // Session cache: skip both tiers if this exact question set was solved this session.
  const cacheKey = await hashQuestions(questions);
  const cached = (await chrome.storage.session.get(cacheKey).catch(() => ({}))[cacheKey]);
  if (cached) return cached;

  const kb = await getKb();
  const context = kb.order
    .map((id) => kb.lessons[id])
    .filter((l) => l && l.type === 'doc' && l.text)
    .map((l) => l.text)
    .join('\n\n')
    .slice(0, 12000);

  const messages = buildSolveMultiPrompt({
    questions,
    context,
    courseTitle: payload.courseTitle || ''
  });

  try {
    // Tier 1: LLM-direct.
    const req1 = buildRequest(config.llm.provider, config.llm, messages);
    const raw1 = await fetch(req1.url, { method: 'POST', headers: req1.headers, body: JSON.stringify(req1.body) });
    if (!raw1.ok) throw new Error(`LLM HTTP ${raw1.status}: ${(await raw1.text()).slice(0, 200)}`);
    let answers = parseMultiAnswerJson(parseResponse(config.llm.provider, await raw1.json()));
    if (!answers) throw new Error('LLM returned unparseable answer');

    // Tier 2: search if any answer is low-confidence and the user opted in.
    const minConfidence = Math.min(...answers.map((a) => a.confidence ?? 10));
    const searchEnabled = config.quiz?.searchStrategy === 'llm-search'
      && ['gemini', 'openai'].includes(config.llm.provider);

    if (minConfidence < QUIZ_CONFIDENCE_THRESHOLD && searchEnabled) {
      try {
        const req2 = buildSearchRequest(config.llm.provider, config.llm, messages);
        const raw2 = await fetch(req2.url, { method: 'POST', headers: req2.headers, body: JSON.stringify(req2.body) });
        if (raw2.ok) {
          const answers2 = parseMultiAnswerJson(parseSearchResponse(config.llm.provider, await raw2.json()));
          if (answers2) answers = answers2; // keep Tier 1 result if Tier 2 is unparseable
        }
      } catch { /* Tier 2 failed — keep Tier 1 answers */ }
    }

    const result = { answers };
    await chrome.storage.session.set({ [cacheKey]: result }).catch(() => {});
    return result;
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}
```

- [ ] **Step 4: Syntax-check**

```bash
node --check background/service_worker.js
```
Expected: no output.

- [ ] **Step 5: Run full test suite**

```bash
node --test
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add background/service_worker.js
git commit -m "feat(quiz): two-tier solveQuiz with session cache + confidence-gated search"
```

---

## Task 7: UI Toggle — Quiz Strategy in Popup

**Files:**
- Modify: `popup/popup.html`
- Modify: `popup/popup.js`

Browser-only — verified manually in Task 8.

- [ ] **Step 1: Add quiz strategy field to `popup/popup.html`**

Find the closing `</div>` of the `adv-body` section (after the fallback seg group, around line 125):
```html
      </div>
    </div>
  </section>
```

Insert the new field **before** the closing `</div>` of `adv-body`:

```html
      <div class="field">
        <label class="field-label" data-i18n="lbl_quiz_strategy">Quiz strategy</label>
        <div class="seg" data-group="quizStrategy" role="group" aria-label="Quiz answer strategy">
          <button type="button" class="seg-btn" data-value="llm-only" data-i18n="qs_llm_only">LLM&nbsp;Only</button>
          <button type="button" class="seg-btn" data-value="llm-search" data-i18n="qs_llm_search">LLM&nbsp;+&nbsp;Search</button>
        </div>
        <p id="quiz-strategy-note" class="field-note" hidden data-i18n="qs_note">Search requires Gemini or OpenAI</p>
      </div>
```

So the full `adv-body` div ends:
```html
    <div id="adv-body" class="adv-body" hidden>
      <div class="field">
        <!-- video speed range — unchanged -->
      </div>

      <div class="field">
        <!-- fallback seg — unchanged -->
      </div>

      <div class="field">
        <label class="field-label" data-i18n="lbl_quiz_strategy">Quiz strategy</label>
        <div class="seg" data-group="quizStrategy" role="group" aria-label="Quiz answer strategy">
          <button type="button" class="seg-btn" data-value="llm-only" data-i18n="qs_llm_only">LLM&nbsp;Only</button>
          <button type="button" class="seg-btn" data-value="llm-search" data-i18n="qs_llm_search">LLM&nbsp;+&nbsp;Search</button>
        </div>
        <p id="quiz-strategy-note" class="field-note" hidden data-i18n="qs_note">Search requires Gemini or OpenAI</p>
      </div>
    </div>
```

- [ ] **Step 2: Add i18n strings to `popup/popup.js`**

In the `I18N` object, add to both `en` and `vi` entries.

Find in `en`:
```js
    fb_random: 'Random fill', fb_skip: 'Skip',
```
Replace with:
```js
    fb_random: 'Random fill', fb_skip: 'Skip',
    lbl_quiz_strategy: 'Quiz strategy',
    qs_llm_only: 'LLM Only', qs_llm_search: 'LLM + Search',
    qs_note: 'Search requires Gemini or OpenAI',
```

Find in `vi`:
```js
    fb_random: 'Điền ngẫu nhiên', fb_skip: 'Bỏ qua',
```
Replace with:
```js
    fb_random: 'Điền ngẫu nhiên', fb_skip: 'Bỏ qua',
    lbl_quiz_strategy: 'Chiến lược trắc nghiệm',
    qs_llm_only: 'Chỉ AI', qs_llm_search: 'AI + Tìm kiếm',
    qs_note: 'Tìm kiếm yêu cầu Gemini hoặc OpenAI',
```

- [ ] **Step 3: Wire the toggle in `popup/popup.js` — `fill()`, `persist()`, `syncProvider()`**

Find the `fill(cfg)` function:
```js
function fill(cfg) {
  setGroup('provider', cfg.llm.provider);
  setGroup('mode', cfg.mode);
  setGroup('fallback', cfg.quiz.fallback);
  $('apiKey').value = cfg.llm.apiKey;
  $('model').value = cfg.llm.model;
  $('baseUrl').value = cfg.llm.baseUrl;
  $('playbackRate').value = cfg.video.playbackRate;
  paintRate();
  syncProvider();
}
```
Replace with:
```js
function fill(cfg) {
  setGroup('provider', cfg.llm.provider);
  setGroup('mode', cfg.mode);
  setGroup('fallback', cfg.quiz.fallback);
  setGroup('quizStrategy', cfg.quiz.searchStrategy || 'llm-only');
  $('apiKey').value = cfg.llm.apiKey;
  $('model').value = cfg.llm.model;
  $('baseUrl').value = cfg.llm.baseUrl;
  $('playbackRate').value = cfg.video.playbackRate;
  paintRate();
  syncProvider();
}
```

Find the `persist()` function:
```js
  cfg.quiz.fallback = getGroup('fallback');
```
Add one line after it:
```js
  cfg.quiz.fallback = getGroup('fallback');
  cfg.quiz.searchStrategy = getGroup('quizStrategy') || 'llm-only';
```

Find the `syncProvider()` function:
```js
function syncProvider() {
  const p = getGroup('provider');
  $('baseUrl-field').hidden = p !== 'custom';
  $('model').placeholder = MODEL_HINT[p] || 'model';
}
```
Replace with:
```js
function syncProvider() {
  const p = getGroup('provider');
  $('baseUrl-field').hidden = p !== 'custom';
  $('model').placeholder = MODEL_HINT[p] || 'model';

  const searchSupported = p === 'gemini' || p === 'openai';
  const searchBtn = groupEl('quizStrategy').querySelector('[data-value="llm-search"]');
  searchBtn.classList.toggle('is-disabled', !searchSupported);
  searchBtn.disabled = !searchSupported;
  $('quiz-strategy-note').hidden = searchSupported;

  // If provider no longer supports search, reset strategy to llm-only and save.
  if (!searchSupported && getGroup('quizStrategy') === 'llm-search') {
    setGroup('quizStrategy', 'llm-only');
    persist();
  }
}
```

- [ ] **Step 4: Wire the click listener for `quizStrategy`**

Find:
```js
['mode', 'fallback'].forEach((name) => {
```
Replace with:
```js
['mode', 'fallback', 'quizStrategy'].forEach((name) => {
```

- [ ] **Step 5: Syntax-check popup.js**

```bash
node --check popup/popup.js
```
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add popup/popup.html popup/popup.js
git commit -m "feat(quiz): add LLM Only / LLM+Search strategy toggle in popup Behavior section"
```

---

## Task 8: Manual Verification Checklist

Load the unpacked extension: `chrome://extensions` → Developer mode → Load unpacked → select this folder. Open an Open edX course. Open DevTools Console (filter: `LMS`).

**A — Multiple-choice (radio)**
- [ ] Navigate to a lesson with one MCQ. Start loop.
- [ ] Console: `classified as: quiz`. The correct radio is selected. Submit clicked. Loop advances.

**B — Multiple-choice (checkbox, multi-select)**
- [ ] Navigate to a question where multiple checkboxes are correct.
- [ ] All correct checkboxes are checked. Submit clicked. Loop advances.

**C — Multi-question Problem block (edX)**
- [ ] Navigate to a lesson with 2+ sub-questions.
- [ ] In console run: `NS.quiz.scrapeGroups()` — verify `groups` array has N entries, each with a distinct `question` string.
- [ ] All sub-questions filled. Submit clicked once. Loop advances.

**D — Dropdown (`<select>`) question**
- [ ] Navigate to a dropdown question. Start loop.
- [ ] The `<select>` option matching the AI answer (case-insensitive text match) is selected.

**E — Fill-in-the-blank (`textarea` / `input[type="text"]`)**
- [ ] Navigate to a free-response question. Start loop.
- [ ] The text field is filled with a plausible answer. Submit clicked.

**F — Image in question**
- [ ] Navigate to a question containing an `<img>` with `alt` text.
- [ ] In console: `NS.quiz.scrapeGroups().groups[0].question` contains `[image: <alt text>]`.

**G — Course title extraction**
- [ ] On a page with `.course-title` visible.
- [ ] In console: `NS.quiz.scrapeGroups().courseTitle` returns the course name (not empty string).

**H — LLM + Search strategy (Gemini or OpenAI)**
- [ ] In popup: Behavior → Quiz strategy → select "LLM + Search". Save.
- [ ] Navigate to a factual/hard question the LLM is uncertain about.
- [ ] Console: no errors. Answer filled (either Tier 1 or Tier 2).

**I — LLM Only strategy**
- [ ] In popup: set strategy to "LLM Only".
- [ ] Confirm search is never triggered (only one LLM call visible in Network tab → service worker).

**J — Provider reset (search greyed out)**
- [ ] Set strategy to "LLM + Search" with Gemini provider.
- [ ] Switch provider to Anthropic.
- [ ] Confirm: "LLM + Search" button is greyed out and disabled. Note text appears. Strategy resets to "LLM Only".

**K — Session cache**
- [ ] Solve a quiz lesson. Navigate away. Navigate back to same lesson (without closing browser).
- [ ] Console: `quiz: cache hit` log — no new LLM call in Network tab.

**L — No API key (skip path)**
- [ ] Clear API key from popup.
- [ ] Navigate to quiz lesson. Console: `quiz: no API key — skipping`. Loop advances.

**M — Regression: video + doc lessons**
- [ ] Run a full loop through a section with video, doc, and quiz lessons.
- [ ] No JS errors. Video plays through. Doc text captured. Quiz answered. Loop completes.

---

## Self-Review

**Spec coverage:**
- ✅ Multiple-choice radio/checkbox → `extractOptions` + `applyAnswer`
- ✅ Dropdown select → `applyAnswer` SELECT branch with text match
- ✅ Fill-in-the-blank → `applyAnswer` `typeVisible` branch
- ✅ Course title from `.course-title` → `scrapeGroups`, sent in payload
- ✅ Confidence 0–10 per answer → `buildSolveMultiPrompt` prompt + `parseMultiAnswerJson`
- ✅ Confidence threshold = 7, configurable → `QUIZ_CONFIDENCE_THRESHOLD` in `app_config.js`
- ✅ Tier 2 Gemini → `buildSearchRequest('gemini')` adds `tools:[{googleSearch:{}}]`
- ✅ Tier 2 OpenAI → `buildSearchRequest('openai')` uses `/v1/responses` + `web_search_preview`
- ✅ Tier 2 fallback to Tier 1 on failure → try/catch in `solveQuiz`
- ✅ Session cache → `hashQuestions` + `chrome.storage.session`
- ✅ UI toggle LLM Only / LLM+Search → popup HTML + JS
- ✅ Auto-reset strategy on unsupported provider change → `syncProvider`
- ✅ Default `searchStrategy: 'llm-only'` → `DEFAULT_CONFIG`
- ✅ Image alt text in question → `extractText` img→text conversion
- ✅ Lead context paragraphs → `extractLeadContext` prepended to sub-question text

**Type consistency:**
- `scrapeGroups()` → `{ courseTitle: string, groups: [{question, options: [{index, text, input}], textInputs}] }`
- `payload.questions` → `[{question: string, options: string[]}]` (text-only, no DOM refs)
- `buildSolveMultiPrompt({questions, context, courseTitle})` — matches `payload` shape
- `parseMultiAnswerJson` → `[{qi, answerIndices, answerText, confidence, reason}]`
- `res.answers[i]` passed as `(ans.answerIndices, ans.answerText)` to `applyAnswer(group, ...)` — consistent across Tasks 5 and 6
- `buildSearchRequest(provider, cfg, messages)` — same `messages` shape from `buildSolveMultiPrompt`
- `parseSearchResponse(provider, json)` → `string` → `parseMultiAnswerJson` — consistent

**Placeholder scan:** None found. All steps contain exact code, file paths, and expected command output.
