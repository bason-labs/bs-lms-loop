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
