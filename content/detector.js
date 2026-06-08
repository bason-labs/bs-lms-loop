// content/detector.js — classify the current lesson (classic script). Quiz added in Phase 3.
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});
  function hasPlayableVideo() {
    const v = document.querySelector('video');
    if (v && (v.readyState > 0 || v.duration > 0 || v.src || v.currentSrc)) return v;
    return document.querySelector('iframe[src*="youtube"],iframe[src*="vimeo"],iframe[src*="player"]') || null;
  }
  function classify() {
    if (hasPlayableVideo()) return { type: 'video' };
    return { type: 'doc' };
  }
  NS.detector = { classify, hasPlayableVideo };
})();
