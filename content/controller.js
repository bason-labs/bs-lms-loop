// content/controller.js — per-page orchestrator + status badge (loaded last).
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});
  let running = false;
  let lastLessonId = null;
  let stuckCount = 0;

  function badge(text, show = true) {
    let el = document.getElementById('__lms_badge');
    if (!el) { el = document.createElement('div'); el.id = '__lms_badge'; document.documentElement.appendChild(el); }
    el.textContent = `LMS Loop · ${text}`;
    el.classList.toggle('__lms_show', show); // only visible while the loop is active
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
      // Let the lesson settle: a player or quiz form often mounts shortly after load.
      // Don't fall through to "doc" until we've given video/quiz a chance to appear.
      await NS.dom.waitFor(() => NS.detector.hasPlayableVideo() || NS.detector.hasQuiz(), { timeout: 3500, interval: 300 });
      const { type } = NS.detector.classify();
      const lessonId = NS.dom.deriveLessonId(location.href, document.title);
      NS.log?.('lesson classified as:', type, '·', document.title);
      badge(`handling ${type}`);
      await chrome.runtime.sendMessage({
        type: 'UPDATE_RUNSTATE',
        patch: { currentType: type, currentLessonId: lessonId, lastAction: `handle:${type}` }
      });

      if (type === 'video') await NS.video.handleVideo(config);
      else if (type === 'quiz' && NS.quiz) await NS.quiz.handleQuiz(config);
      else await NS.doc.handleDoc(lessonId, document.title);

      const result = await clickNext(config);
      if (result === 'advanced') {
        stuckCount = 0;
        badge(`advanced from ${type}`);
        if (config.mode === 'step') await chrome.runtime.sendMessage({ type: 'CONTROL', action: 'STOP' });
      } else if (result === 'no-next') {
        badge('done');
        await stop('no Next found — course complete, stopping', 'course-complete');
      } else { // 'disabled' — lesson gate not satisfied yet; let the observer retry
        badge(`waiting (${type})`);
        stuckCount = lessonId === lastLessonId ? stuckCount + 1 : 0;
        if (stuckCount >= 5) { badge('done'); await stop('stuck on the same lesson — stopping', 'stuck'); }
      }
      lastLessonId = lessonId;
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
    // Only act on the tab the loop is bound to (isTargetTab comes from the background).
    const active = (rs?.status === 'running' || rs?.status === 'paused') && rs?.isTargetTab;
    badge(rs?.status || 'idle', active); // hidden unless this is the active loop tab
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
