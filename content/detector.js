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

  // A child iframe that likely holds the lesson body (Open edX puts content in a
  // cross-origin iframe). Used by the top frame to defer handling to that frame.
  function contentIframe() {
    return document.querySelector('iframe#unit-iframe, iframe.unit-iframe, iframe[src*="/xblock/"], iframe[src*="/content/"]')
      || document.querySelector(PLAYER_IFRAME)
      || [...document.querySelectorAll('iframe')].find((f) => {
        const r = f.getBoundingClientRect();
        return r.height >= 360 && r.width >= 420;
      })
      || null;
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

  // Is the CURRENT lesson already completed? (read from the course outline in the top frame)
  function lessonComplete() {
    const active = document.querySelector('li.bg-info-100') || document.querySelector('[aria-current="page"]');
    if (!active) return false;
    if (/đã hoàn thành|đã hoàn tất|completed\b/i.test(active.textContent || '')) return true;
    return !!active.querySelector('[data-testid="check-circle-icon"], .text-success');
  }

  NS.detector = { classify, hasPlayableVideo, hasQuiz, reachableVideo, contentIframe, lessonComplete };
})();
