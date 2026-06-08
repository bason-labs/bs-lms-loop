// content/controller.js — per-page orchestrator + status badge (loaded last).
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});
  let running = false;

  function badge(text) {
    let el = document.getElementById('__lms_badge');
    if (!el) { el = document.createElement('div'); el.id = '__lms_badge'; document.documentElement.appendChild(el); }
    el.textContent = `LMS Loop: ${text}`;
  }

  async function clickNext(config) {
    await NS.dom.sleep(config.delays.betweenLessonsMs);
    const next = NS.dom.findClickableByText(NS.selectors.nextButtonText) || NS.dom.findFirst(NS.selectors.nextSelectors);
    return next ? NS.dom.simulateClick(next) : false;
  }

  async function runOnce() {
    if (running) return;
    running = true;
    try {
      const config = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
      const { type } = NS.detector.classify();
      const lessonId = NS.dom.deriveLessonId(location.href, document.title);
      badge(`handling ${type}`);
      await chrome.runtime.sendMessage({
        type: 'UPDATE_RUNSTATE',
        patch: { currentType: type, currentLessonId: lessonId, lastAction: `handle:${type}` }
      });

      if (type === 'video') await NS.video.handleVideo(config);
      else if (type === 'quiz' && NS.quiz) await NS.quiz.handleQuiz(config);
      else await NS.doc.handleDoc(lessonId, document.title);

      const advanced = await clickNext(config);
      badge(advanced ? `advanced from ${type}` : `no Next (${type})`);
      if (config.mode === 'step') await chrome.runtime.sendMessage({ type: 'CONTROL', action: 'STOP' });
    } catch (e) {
      badge(`error: ${e?.message || e}`);
      await chrome.runtime.sendMessage({ type: 'UPDATE_RUNSTATE', patch: { error: String(e?.message || e) } }).catch(() => {});
    } finally {
      running = false;
    }
  }

  async function maybeRun() {
    if (running) return; // a handler is active; skip the GET_RUNSTATE poll until it finishes
    const rs = await chrome.runtime.sendMessage({ type: 'GET_RUNSTATE' }).catch(() => null);
    badge(rs?.status || 'idle');
    if (rs?.status === 'running') runOnce();
  }

  chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === 'RESUME') maybeRun(); });

  // SPA resilience: re-evaluate after DOM settles (debounced).
  let t;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(maybeRun, 800); })
    .observe(document.documentElement, { childList: true, subtree: true });

  maybeRun();
})();
