// content/content_video.js — speed/seek any reachable <video>, then wait for real completion.
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});

  function reachableVideos() {
    const vids = [...document.querySelectorAll('video')];
    for (const f of document.querySelectorAll('iframe')) {
      try { const d = f.contentDocument; if (d) vids.push(...d.querySelectorAll('video')); } catch { /* cross-origin */ }
    }
    return vids;
  }

  // Some LMSes lazy-load the player below the fold — nudge a scroll, then recheck.
  async function findVideos() {
    let vids = reachableVideos();
    if (!vids.length) {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      await NS.dom.sleep(700);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      await NS.dom.sleep(500);
      vids = reachableVideos();
    }
    return vids;
  }

  function nextReady() {
    const n = NS.dom.findClickableByText(NS.selectors.nextButtonText) || NS.dom.findFirst(NS.selectors.nextSelectors);
    return n && !NS.dom.isDisabled(n) ? n : false;
  }

  // Mute, speed up, and seek to just before the end so the video plays out to a real
  // 'ended' event (which is what LMS players watch for to mark completion).
  function primeVideo(v, config) {
    const seekNearEnd = () => {
      if (config.video.skipToEnd && isFinite(v.duration) && v.duration > 1) {
        try { v.currentTime = Math.max(0, v.duration - 1); } catch { /* some players block seek */ }
      }
    };
    try {
      v.muted = true;
      v.playbackRate = config.video.playbackRate || 8;
      v.play?.().catch(() => {});
      if (v.readyState >= 1 && isFinite(v.duration) && v.duration > 0) seekNearEnd();
      else v.addEventListener('loadedmetadata', seekNearEnd, { once: true });
    } catch (e) { NS.log?.('could not control the <video>:', e?.message || e); }
  }

  function ended(v) {
    return v.ended || (isFinite(v.duration) && v.duration > 0 && v.currentTime >= v.duration - 0.4);
  }

  async function handleVideo(config) {
    const vids = await findVideos();
    if (!vids.length) {
      NS.log?.('video lesson, but no controllable <video> (cross-origin player). Waiting for Next to enable…');
      const ok = await NS.dom.waitFor(() => nextReady(), { timeout: 120000, interval: 600 });
      return { ok: !!ok, controllable: false };
    }

    NS.log?.('video found — speeding to the end', { count: vids.length, rate: config.video.playbackRate });
    vids.forEach((v) => primeVideo(v, config));

    // Wait until every reachable video has actually played to its end (re-prime if a
    // player resets currentTime on seek), with a hard cap so we never hang forever.
    const done = await NS.dom.waitFor(() => {
      const pending = vids.filter((v) => !ended(v));
      pending.forEach((v) => { if (v.paused) v.play?.().catch(() => {}); if (config.video.skipToEnd) primeVideo(v, config); });
      return pending.length === 0;
    }, { timeout: 120000, interval: 500 });

    NS.log?.(done ? 'video ended' : 'video wait timed out (120s) — moving on');
    return { ok: !!done, controllable: true };
  }

  NS.video = { handleVideo, reachableVideos };
})();
