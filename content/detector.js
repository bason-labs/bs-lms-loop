// content/detector.js — classify the current lesson (classic script).
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});

  // Common embedded-player iframe hosts/paths.
  const PLAYER_IFRAME = [
    'iframe[src*="youtube"]', 'iframe[src*="youtu.be"]', 'iframe[src*="vimeo"]',
    'iframe[src*="player"]', 'iframe[src*="embed"]', 'iframe[src*="kaltura"]',
    'iframe[src*="jwplayer"]', 'iframe[src*="jwplatform"]', 'iframe[src*="wistia"]',
    'iframe[src*="brightcove"]', 'iframe[src*="vidyard"]', 'iframe[src*="vdocipher"]',
    'iframe[src*="/video"]', 'iframe[src*="media"]'
  ].join(',');

  // Any <video> we can reach — in the page or inside a same-origin iframe.
  function reachableVideo() {
    const v = document.querySelector('video');
    if (v) return v;
    for (const f of document.querySelectorAll('iframe')) {
      try { const iv = f.contentDocument?.querySelector('video'); if (iv) return iv; } catch { /* cross-origin */ }
    }
    return null;
  }

  function hasPlayableVideo() {
    return reachableVideo() || document.querySelector(PLAYER_IFRAME) || null;
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

  NS.detector = { classify, hasPlayableVideo, hasQuiz, reachableVideo };
})();
