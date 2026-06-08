// config/selectors.js — tunable heuristic profiles (classic script). Edit here to tune an LMS.
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});
  NS.selectors = {
    nextButtonText: ['next', 'continue', 'next lesson', 'proceed', 'tiếp', 'tiếp theo', 'tiếp tục', '次へ', '下一步', 'siguiente'],
    submitButtonText: ['submit', 'check', 'finish', 'done', 'nộp', 'kiểm tra', 'gửi', '提出', '提交'],
    nextSelectors: ['[data-testid*="next" i]', 'a.next-button', 'button.next-button', 'button.next', 'a.next', '.btn-next', '[aria-label*="next" i]'],
    submitSelectors: ['button[type="submit"]', '.btn-submit', '[data-testid*="submit" i]'],
    contentSelectors: ['main', 'article', '#content', '.lesson-content', '.content', '[role="main"]'],
    questionSelectors: ['.question', '.quiz-question', '[data-testid*="question" i]', 'legend', 'fieldset > p']
  };
})();
