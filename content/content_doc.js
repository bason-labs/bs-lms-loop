// content/content_doc.js — extract readable text and persist it to the KB via the worker.
(function () {
  const NS = (globalThis.__LMS = globalThis.__LMS || {});
  function extractText() {
    const root = NS.dom.findFirst(NS.selectors.contentSelectors) || document.body;
    let text = (root.innerText || '').trim();
    for (const f of document.querySelectorAll('iframe')) {
      try { const d = f.contentDocument; if (d?.body) text += '\n\n' + (d.body.innerText || ''); } catch { /* cross-origin */ }
    }
    const pdfs = [...document.querySelectorAll('a[href$=".pdf"],embed[type="application/pdf"],object[type="application/pdf"]')]
      .map((el) => el.href || el.src || el.data).filter(Boolean);
    if (pdfs.length) text += '\n\n[PDF references]\n' + pdfs.join('\n');
    return text.trim();
  }
  async function handleDoc(lessonId, title) {
    const text = extractText();
    await chrome.runtime.sendMessage({
      type: 'SAVE_LESSON_TEXT',
      lesson: { id: lessonId, title, type: 'doc', url: location.href, text, capturedAt: Date.now() }
    });
    return { ok: true, chars: text.length };
  }
  NS.doc = { extractText, handleDoc };
})();
