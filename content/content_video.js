// content/content_video.js — drive any reachable <video> to actually watch through at speed,
// so the LMS records progress and marks the lesson complete.
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

  function clickPlayControl(v) {
    const btn = document.querySelector(
      '.vjs-big-play-button, .vjs-play-control, .ytp-large-play-button, .ytp-play-button, ' +
      'button[aria-label*="play" i], button[title*="play" i], [class*="play-button"], [class*="playButton"]'
    );
    NS.dom.simulateClick(btn || v);
  }

  // Make sure the video is actually playing (muted autoplay, or a click if the player blocks it).
  async function ensurePlaying(v, rate) {
    try { v.muted = true; } catch { /* ignore */ }
    try { v.playbackRate = rate; } catch { /* clamped by browser */ }
    try { await (v.play?.() ?? Promise.resolve()); } catch { /* autoplay blocked */ }
    if (v.paused) {
      clickPlayControl(v);
      await NS.dom.sleep(200);
      try { await v.play?.(); } catch { /* ignore */ }
    }
  }

  function ended(v) {
    return v.ended || (isFinite(v.duration) && v.duration > 0 && v.currentTime >= v.duration - 0.5);
  }

  async function handleVideo(config, retrySpeed) {
    const vids = await findVideos();
    if (!vids.length) {
      NS.log?.('video lesson, but no controllable <video> (cross-origin player). Waiting for Next to enable…');
      const ok = await NS.dom.waitFor(() => nextReady(), { timeout: 120000, interval: 600 });
      return { ok: !!ok, controllable: false };
    }

    const rate = (retrySpeed != null ? retrySpeed : config.video.playbackRate) || 1;
    const v = vids[0];
    NS.log?.('video: watching through at speed', { count: vids.length, rate, retry: retrySpeed != null, duration: v.duration });

    try { v.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); } catch { /* ignore */ }
    await NS.dom.sleep(400);

    await ensurePlaying(v, rate);
    if (config.video.skipToEnd && isFinite(v.duration) && v.duration > 0) {
      // Skip to 70% so the last 30% plays out — enough progress events for the LMS to register.
      try { v.currentTime = Math.max(v.currentTime, v.duration * 0.7); } catch { /* blocked */ }
    }

    // Keep it playing at the chosen rate — players often reset rate or pause on seek.
    const keepAlive = setInterval(() => {
      vids.forEach((x) => {
        try {
          if (!ended(x)) {
            if (x.playbackRate !== rate) x.playbackRate = rate;
            if (x.paused) x.play?.().catch(() => {});
          }
        } catch { /* ignore */ }
      });
    }, 1000);

    // Timeout: time to play the remaining 30% at the configured rate, plus a 15s buffer.
    const remaining = isFinite(v.duration) && v.duration > 0 ? v.duration * 0.3 : 600;
    const timeoutMs = Math.max(30000, Math.ceil(remaining / rate * 1000) + 15000);
    const done = await NS.dom.waitFor(() => vids.every(ended), { timeout: timeoutMs, interval: 500 });
    clearInterval(keepAlive);

    // Nudge a definite end state so the player fires its completion handler.
    vids.forEach((x) => { try { if (!x.ended && isFinite(x.duration) && x.duration > 0) x.currentTime = x.duration; } catch { /* ignore */ } });

    NS.log?.(done ? 'video watched to the end' : `video wait timed out (${Math.round(timeoutMs / 1000)}s) — moving on`);
    return { ok: !!done, controllable: true };
  }

  NS.video = { handleVideo, reachableVideos };
})();
