// background/service_worker.js — message router + run-state owner (ES module worker).
import { getConfig, getRunState, setRunState, saveLessonText, getKb } from '../lib/storage.js';
import { callLlm } from '../lib/llm_adapter.js';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse).catch((e) => sendResponse({ error: String(e?.message || e) }));
  return true; // keep channel open for async response
});

async function handle(msg, sender) {
  switch (msg?.type) {
    case 'GET_CONFIG': return await getConfig();
    case 'GET_RUNSTATE': {
      const rs = await getRunState();
      // Tell a content script whether it lives in the tab the loop is bound to.
      return { ...rs, isTargetTab: sender?.tab ? sender.tab.id === rs.tabId : undefined };
    }
    case 'UPDATE_RUNSTATE': return { ok: true, runState: await setRunState(msg.patch || {}) };
    case 'SAVE_LESSON_TEXT': await saveLessonText(msg.lesson); return { ok: true };
    case 'CONTROL': return await control(msg.action, msg.tabId);
    case 'REQUEST_ADVANCE': {
      // A child frame finished its content and wants the top frame to click Next.
      if (sender?.tab) chrome.tabs.sendMessage(sender.tab.id, { type: 'ADVANCE', lessonType: msg.lessonType, token: msg.token }, { frameId: 0 }).catch(() => {});
      return { ok: true };
    }
    case 'BROADCAST_RETRY': {
      // Top frame asks the content frame(s) to re-watch the video (not complete yet).
      if (sender?.tab) chrome.tabs.sendMessage(sender.tab.id, { type: 'RETRY' }).catch(() => {});
      return { ok: true };
    }
    case 'SOLVE_QUIZ': return await solveQuiz(msg.payload);
    case 'TEST_KEY': return await testKey(msg.llm);
    default: throw new Error(`Unknown message: ${msg?.type}`);
  }
}

async function control(action, tabId) {
  if (action === 'STOP') return { ok: true, runState: await setRunState({ status: 'idle', tabId: null }) };
  if (action === 'START' || action === 'STEP') {
    const runState = await setRunState({ status: 'running', error: null, tabId: tabId ?? null });
    if (tabId != null) chrome.tabs.sendMessage(tabId, { type: 'RESUME' }).catch(() => {}); // kick off promptly
    return { ok: true, runState };
  }
  throw new Error(`Bad control action: ${action}`);
}

// Phase 4: live solver — assemble RAG context from captured doc text, call the LLM, fall back on error.
async function solveQuiz(payload) {
  const config = await getConfig();
  if (!config.llm.apiKey) return { error: 'NO_KEY' };
  const kb = await getKb();
  const context = kb.order
    .map((id) => kb.lessons[id])
    .filter((l) => l && l.type === 'doc' && l.text)
    .map((l) => l.text)
    .join('\n\n')
    .slice(0, 12000);
  try {
    return { answer: await callLlm(config.llm, { ...payload, context }) };
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

async function testKey(llm) {
  try {
    await callLlm(llm, { question: 'Reply choosing index 0.', options: ['ok', 'no'], context: '' });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// Resume the loop after navigation — only for the tab the loop is bound to.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'complete') return;
  const rs = await getRunState();
  if (rs.status === 'running' && rs.tabId === tabId) chrome.tabs.sendMessage(tabId, { type: 'RESUME' }).catch(() => {});
});

// Closing the working tab stops the loop.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const rs = await getRunState();
  if (rs.tabId === tabId && rs.status !== 'idle') await setRunState({ status: 'idle', tabId: null });
});
