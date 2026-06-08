// lib/dom_utils.js — DOM helpers shared via window.__LMS (classic script).
// Only norm/deriveLessonId are pure; the rest touch document/window at CALL time.
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function deriveLessonId(url, title = '') {
    let path = url;
    try { const u = new URL(url); path = u.pathname + u.hash; } catch { /* keep raw */ }
    const basis = `${path}::${norm(title)}`.trim();
    let h = 5381;
    for (let i = 0; i < basis.length; i++) h = ((h << 5) + h + basis.charCodeAt(i)) >>> 0;
    return 'L' + h.toString(36);
  }

  function waitFor(fnOrSel, { timeout = 8000, interval = 200 } = {}) {
    const test = typeof fnOrSel === 'function' ? fnOrSel : () => document.querySelector(fnOrSel);
    return new Promise((resolve) => {
      const start = Date.now();
      (function tick() {
        let r; try { r = test(); } catch { r = null; }
        if (r) return resolve(r);
        if (Date.now() - start >= timeout) return resolve(null);
        setTimeout(tick, interval);
      })();
    });
  }

  function findClickableByText(candidates) {
    const wanted = candidates.map(norm);
    const els = [...document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"]')];
    return els.find((el) => {
      const t = norm(el.innerText || el.value || el.getAttribute('aria-label'));
      return t && wanted.some((w) => t === w || t.includes(w));
    }) || null;
  }

  function findFirst(selectors) {
    for (const sel of selectors) { const el = document.querySelector(sel); if (el) return el; }
    return null;
  }

  function simulateClick(el) {
    if (!el) return false;
    el.scrollIntoView?.({ block: 'center' });
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    return true;
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter ? setter.call(el, value) : (el.value = value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Visible variants: move the synthetic cursor to the element first, then act.
  async function clickVisible(el, caption) {
    if (!el) return false;
    if (NS.cursor) await NS.cursor.actClick(el, caption);
    return simulateClick(el);
  }
  async function typeVisible(el, value, caption) {
    if (!el) return false;
    if (NS.cursor) await NS.cursor.moveTo(el, caption);
    setNativeValue(el, value);
    return true;
  }

  NS.dom = {
    norm, sleep, deriveLessonId, waitFor, findClickableByText, findFirst,
    simulateClick, setNativeValue, clickVisible, typeVisible
  };
})();
