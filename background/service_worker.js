// background/service_worker.js — message router + run-state owner (ES module worker).
import { getConfig, getRunState, setRunState, saveLessonText, getKb } from '../lib/storage.js';
import { callLlm } from '../lib/llm_adapter.js';

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
    case 'SOLVE_QUIZ': return await solveQuiz(msg.payload);
    case 'TEST_KEY': return await testKey(msg.llm);
    default: throw new Error(`Unknown message: ${msg?.type}`);
  }
}

async function control(action) {
  const map = { START: 'running', STOP: 'idle', STEP: 'running' };
  const status = map[action];
  if (!status) throw new Error(`Bad control action: ${action}`);
  return { ok: true, runState: await setRunState({ status, error: null }) };
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

// Resume the loop after navigation: nudge the content script when a running tab finishes loading.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'complete') return;
  const rs = await getRunState();
  if (rs.status === 'running') chrome.tabs.sendMessage(tabId, { type: 'RESUME' }).catch(() => {});
});
