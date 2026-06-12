// background/service_worker.js — message router + run-state owner (ES module worker).
import { getConfig, getRunState, setRunState, saveLessonText, getKb } from '../lib/storage.js';
import { callLlm, buildSolveMultiPrompt, parseMultiAnswerJson, buildSearchRequest, parseSearchResponse, buildRequest, parseResponse } from '../lib/llm_adapter.js';
import { QUIZ_CONFIDENCE_THRESHOLD } from '../config/app_config.js';
import { checkAccess, signOut } from '../lib/auth.js';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse).catch((e) => sendResponse({ error: String(e?.message || e) }));
  return true; // keep channel open for async response
});

async function handle(msg, sender) {
  switch (msg?.type) {
    case 'GET_CONFIG': return await getConfig();
    case 'GET_AUTH': return (await chrome.storage.local.get('auth')).auth || { allowed: false, email: null, checkedAt: 0 };
    case 'CHECK_ACCESS': {
      let result;
      try { result = await checkAccess(msg.interactive !== false); }
      catch (e) { result = { allowed: false, email: null, error: String(e?.message || e) }; }
      const auth = { email: result.email, allowed: !!result.allowed, checkedAt: Date.now(), error: result.error || null };
      await chrome.storage.local.set({ auth });
      return auth;
    }
    case 'SIGN_OUT': {
      await signOut();
      await chrome.storage.local.set({ auth: { allowed: false, email: null, checkedAt: 0 } });
      return { ok: true };
    }
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
    case 'SOLVE_QUIZ': return await solveQuiz(msg.payload);
    case 'TEST_KEY': return await testKey(msg.llm);
    default: throw new Error(`Unknown message: ${msg?.type}`);
  }
}

async function control(action, tabId) {
  if (action === 'STOP') return { ok: true, runState: await setRunState({ status: 'idle', tabId: null }) };
  if (action === 'START' || action === 'STEP') {
    // Re-check access silently; block the loop if the account isn't whitelisted.
    let access = { allowed: false, email: null };
    try { access = await checkAccess(false); } catch { /* fail closed */ }
    if (!access.allowed) {
      await chrome.storage.local.set({ auth: { email: access.email, allowed: false, checkedAt: Date.now(), error: null } });
      return { ok: false, error: 'NOT_AUTHORIZED' };
    }
    const runState = await setRunState({ status: 'running', error: null, tabId: tabId ?? null });
    if (tabId != null) chrome.tabs.sendMessage(tabId, { type: 'RESUME' }).catch(() => {});
    return { ok: true, runState };
  }
  throw new Error(`Bad control action: ${action}`);
}

async function hashQuestions(questions) {
  const text = questions.map((q) => q.question + q.options.join('|')).join('||');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return 'qcache_' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Assemble RAG context, run Tier 1 (LLM-direct with confidence), optionally Tier 2
// (provider-native search when confidence is low and the user opted in).
// Results are cached in chrome.storage.session for the duration of the browser session.
async function solveQuiz(payload) {
  const config = await getConfig();
  if (!config.llm.apiKey) return { error: 'NO_KEY' };

  const questions = payload.questions;
  if (!Array.isArray(questions) || !questions.length) return { error: 'NO_QUESTIONS' };

  // Session cache: skip both tiers if this exact question set was solved this session.
  const cacheKey = await hashQuestions(questions);
  const sessionData = await chrome.storage.session.get(cacheKey).catch(() => ({}));
  const cached = sessionData[cacheKey];
  if (cached) return cached;

  const kb = await getKb();
  const context = kb.order
    .map((id) => kb.lessons[id])
    .filter((l) => l && l.type === 'doc' && l.text)
    .map((l) => l.text)
    .join('\n\n')
    .slice(0, 12000);

  const messages = buildSolveMultiPrompt({
    questions,
    context,
    courseTitle: payload.courseTitle || ''
  });

  try {
    // Tier 1: LLM-direct.
    const req1 = buildRequest(config.llm.provider, config.llm, messages);
    const raw1 = await fetch(req1.url, { method: 'POST', headers: req1.headers, body: JSON.stringify(req1.body) });
    if (!raw1.ok) throw new Error(`LLM HTTP ${raw1.status}: ${(await raw1.text()).slice(0, 200)}`);
    let answers = parseMultiAnswerJson(parseResponse(config.llm.provider, await raw1.json()));
    if (!answers) throw new Error('LLM returned unparseable answer');

    // Tier 2: search if any answer is low-confidence and the user opted in.
    const minConfidence = Math.min(...answers.map((a) => a.confidence ?? 10));
    const searchEnabled = config.quiz?.searchStrategy === 'llm-search'
      && ['gemini', 'openai'].includes(config.llm.provider);

    if (minConfidence < QUIZ_CONFIDENCE_THRESHOLD && searchEnabled) {
      try {
        const req2 = buildSearchRequest(config.llm.provider, config.llm, messages);
        const raw2 = await fetch(req2.url, { method: 'POST', headers: req2.headers, body: JSON.stringify(req2.body) });
        if (raw2.ok) {
          const answers2 = parseMultiAnswerJson(parseSearchResponse(config.llm.provider, await raw2.json()));
          if (answers2) answers = answers2;
        }
      } catch { /* Tier 2 failed — keep Tier 1 answers */ }
    }

    const result = { answers };
    await chrome.storage.session.set({ [cacheKey]: result }).catch(() => {});
    return result;
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
