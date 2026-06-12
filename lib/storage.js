// lib/storage.js — defaults, pure helpers, and chrome.storage.local I/O (ES module)

// Recursively freeze so nested config objects can't be mutated (DEFAULT_CONFIG is a
// fallback source for getConfig via structuredClone; an accidental nested mutation
// would otherwise leak into future fresh-install reads).
function deepFreeze(o) {
  Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v));
  return Object.freeze(o);
}

export const DEFAULT_CONFIG = deepFreeze({
  enabled: false,
  mode: 'auto',                                   // 'auto' | 'step'
  llm: { provider: 'openai', apiKey: '', model: 'gpt-4o-mini', baseUrl: '', temperature: 0 },
  video: { skipToEnd: true, playbackRate: 1, waitForTriggerMs: 1500 },
  quiz: { useAiWhenKeyPresent: true, fallback: 'random', forceSubmit: true, searchStrategy: 'llm-only' }, // fallback: 'skip'|'random'
  delays: { betweenLessonsMs: 1200, actionMs: 400 }
});

export const DEFAULT_RUNSTATE = Object.freeze({
  status: 'idle', currentLessonId: null, currentType: null,
  lastAction: null, error: null, tabId: null, updatedAt: 0
});

// Pure: returns a NEW kb with `lesson` merged in; preserves order, no duplicate ids.
export function appendLessonToKb(kb, lesson) {
  const base = kb && kb.lessons ? kb : { courseId: kb?.courseId ?? null, order: [], lessons: {} };
  const order = base.order.includes(lesson.id) ? base.order : [...base.order, lesson.id];
  return {
    ...base,
    order,
    lessons: { ...base.lessons, [lesson.id]: { ...base.lessons[lesson.id], ...lesson } }
  };
}

// ---- chrome.storage.local I/O (browser only; chrome referenced inside fns, not at import) ----
async function getKey(key, fallback) {
  const out = await chrome.storage.local.get(key);
  return out[key] ?? fallback;
}
export const getConfig = () => getKey('config', structuredClone(DEFAULT_CONFIG));
export const setConfig = (config) => chrome.storage.local.set({ config });
export const getRunState = () => getKey('runState', structuredClone(DEFAULT_RUNSTATE));
export async function setRunState(patch) {
  const cur = await getRunState();
  const next = { ...cur, ...patch, updatedAt: Date.now() };
  await chrome.storage.local.set({ runState: next });
  return next;
}
export const getKb = () => getKey('kb', { courseId: null, order: [], lessons: {} });
export async function saveLessonText(lesson) {
  const next = appendLessonToKb(await getKb(), lesson);
  await chrome.storage.local.set({ kb: next });
  return next;
}
