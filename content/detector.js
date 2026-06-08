// content/detector.js — classify the current lesson (classic script).
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});
  function hasPlayableVideo() {
    const v = document.querySelector('video');
    if (v && (v.readyState > 0 || v.duration > 0 || v.src || v.currentSrc)) return v;
    return document.querySelector('iframe[src*="youtube"],iframe[src*="vimeo"],iframe[src*="player"]') || null;
  }
  function hasQuiz() {
    const inputs = document.querySelectorAll('input[type="radio"],input[type="checkbox"],textarea,input[type="text"]');
    const submit = NS.dom.findClickableByText(NS.selectors.submitButtonText) || NS.dom.findFirst(NS.selectors.submitSelectors);
    return inputs.length > 0 && !!submit;
  }
  function classify() {
    if (hasPlayableVideo()) return { type: 'video' };
    if (hasQuiz()) return { type: 'quiz' };
    return { type: 'doc' };
  }
  NS.detector = { classify, hasPlayableVideo, hasQuiz };
})();
