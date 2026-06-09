// content/controller.js — per-frame orchestrator + status badge (loaded last).
// Runs in every frame (manifest all_frames).
//   • A CHILD frame handles the media/quiz/doc it can see, then asks the top frame to advance.
//   • The TOP frame handles content it can see directly (simple LMS); for content that lives in
//     a child iframe (e.g. Open edX) it DEFERS, then clicks Next when the child signals
//     it's done (or after a safety timeout). Only the top frame navigates / stops / shows badge.
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});
  const isTop = window === window.top;
  let running = false;
  let aborted = false;
  let userStopped = false;
  let waitingAdvance = false;   // top frame: deferred, awaiting the child's ADVANCE
  let pendingAdvance = false;   // top frame: ADVANCE arrived before we deferred
  let pendingType = null;
  let pendingToken = null;
  let currentToken = null;      // token of the lesson the top frame is currently on
  let fallbackTimer = 0;
  let lastLessonId = null;
  let stuckCount = 0;
  let processingAdvance = false;
  const MAX_BACK_RETRIES = 3;

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
    fallbackTimer = setTimeout(() => { NS.log?.('no advance signal from frame — advancing (fallback)'); doNavigate(); }, 200000);
  }

  // Top frame: actually release the deferred state and click Next.
  async function doNavigate() {
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

  // Top frame on the course overview page: wait for the outline to populate,
  // then navigate to the first lesson that isn't already marked complete.
  async function goToFirstIncompleteLesson(config) {
    badge('scanning outline');
    await NS.dom.waitFor(
      () => document.querySelector(NS.selectors.courseOutlineSelector),
      { timeout: 8000, interval: 400 }
    );
    if (aborted) return;
    const href = NS.detector.findFirstIncompleteLessonHref();
    if (!href) {
      badge('done');
      await stop('course overview: all lessons complete', 'course-complete');
      return;
    }
    NS.log?.(`[course] navigating to first incomplete lesson: ${href}`);
    badge('navigating');
    await NS.dom.sleep(config.delays.betweenLessonsMs);
    if (aborted) return;
    const link = [...document.querySelectorAll('a[href]')].find((a) => a.getAttribute('href') === href);
    if (link) {
      await NS.dom.clickVisible(link, 'first incomplete lesson');
    } else {
      location.href = href;
    }
  }

  async function clickPrevious() {
    const prev = NS.dom.findFirst(NS.selectors.primaryPrevSelectors || [])
      || NS.dom.findClickableByText(NS.selectors.prevButtonText || []);
    if (!prev) { NS.log?.('no Previous control — cannot go back'); return false; }
    await NS.dom.clickVisible(prev, 'Back');
    return true;
  }

  // Top frame: a child frame finished. The video lesson is marked done by edX only when we
  // NAVIGATE, so we just click Next here; if it turns out it wasn't marked done, the next
  // page's verify step (in runOnce) will go Back and redo it.
  async function onAdvanceSignal(lessonType, token) {
    if (token && currentToken && token !== currentToken) { NS.log?.('ignoring stale advance signal from another lesson'); return; }
    if (!waitingAdvance) { pendingAdvance = true; pendingType = lessonType; pendingToken = token; return; }
    if (processingAdvance) return;
    processingAdvance = true;
    try {
      if (lessonType === 'video' && currentToken) {
        // Remember this video so the next page can verify it actually got marked complete.
        const rs = await chrome.runtime.sendMessage({ type: 'GET_RUNSTATE' }).catch(() => null);
        const tries = rs?.verify?.token === currentToken ? rs.verify.tries : 0;
        await chrome.runtime.sendMessage({ type: 'UPDATE_RUNSTATE', patch: { verify: { token: currentToken, tries } } }).catch(() => {});
      }
      await doNavigate();
    } finally {
      processingAdvance = false;
    }
  }

  function isContentDocFrame() {
    if (isTop) return false;
    if (/(xblock|content|lesson|unit|module|courseware)/i.test(location.pathname)) return true;
    return ((document.body?.innerText || '').trim().length > 600);
  }

  // Is this page somewhere the loop actually operates? Keeps the badge/automation off
  // unrelated pages the bound tab may navigate to (images, dashboards, blank pages…).
  function onLessonPage() {
    if (/course|learning|courseware|xblock|lesson|unit|module|sequential|vertical/i.test(location.href)) return true;
    return !!(NS.detector.contentIframe() || document.querySelector('video') || NS.detector.hasQuiz());
  }

  // Stable per-lesson token shared by the parent page and its content iframe
  // (Open edX puts the same `vertical+block@<id>` in both URLs). Lets the top frame's
  // completion verdict reach the child frame so it won't play already-passed videos.
  function lessonToken() {
    const vert = location.href.match(/vertical\+block@([0-9a-f]+)/i);
    if (vert) return vert[1];
    const all = location.href.match(/block@([0-9a-f]+)/ig);
    return all ? all[all.length - 1] : null;
  }

  // Child frame: wait for the top frame's completion verdict for this lesson.
  // Must outlast the top frame's outline-render wait so we don't time out and play.
  async function waitForEval(token, timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const rs = await chrome.runtime.sendMessage({ type: 'GET_RUNSTATE' }).catch(() => null);
      if (rs?.eval && rs.eval.vid === token) return rs.eval;
      await NS.dom.sleep(200);
    }
    return null;
  }

  async function runOnce() {
    if (running) return;
    running = true;
    aborted = false;
    try {
      const config = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });

      // New lesson on the top frame → drop any advance signal left over from the previous one.
      if (isTop) { pendingAdvance = false; pendingType = null; pendingToken = null; }

      // Course overview page → navigate to the first incomplete lesson and exit.
      // Must come before the verify/eval block so we don't try to handle it as a lesson.
      if (isTop && NS.detector.isCourseOverviewPage()) {
        await goToFirstIncompleteLesson(config);
        return;
      }

      // Top frame: verify a video we just advanced past actually got marked done.
      // If not (and we've moved on from it), go BACK to that lesson and redo it.
      if (isTop) {
        const rs = await chrome.runtime.sendMessage({ type: 'GET_RUNSTATE' }).catch(() => null);
        const v = rs?.verify;
        if (v?.token && lessonToken() !== v.token) {
          await NS.dom.waitFor(() => document.querySelector('#outline-sidebar-outline, .outline-sidebar, li.bg-info-100'), { timeout: 3000, interval: 250 });
          const done = await NS.dom.waitFor(() => NS.detector.isUnitComplete(v.token), { timeout: 3000, interval: 300 });
          if (done) {
            NS.log?.('verify: previous video is marked complete');
            await chrome.runtime.sendMessage({ type: 'UPDATE_RUNSTATE', patch: { verify: null } }).catch(() => {});
          } else if ((v.tries || 0) < MAX_BACK_RETRIES) {
            NS.log?.(`verify: previous video not complete — going back to redo (try ${(v.tries || 0) + 1}/${MAX_BACK_RETRIES})`);
            badge('redo video');
            await chrome.runtime.sendMessage({ type: 'UPDATE_RUNSTATE', patch: { verify: { token: v.token, tries: (v.tries || 0) + 1 } } }).catch(() => {});
            if (await clickPrevious()) return; // went back; the lesson reloads and re-runs
            await chrome.runtime.sendMessage({ type: 'UPDATE_RUNSTATE', patch: { verify: null } }).catch(() => {}); // no Back control
          } else {
            NS.log?.('verify: still not complete after retries — moving on');
            await chrome.runtime.sendMessage({ type: 'UPDATE_RUNSTATE', patch: { verify: null } }).catch(() => {});
          }
        }
      }

      // Top frame: publish a completion verdict for this lesson so the content iframe
      // can read it (and skip playing an already-passed video).
      if (isTop) {
        // Wait for the course outline to render so completion is actually readable.
        await NS.dom.waitFor(() => document.querySelector('#outline-sidebar-outline, .outline-sidebar, li.bg-info-100'), { timeout: 3000, interval: 250 });
        const complete = NS.detector.lessonComplete();
        await chrome.runtime.sendMessage({ type: 'UPDATE_RUNSTATE', patch: { eval: { vid: lessonToken(), complete } } }).catch(() => {});
        if (complete) {
          NS.log?.('[top] lesson already complete — advancing without handling');
          badge('already done');
          if (!aborted) await navigate(config);
          return;
        }
      }

      // TOP frame whose content lives in a child iframe → defer to that frame.
      if (isTop && !document.querySelector('video') && !NS.detector.hasQuiz() && NS.detector.contentIframe()) {
        NS.log?.('[top] content is in a child frame — deferring, will advance when it finishes');
        badge('watching lesson');
        await chrome.runtime.sendMessage({ type: 'UPDATE_RUNSTATE', patch: { lastAction: 'await-frame' } }).catch(() => {});
        waitingAdvance = true;
        currentToken = lessonToken();
        armFallback();
        if (pendingAdvance) { pendingAdvance = false; onAdvanceSignal(pendingType, pendingToken); } // child already finished
        return; // keep `running` locked until doNavigate() releases it
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

      // CHILD frame: if the top frame says this lesson is already complete, stand down
      // (don't play the video) — the top frame will navigate to the next lesson.
      const token = lessonToken();
      if (token) {
        const ev = await waitForEval(token);
        if (ev && ev.complete) { NS.log?.('[frame] lesson already complete — not playing'); return; }
      }

      // CHILD frame: handle local content, then ask the top frame to advance.
      let handled = false;
      if (type === 'video') { await NS.video.handleVideo(config); handled = true; }
      else if (type === 'quiz' && NS.quiz) { await NS.quiz.handleQuiz(config); handled = true; }
      else if (isContentDocFrame()) { await NS.doc.handleDoc(lessonId, document.title); handled = true; }

      if (handled && !aborted) {
        await chrome.runtime.sendMessage({ type: 'UPDATE_RUNSTATE', patch: { currentType: type } }).catch(() => {});
        NS.log?.('[frame] content handled — requesting advance');
        await chrome.runtime.sendMessage({ type: 'REQUEST_ADVANCE', lessonType: type, token: lessonToken() }).catch(() => {});
      }
    } catch (e) {
      badge(`error: ${e?.message || e}`);
      if (isTop) await chrome.runtime.sendMessage({ type: 'UPDATE_RUNSTATE', patch: { error: String(e?.message || e) } }).catch(() => {});
    } finally {
      if (!waitingAdvance) running = false; // stay locked while deferred
    }
  }

  // Was THIS page load a manual reload (F5), as opposed to SPA navigation by the loop?
  function wasReloaded() {
    try {
      const nav = performance.getEntriesByType('navigation')[0];
      if (nav && nav.type) return nav.type === 'reload';
      return performance.navigation && performance.navigation.type === 1; // legacy
    } catch { return false; }
  }

  async function maybeRun() {
    if (userStopped || running) return; // a handler is active, deferred, or the user reloaded
    const rs = await chrome.runtime.sendMessage({ type: 'GET_RUNSTATE' }).catch(() => null);
    // Show / act only on the bound tab AND only on an actual lesson page.
    const onTask = (rs?.status === 'running' || rs?.status === 'paused') && rs?.isTargetTab && onLessonPage();
    badge(rs?.status || 'idle', onTask);
    if (!onTask) NS.cursor?.hide();
    if (rs?.status === 'running' && rs?.isTargetTab && onLessonPage()) runOnce();
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'RESUME') maybeRun();
    else if (msg?.type === 'ADVANCE' && isTop) onAdvanceSignal(msg.lessonType, msg.token);
  });

  // SPA resilience: re-evaluate after DOM settles (debounced).
  let t;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(maybeRun, 800); })
    .observe(document.documentElement, { childList: true, subtree: true });

  (async () => {
    // A manual page reload stops the loop (the loop itself navigates via SPA, not reloads).
    if (isTop && wasReloaded()) {
      const rs = await chrome.runtime.sendMessage({ type: 'GET_RUNSTATE' }).catch(() => null);
      if (rs?.status === 'running' && rs?.isTargetTab) {
        userStopped = true;
        NS.log?.('page reloaded by the user — stopping the loop');
        badge('stopped', false);
        await chrome.runtime.sendMessage({ type: 'CONTROL', action: 'STOP' }).catch(() => {});
        return;
      }
    }
    maybeRun();
  })();
})();
