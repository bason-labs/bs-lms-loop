// content/controller.js — per-frame orchestrator + status badge (loaded last).
// Runs in every frame (manifest all_frames). Each frame handles the media/quiz it can see;
// only the TOP frame navigates (Next), stops, and shows the badge. This matters for LMSes
// like Open edX (HUTECH) that render the lesson — including the <video> — inside a
// cross-origin iframe while the Next button lives in the parent page.
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});
  const isTop = window === window.top;
  let running = false;
  let lastLessonId = null;
  let stuckCount = 0;

  function badge(text, show = true) {
    if (!isTop) return; // only the top frame shows the status pill
    let el = document.getElementById('__lms_badge');
    if (!el) { el = document.createElement('div'); el.id = '__lms_badge'; document.documentElement.appendChild(el); }
    el.textContent = `LMS Loop · ${text}`;
    el.classList.toggle('__lms_show', show);
  }

  // Returns: 'advanced' | 'disabled' | 'no-next'
  async function clickNext(config) {
    await NS.dom.sleep(config.delays.betweenLessonsMs);
    const next = NS.dom.findClickableByText(NS.selectors.nextButtonText) || NS.dom.findFirst(NS.selectors.nextSelectors);
    if (!next) { NS.log?.('no Next control found — end of course'); return 'no-next'; }
    if (NS.dom.isDisabled(next)) { NS.log?.('Next is still disabled — lesson not complete yet'); return 'disabled'; }
    await NS.dom.clickVisible(next, 'Next');
    return 'advanced';
  }

  async function stop(reason, lastAction) {
    NS.log?.(reason);
    await chrome.runtime.sendMessage({ type: 'UPDATE_RUNSTATE', patch: { status: 'done', lastAction } }).catch(() => {});
  }

  async function runOnce() {
    if (running) return;
    running = true;
    try {
      const config = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
      // Let the frame settle — a player or quiz often mounts shortly after load.
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
      }

      // Handle whatever content lives in THIS frame. doc text is only captured by the top frame.
      if (type === 'video') await NS.video.handleVideo(config);
      else if (type === 'quiz' && NS.quiz) await NS.quiz.handleQuiz(config);
      else if (isTop) await NS.doc.handleDoc(lessonId, document.title);

      // Navigation + stop logic happen only in the top frame.
      if (!isTop) return;

      const result = await clickNext(config);
      if (result === 'advanced') {
        stuckCount = 0;
        badge(`advanced from ${type}`);
        if (config.mode === 'step') await chrome.runtime.sendMessage({ type: 'CONTROL', action: 'STOP' });
      } else if (result === 'no-next') {
        badge('done');
        await stop('no Next found — course complete, stopping', 'course-complete');
      } else { // 'disabled' — gate not satisfied yet; let the observer retry
        badge(`waiting (${type})`);
        stuckCount = lessonId === lastLessonId ? stuckCount + 1 : 0;
        if (stuckCount >= 5) { badge('done'); await stop('stuck on the same lesson — stopping', 'stuck'); }
      }
      lastLessonId = lessonId;
    } catch (e) {
      badge(`error: ${e?.message || e}`);
      if (isTop) await chrome.runtime.sendMessage({ type: 'UPDATE_RUNSTATE', patch: { error: String(e?.message || e) } }).catch(() => {});
    } finally {
      running = false;
    }
  }

  async function maybeRun() {
    if (running) return; // a handler is active; skip the poll until it finishes
    const rs = await chrome.runtime.sendMessage({ type: 'GET_RUNSTATE' }).catch(() => null);
    // Only act on the tab the loop is bound to (isTargetTab comes from the background;
    // it's true for every frame inside that tab).
    const active = (rs?.status === 'running' || rs?.status === 'paused') && rs?.isTargetTab;
    badge(rs?.status || 'idle', active);
    if (!active) NS.cursor?.hide();
    if (rs?.status === 'running' && rs?.isTargetTab) runOnce();
  }

  chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === 'RESUME') maybeRun(); });

  // SPA resilience: re-evaluate after DOM settles (debounced).
  let t;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(maybeRun, 800); })
    .observe(document.documentElement, { childList: true, subtree: true });

  maybeRun();
})();
