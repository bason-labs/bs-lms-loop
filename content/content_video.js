// content/content_video.js — speed/seek a <video>, then wait for the real completion trigger.
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});
  async function handleVideo(config) {
    const v = document.querySelector('video');
    if (!v) return { ok: false, reason: 'no <video> (player may be in a cross-origin iframe)' };
    try {
      v.muted = true;
      v.playbackRate = config.video.playbackRate || 8;
      await v.play?.().catch(() => {});
      if (config.video.skipToEnd && isFinite(v.duration) && v.duration > 0) {
        v.currentTime = Math.max(0, v.duration - 0.5);
      }
    } catch { /* some players guard rate/seek */ }
    // Completion = video ended OR a Next control becomes enabled.
    const done = await NS.dom.waitFor(() => {
      if (v.ended) return true;
      const next = NS.dom.findClickableByText(NS.selectors.nextButtonText) || NS.dom.findFirst(NS.selectors.nextSelectors);
      return next && !next.disabled && next.getAttribute('aria-disabled') !== 'true' ? next : false;
    }, { timeout: 60000, interval: 500 });
    return { ok: !!done };
  }
  NS.video = { handleVideo };
})();
