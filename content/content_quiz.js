// content/content_quiz.js — scrape question/options, solve via worker or fall back, then submit.
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});

  function scrape() {
    const qEl = NS.dom.findFirst(NS.selectors.questionSelectors);
    const question = (qEl?.innerText || document.title).trim();
    const choiceInputs = [...document.querySelectorAll('input[type="radio"],input[type="checkbox"]')];
    const options = choiceInputs.map((input, i) => {
      const label = input.closest('label')
        || (input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`))
        || input.parentElement;
      return { index: i, text: NS.dom.norm(label?.innerText) || `option ${i}`, input };
    });
    const textInputs = [...document.querySelectorAll('textarea,input[type="text"]')];
    return { question, options, textInputs };
  }

  async function selectAndSubmit(indices, texts, scraped, config) {
    if (scraped.options.length && indices.length) {
      const chosen = new Set(indices);
      for (const o of scraped.options) {
        if (chosen.has(o.index) && !o.input.checked) await NS.dom.clickVisible(o.input, 'Answer');
      }
    }
    if (scraped.textInputs.length) {
      const val = texts[0] || 'N/A';
      for (const ti of scraped.textInputs) await NS.dom.typeVisible(ti, val, 'Type');
    }
    if (config.quiz.forceSubmit) {
      const submit = NS.dom.findClickableByText(NS.selectors.submitButtonText) || NS.dom.findFirst(NS.selectors.submitSelectors);
      if (submit) { await NS.dom.clickVisible(submit, 'Submit'); await NS.dom.sleep(config.delays.actionMs); }
    }
    return { ok: true };
  }

  async function handleQuiz(config) {
    // No API key → skip the quiz and move to the next lesson.
    if (!config.llm.apiKey) { NS.log?.('quiz: no API key — skipping to next lesson'); return { ok: true, skipped: true }; }

    const scraped = scrape();
    const res = await chrome.runtime.sendMessage({
      type: 'SOLVE_QUIZ',
      payload: { question: scraped.question, options: scraped.options.map((o) => o.text) }
    }).catch(() => null);

    if (res?.answer) return selectAndSubmit(res.answer.answerIndices, res.answer.answerText, scraped, config);
    NS.log?.('quiz: solver unavailable — skipping to next lesson', res?.error || '');
    return { ok: true, skipped: true };
  }

  NS.quiz = { scrape, handleQuiz };
})();
