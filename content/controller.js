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
  let pendingType = null;
  let pendingToken = null;
  let currentToken = null;      // token of the lesson the top frame is currently on
  let fallbackTimer = 0;
  let lastLessonId = null;
  let stuckCount = 0;
  let videoRetries = 0;
  let processingAdvance = false;
  const MAX_VIDEO_RETRIES = 3;

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

  // Top frame: a child frame says it finished. If it was a video that still isn't marked
  // complete, ask the child to re-watch (a few times) before giving up and advancing.
  async function onAdvanceSignal(lessonType, token) {
    // Ignore a signal from a different (e.g. previous) lesson.
    if (token && currentToken && token !== currentToken) { NS.log?.('ignoring stale advance signal from another lesson'); return; }
    if (!waitingAdvance) { pendingAdvance = true; pendingType = lessonType; pendingToken = token; return; }
    if (processingAdvance) return;
    processingAdvance = true;
    try {
      if (lessonType === 'video') {
        // edX updates the outline a beat after the video ends — give it a moment.
        const complete = await NS.dom.waitFor(() => NS.detector.lessonComplete(), { timeout: 5000, interval: 400 });
        if (!complete && videoRetries < MAX_VIDEO_RETRIES) {
          videoRetries += 1;
          NS.log?.(`video not marked complete yet — re-watching (${videoRetries}/${MAX_VIDEO_RETRIES})`);
          badge(`re-watching video (${videoRetries})`);
          armFallback();
          await chrome.runtime.sendMessage({ type: 'BROADCAST_RETRY' }).catch(() => {});
          return; // stay deferred; the child will replay then signal again
        }
        if (!complete) NS.log?.('video still not complete after retries — advancing anyway');
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

  // Child frame: wait briefly for the top frame's completion verdict for this lesson.
  async function waitForEval(token, timeout = 2000) {
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

      // Top frame: publish a completion verdict for this lesson so the content iframe
      // can read it (and skip playing an already-passed video).
      if (isTop) {
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
        videoRetries = 0;
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

  async function maybeRun() {
    if (running) return; // a handler is active (or we're deferred) — skip the poll
    const rs = await chrome.runtime.sendMessage({ type: 'GET_RUNSTATE' }).catch(() => null);
    // Show / act only on the bound tab AND only on an actual lesson page.
    const onTask = (rs?.status === 'running' || rs?.status === 'paused') && rs?.isTargetTab && onLessonPage();
    badge(rs?.status || 'idle', onTask);
    if (!onTask) NS.cursor?.hide();
    if (rs?.status === 'running' && rs?.isTargetTab && onLessonPage()) runOnce();
  }

  // Child frame: top asked us to re-watch the video (it isn't marked complete yet).
  async function replayVideo() {
    if (running) return;
    running = true;
    try {
      const config = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
      const vids = NS.video.reachableVideos();
      if (!vids.length) { // nothing to re-watch here — just let the top advance
        NS.log?.('[frame] retry requested but no video in this frame — advancing');
        await chrome.runtime.sendMessage({ type: 'REQUEST_ADVANCE', lessonType: 'doc', token: lessonToken() }).catch(() => {});
        return;
      }
      vids.forEach((v) => { try { v.currentTime = 0; } catch { /* ignore */ } });
      await NS.video.handleVideo(config);
      if (!aborted) await chrome.runtime.sendMessage({ type: 'REQUEST_ADVANCE', lessonType: 'video', token: lessonToken() }).catch(() => {});
    } finally {
      running = false;
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'RESUME') maybeRun();
    else if (msg?.type === 'ADVANCE' && isTop) onAdvanceSignal(msg.lessonType, msg.token);
    else if (msg?.type === 'RETRY' && !isTop) replayVideo();
  });

  // SPA resilience: re-evaluate after DOM settles (debounced).
  let t;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(maybeRun, 800); })
    .observe(document.documentElement, { childList: true, subtree: true });

  maybeRun();
})();
