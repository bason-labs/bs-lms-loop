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
      if (submit) { NS.dom.simulateClick(submit); await NS.dom.sleep(config.delays.actionMs); }
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
