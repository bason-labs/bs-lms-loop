// config/selectors.js — tunable heuristic profiles (classic script). Edit here to tune an LMS.
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});
  NS.selectors = {
    // Tried first — the explicit course-navigation link (marks the unit complete on click).
    primaryNextSelectors: ['.unit-navigation a.next-button[href]', 'a.next-button[href]'],
    primaryPrevSelectors: ['.unit-navigation a.previous-button[href]', 'a.previous-button[href]'],
    nextButtonText: ['next', 'continue', 'next lesson', 'proceed', 'tiếp', 'tiếp theo', 'tiếp tục', '次へ', '下一步', 'siguiente'],
    prevButtonText: ['previous', 'back', 'trước', 'quay lại', '前へ', '上一步', 'anterior'],
    submitButtonText: ['submit', 'check', 'finish', 'done', 'nộp', 'kiểm tra', 'gửi', '提出', '提交'],
    nextSelectors: ['[data-testid*="next" i]', 'a.next-button', 'button.next-button', 'button.next', 'a.next', '.btn-next', '[aria-label*="next" i]'],
    submitSelectors: ['button[type="submit"]', '.btn-submit', '[data-testid*="submit" i]'],
    contentSelectors: ['main', 'article', '#content', '.lesson-content', '.content', '[role="main"]'],
    questionSelectors: ['.question', '.quiz-question', '[data-testid*="question" i]', 'legend', 'fieldset > p'],
    courseOutlineSelector: 'a[href*="/courseware/"], a[href*="/learning/course/"]'
  };
})();
