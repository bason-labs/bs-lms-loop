// content/controller.js — per-frame orchestrator + status badge (loaded last).
// Runs in every frame (manifest all_frames).
//   • A CHILD frame handles the media/quiz/doc it can see, then asks the top frame to advance.
//   • The TOP frame handles content it can see directly (simple LMS); for content that lives in
//     a child iframe (e.g. Open edX/HUTECH) it DEFERS, then clicks Next when the child signals
//     it's done (or after a safety timeout). Only the top frame navigates / stops / shows badge.
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});
  const isTop = window === window.top;
  let running = false;
  let aborted = false;
  let waitingAdvance = false;   // top frame: deferred, awaiting the child's ADVANCE
  let pendingAdvance = false;   // top frame: ADVANCE arrived before we deferred
  let fallbackTimer = 0;
  let lastLessonId = null;
  let stuckCount = 0;

  function badge(text, show = true) {
    if (!isTop) return; // only the top frame shows the status pill
    let el = document.getElementById('__lms_badge');
    if (!el) {
      el = document.createElement('div');
      el.id = '__lms_badge';
      el.title = 'Click to stop';
      el.addEventListener('click', async () => {
        NS.log?.('badge clicked — stopping the loop');
        aborted = true;
        waitingAdvance = false;
        clearTimeout(fallbackTimer);
        running = false;
        badge('stopped', false);
        NS.cursor?.hide();
        await chrome.runtime.sendMessage({ type: 'CONTROL', action: 'STOP' }).catch(() => {});
      });
      document.documentElement.appendChild(el);
    }
    el.textContent = `LMS Loop · ${text}`;
    el.classList.toggle('__lms_show', show);
  }

  // Returns: 'advanced' | 'disabled' | 'no-next'
  async function clickNext(config) {
    await NS.dom.sleep(config.delays.betweenLessonsMs);
    const next = NS.dom.findFirst(NS.selectors.primaryNextSelectors || [])
      || NS.dom.findClickableByText(NS.selectors.nextButtonText)
      || NS.dom.findFirst(NS.selectors.nextSelectors);
    if (!next) { NS.log?.('no Next control found — end of course'); return 'no-next'; }
    if (NS.dom.isDisabled(next)) { NS.log?.('Next is still disabled — lesson not complete yet'); return 'disabled'; }
    await NS.dom.clickVisible(next, 'Next');
    return 'advanced';
  }

  async function stop(reason, lastAction) {
    NS.log?.(reason);
    await chrome.runtime.sendMessage({ type: 'UPDATE_RUNSTATE', patch: { status: 'done', lastAction } }).catch(() => {});
  }

  // Top frame: click Next and react to the result. Used both for simple-LMS lessons
  // and when a child frame has signalled it's done.
  async function navigate(config) {
    const lessonId = NS.dom.deriveLessonId(location.href, document.title);
    const result = await clickNext(config);
    if (result === 'advanced') {
      stuckCount = 0;
      badge('advanced');
      if (config.mode === 'step') await chrome.runtime.sendMessage({ type: 'CONTROL', action: 'STOP' });
    } else if (result === 'no-next') {
      badge('done');
      await stop('no Next found — course complete, stopping', 'course-complete');
    } else { // 'disabled'
      badge('waiting');
      stuckCount = lessonId === lastLessonId ? stuckCount + 1 : 0;
      if (stuckCount >= 5) { badge('done'); await stop('stuck on the same lesson — stopping', 'stuck'); }
    }
    lastLessonId = lessonId;
  }

  function armFallback() {
    clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(() => { NS.log?.('no advance signal from frame — advancing (fallback)'); advance(); }, 135000);
  }

  // Top frame: perform the deferred advance once the child says it's done.
  async function advance() {
    if (!waitingAdvance) return;
    waitingAdvance = false;
    clearTimeout(fallbackTimer);
    if (aborted) { running = false; return; }
    try {
      const config = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
      await navigate(config);
    } catch (e) {
      NS.log?.('advance error:', e?.message || e);
    } finally {
      running = false;
    }
  }

  function isContentDocFrame() {
    if (isTop) return false;
    if (/(xblock|content|lesson|unit|module|courseware)/i.test(location.pathname)) return true;
    return ((document.body?.innerText || '').trim().length > 600);
  }

  async function runOnce() {
    if (running) return;
    running = true;
    aborted = false;
    try {
      const config = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });

      // Already-completed lesson → don't re-handle, just advance to the next one.
      if (isTop && NS.detector.lessonComplete()) {
        NS.log?.('[top] lesson already complete — advancing');
        badge('already done');
        if (!aborted) await navigate(config);
        return;
      }

      // TOP frame whose content lives in a child iframe → defer to that frame.
      if (isTop && !document.querySelector('video') && !NS.detector.hasQuiz() && NS.detector.contentIframe()) {
        NS.log?.('[top] content is in a child frame — deferring, will advance when it finishes');
        badge('watching lesson');
        await chrome.runtime.sendMessage({ type: 'UPDATE_RUNSTATE', patch: { lastAction: 'await-frame' } }).catch(() => {});
        waitingAdvance = true;
        armFallback();
        if (pendingAdvance) { pendingAdvance = false; advance(); } // child already finished
        return; // keep `running` locked until advance() releases it
      }

      // Otherwise classify and handle what THIS frame can see.
      await NS.dom.waitFor(() => NS.detector.hasPlayableVideo() || NS.detector.hasQuiz(), { timeout: 3500, interval: 300 });
      const { type } = NS.detector.classify();
      const lessonId = NS.dom.deriveLessonId(location.href, document.title);
      NS.log?.(`[${isTop ? 'top' : 'frame'}] classified as: ${type} · ${document.title}`);

      if (isTop) {
        badge(`handling ${type}`);
        await chrome.runtime.sendMessage({
          type: 'UPDATE_RUNSTATE',
          patch: { currentType: type, currentLessonId: lessonId, lastAction: `handle:${type}` }
        }).catch(() => {});

        if (type === 'video') await NS.video.handleVideo(config);
        else if (type === 'quiz' && NS.quiz) await NS.quiz.handleQuiz(config);
        else await NS.doc.handleDoc(lessonId, document.title);

        if (!aborted) await navigate(config);
        return;
      }

      // CHILD frame: handle local content, then ask the top frame to advance.
      let handled = false;
      if (type === 'video') { await NS.video.handleVideo(config); handled = true; }
      else if (type === 'quiz' && NS.quiz) { await NS.quiz.handleQuiz(config); handled = true; }
      else if (isContentDocFrame()) { await NS.doc.handleDoc(lessonId, document.title); handled = true; }

      if (handled && !aborted) {
        await chrome.runtime.sendMessage({ type: 'UPDATE_RUNSTATE', patch: { currentType: type } }).catch(() => {});
        NS.log?.('[frame] content handled — requesting advance');
        await chrome.runtime.sendMessage({ type: 'REQUEST_ADVANCE' }).catch(() => {});
      }
    } catch (e) {
      badge(`error: ${e?.message || e}`);
      if (isTop) await chrome.runtime.sendMessage({ type: 'UPDATE_RUNSTATE', patch: { error: String(e?.message || e) } }).catch(() => {});
    } finally {
      if (!waitingAdvance) running = false; // stay locked while deferred
    }
  }

  async function maybeRun() {
    if (running) return; // a handler is active (or we're deferred) — skip the poll
    const rs = await chrome.runtime.sendMessage({ type: 'GET_RUNSTATE' }).catch(() => null);
    const active = (rs?.status === 'running' || rs?.status === 'paused') && rs?.isTargetTab;
    badge(rs?.status || 'idle', active);
    if (!active) NS.cursor?.hide();
    if (rs?.status === 'running' && rs?.isTargetTab) runOnce();
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'RESUME') maybeRun();
    else if (msg?.type === 'ADVANCE' && isTop) { if (waitingAdvance) advance(); else pendingAdvance = true; }
  });

  // SPA resilience: re-evaluate after DOM settles (debounced).
  let t;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(maybeRun, 800); })
    .observe(document.documentElement, { childList: true, subtree: true });

  maybeRun();
})();
