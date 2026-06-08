// background/service_worker.js — message router + run-state owner (ES module worker).
import { getConfig, getRunState, setRunState, saveLessonText } from '../lib/storage.js';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse).catch((e) => sendResponse({ error: String(e?.message || e) }));
  return true; // keep channel open for async response
});

async function handle(msg) {
  switch (msg?.type) {
    case 'GET_CONFIG': return await getConfig();
    case 'GET_RUNSTATE': return await getRunState();
    case 'UPDATE_RUNSTATE': return { ok: true, runState: await setRunState(msg.patch || {}) };
    case 'SAVE_LESSON_TEXT': await saveLessonText(msg.lesson); return { ok: true };
    case 'CONTROL': return await control(msg.action);
    default: throw new Error(`Unknown message: ${msg?.type}`);
  }
}

async function control(action) {
  const map = { START: 'running', STOP: 'idle', STEP: 'running' };
  const status = map[action];
  if (!status) throw new Error(`Bad control action: ${action}`);
  return { ok: true, runState: await setRunState({ status, error: null }) };
}

// Resume the loop after navigation: nudge the content script when a running tab finishes loading.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'complete') return;
  const rs = await getRunState();
  if (rs.status === 'running') chrome.tabs.sendMessage(tabId, { type: 'RESUME' }).catch(() => {});
});
