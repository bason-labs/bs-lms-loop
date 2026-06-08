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

  async function handleVideo(config) {
    const vids = await findVideos();
    const v = vids[0];

    if (v) {
      NS.log?.('video found — speeding & seeking', { rate: config.video.playbackRate, duration: v.duration });
      try {
        v.muted = true;
        v.playbackRate = config.video.playbackRate || 8;
        await v.play?.().catch(() => {});
        if (config.video.skipToEnd && isFinite(v.duration) && v.duration > 0) {
          v.currentTime = Math.max(0, v.duration - 0.5);
        }
      } catch (e) { NS.log?.('could not control the <video> element:', e?.message || e); }
    } else {
      NS.log?.('video lesson, but no controllable <video> (likely a cross-origin player iframe). Waiting for the page to enable Next…');
    }

    // Completion = a reachable video ends, OR the Next control becomes enabled.
    const done = await NS.dom.waitFor(() => {
      if (vids.some((x) => x.ended)) return true;
      return nextReady();
    }, { timeout: 120000, interval: 600 });

    NS.log?.(done ? 'video complete (ended or Next enabled)' : 'video wait timed out (120s) — advancing anyway');
    return { ok: !!done, controllable: !!v };
  }

  NS.video = { handleVideo, reachableVideos };
})();
