// content/controller.js — Phase 1: reflect run-state in a floating badge.
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});
  function badge(text) {
    let el = document.getElementById('__lms_badge');
    if (!el) { el = document.createElement('div'); el.id = '__lms_badge'; document.documentElement.appendChild(el); }
    el.textContent = `LMS Loop: ${text}`;
  }
  async function maybeRun() {
    const rs = await chrome.runtime.sendMessage({ type: 'GET_RUNSTATE' }).catch(() => null);
    badge(rs?.status || 'idle');
  }
  chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === 'RESUME') maybeRun(); });
  NS.maybeRun = maybeRun;
  maybeRun();
})();
