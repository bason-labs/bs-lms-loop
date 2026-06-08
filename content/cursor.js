// content/cursor.js — synthetic "computer-use" cursor overlay (classic script, NS.cursor).
// Animates a pointer to a target element, highlights it, and pulses on click — so the user
// can watch what the loop is doing. Purely visual; never intercepts page events.
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let layer, cursor, ring, cap;

  function ensure() {
    if (layer && document.documentElement.contains(layer)) return;
    layer = document.createElement('div');
    layer.id = '__lms_cursor_layer';

    ring = document.createElement('div');
    ring.className = '__lms_ring';

    cap = document.createElement('div');
    cap.className = '__lms_cap';

    cursor = document.createElement('div');
    cursor.className = '__lms_cursor';
    cursor.innerHTML =
      '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2.5 19 12l-6.2 1.1 3.4 6.5-2.7 1.4-3.4-6.6L5 19.4z"/></svg>';

    layer.append(ring, cap, cursor);
    document.documentElement.appendChild(layer);
  }

  function centerOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, r };
  }

  // Move the cursor to an element (scrolling it into view), draw the highlight + optional caption.
  async function moveTo(el, caption) {
    if (!el) return;
    ensure();
    try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); } catch { /* ignore */ }
    await sleep(360); // let the smooth-scroll settle before measuring

    const { x, y, r } = centerOf(el);
    layer.classList.add('__lms_on');

    ring.style.left = (r.left - 4) + 'px';
    ring.style.top = (r.top - 4) + 'px';
    ring.style.width = (r.width + 8) + 'px';
    ring.style.height = (r.height + 8) + 'px';
    ring.classList.add('__lms_ring-on');

    if (caption) {
      cap.textContent = caption;
      cap.style.left = (x + 16) + 'px';
      cap.style.top = (y + 18) + 'px';
      cap.classList.add('__lms_cap-on');
    } else {
      cap.classList.remove('__lms_cap-on');
    }

    cursor.style.transform = `translate(${x}px, ${y}px)`;
    await sleep(520); // matches the CSS transform transition
  }

  function clickPulse() {
    if (!cursor) return;
    cursor.classList.remove('__lms_click');
    void cursor.offsetWidth; // restart the animation
    cursor.classList.add('__lms_click');
  }

  // Move to an element and play a click pulse (the caller does the real click right after).
  async function actClick(el, caption) {
    await moveTo(el, caption);
    clickPulse();
    await sleep(140);
  }

  function hide() {
    if (!layer) return;
    layer.classList.remove('__lms_on');
    ring.classList.remove('__lms_ring-on');
    cap.classList.remove('__lms_cap-on');
  }

  NS.cursor = { ensure, moveTo, actClick, clickPulse, hide };
})();
