// config/selectors.js — tunable heuristic profiles (classic script). Edit here to tune an LMS.
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
