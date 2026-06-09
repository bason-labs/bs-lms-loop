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

  function currentVerticalId() {
    const vert = location.href.match(/vertical\+block@([0-9a-f]+)/i);
    if (vert) return vert[1];
    const all = location.href.match(/block@([0-9a-f]+)/ig);
    return all ? all[all.length - 1].replace(/block@/i, '') : null;
  }

  function hasCompleteMarker(el) {
    if (!el) return false;
    if (/đã hoàn thành|đã hoàn tất|completed\b/i.test(el.textContent || '')) return true;
    return !!el.querySelector('[data-testid="check-circle-icon"], svg.text-success, .text-success');
  }

  // Is the unit identified by `token` (a vertical block id) marked complete in the outline?
  function isUnitComplete(token) {
    if (!token) return false;
    const link = [...document.querySelectorAll('a[href]')].find((a) => (a.getAttribute('href') || '').includes(token));
    return hasCompleteMarker(link ? (link.closest('li') || link) : null);
  }

  // Is the CURRENT lesson already completed? Match the outline link whose href holds this
  // unit's block id — more reliable than the active-row highlight.
  function lessonComplete() {
    if (isUnitComplete(currentVerticalId())) return true;
    const active = document.querySelector('li.bg-info-100') || document.querySelector('[aria-current="page"]');
    return hasCompleteMarker(active);
  }

  // True when we're on the course modules listing (not inside a lesson).
  // URL has a course path but no lesson-specific segments (courseware / vertical+block / xblock).
  function isCourseOverviewPage() {
    const url = location.href;
    if (!/\/courses\/|\/learning\/course\//i.test(url)) return false;
    if (/\/courseware\/|vertical\+block@|\/xblock\//i.test(url)) return false;
    return !!document.querySelector(NS.selectors.courseOutlineSelector);
  }

  // Scan the course outline for the first lesson link that lacks a completion marker.
  // Returns the href string, or null if every lesson is complete (or none found).
  function findFirstIncompleteLessonHref() {
    const links = [...document.querySelectorAll('a[href]')].filter((a) => {
      const h = a.getAttribute('href') || '';
      return /\/courseware\/[^/]+\/[^/]/.test(h) || /\/learning\/course\/.+\/block-v1/.test(h);
    });
    for (const a of links) {
      const container = a.closest('li') || a.closest('[class*="unit"]') || a.closest('[class*="section"]') || a.parentElement;
      if (!hasCompleteMarker(container)) return a.getAttribute('href');
    }
    return null;
  }

  NS.detector = { classify, hasPlayableVideo, hasQuiz, reachableVideo, contentIframe, lessonComplete, isUnitComplete, isCourseOverviewPage, findFirstIncompleteLessonHref };
})();
