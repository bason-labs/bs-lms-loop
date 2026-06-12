import { getConfig, setConfig } from '../lib/storage.js';

const $ = (id) => document.getElementById(id);
const groupEl = (name) => document.querySelector(`[data-group="${name}"]`);

function showGate(auth) {
  const allowed = !!auth?.allowed;
  $('gate').hidden = allowed;
  $('app').hidden = !allowed;
  if (allowed) return;
  const denied = auth && auth.email && !auth.allowed;
  $('gate').dataset.state = denied ? 'denied' : 'signedout';
  $('gate-title').textContent = denied ? 'No access' : 'Sign in';
  $('gate-sub').textContent = denied
    ? `${auth.email} isn't on the allowed list. Ask an admin to add it.`
    : 'Use your authorized Google account to continue.';
  $('signin').querySelector('.power-label').textContent = denied ? 'Try another account' : 'Sign in with Google';
  $('signout').hidden = !denied;
}

async function refreshAuth(interactive) {
  const type = interactive ? 'CHECK_ACCESS' : 'GET_AUTH';
  const auth = await chrome.runtime.sendMessage({ type, interactive }).catch(() => null);
  showGate(auth);
  return auth;
}

const MODEL_HINT = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
  gemini: 'gemini-1.5-flash',
  custom: 'your-model'
};

/* ---------- i18n ---------- */
const I18N = {
  en: {
    eyebrow: 'Autopilot',
    mode_auto: 'Auto loop', mode_step: 'Step',
    sec_intel: 'Intelligence', note_quiz: 'used for quizzes', prov_custom: 'Custom',
    lbl_apikey: 'API key', ph_apikey: 'blank → skip / guess quizzes', ttl_reveal: 'Show / hide',
    btn_test: 'Test key', lbl_model: 'Model', lbl_baseurl: 'Base URL',
    sec_behavior: 'Behavior', lbl_video: 'Video speed', lbl_fallback: 'No-key quiz fallback',
    fb_random: 'Random fill', fb_skip: 'Skip',
    lbl_quiz_strategy: 'Quiz strategy',
    qs_llm_only: 'LLM Only', qs_llm_search: 'LLM + Search',
    qs_note: 'Search requires Gemini or OpenAI',
    foot: 'Runs on the active tab · reload the page to stop', ttl_theme: 'Toggle theme',
    soon: 'Coming soon', btn_start: 'Start', btn_stop: 'Stop',
    test_checking: 'checking…', test_ok: 'key works ✓',
    status: { idle: 'idle', running: 'running', paused: 'paused', done: 'done', error: 'error' },
    type: { video: 'video', doc: 'document', quiz: 'quiz' },
    hero: {
      idle: ['Standing by', 'Open a lesson and start the loop.', 'Start automating'],
      running: ['Running', null, 'Stop'],
      paused: ['Paused', 'The loop is holding here.', 'Resume'],
      done: ['Course complete', 'Nothing left to advance.', 'Run again'],
      error: ['Hit a snag', null, 'Try again']
    },
    runningSub: (t) => (t ? `Handling the ${t} lesson · clicking through.` : 'Working through the course…')
  },
  vi: {
    eyebrow: 'Tự động',
    mode_auto: 'Tự động', mode_step: 'Từng bước',
    sec_intel: 'Trí tuệ AI', note_quiz: 'dùng cho trắc nghiệm', prov_custom: 'Tùy chỉnh',
    lbl_apikey: 'Khóa API', ph_apikey: 'trống → bỏ qua / đoán', ttl_reveal: 'Hiện / ẩn',
    btn_test: 'Kiểm tra khóa', lbl_model: 'Mô hình', lbl_baseurl: 'Base URL',
    sec_behavior: 'Hành vi', lbl_video: 'Tốc độ video', lbl_fallback: 'Khi không có khóa',
    fb_random: 'Điền ngẫu nhiên', fb_skip: 'Bỏ qua',
    lbl_quiz_strategy: 'Chiến lược trắc nghiệm',
    qs_llm_only: 'Chỉ AI', qs_llm_search: 'AI + Tìm kiếm',
    qs_note: 'Tìm kiếm yêu cầu Gemini hoặc OpenAI',
    foot: 'Chạy trên tab hiện tại · tải lại trang để dừng', ttl_theme: 'Đổi giao diện',
    soon: 'Sắp ra mắt', btn_start: 'Bắt đầu', btn_stop: 'Dừng',
    test_checking: 'đang kiểm tra…', test_ok: 'khóa hợp lệ ✓',
    status: { idle: 'chờ', running: 'đang chạy', paused: 'tạm dừng', done: 'xong', error: 'lỗi' },
    type: { video: 'video', doc: 'tài liệu', quiz: 'trắc nghiệm' },
    hero: {
      idle: ['Sẵn sàng', 'Mở một bài học và bấm bắt đầu.', 'Bắt đầu tự động'],
      running: ['Đang chạy', null, 'Dừng'],
      paused: ['Tạm dừng', 'Vòng lặp đang tạm dừng.', 'Tiếp tục'],
      done: ['Hoàn thành', 'Không còn gì để tiếp.', 'Chạy lại'],
      error: ['Gặp sự cố', null, 'Thử lại']
    },
    runningSub: (t) => (t ? `Đang xử lý bài ${t} · tự động chuyển.` : 'Đang chạy qua khóa học…')
  }
};

let lang = 'en';
let theme = 'dark';
let status = 'idle';
let lastRs = null;

const dict = () => I18N[lang] || I18N.en;
const t = (key) => dict()[key] ?? key;

/* ---------- prefs (popup-only, separate from config) ---------- */
async function getPrefs() {
  const o = await chrome.storage.local.get('prefs');
  return { theme: 'dark', lang: 'en', ...(o.prefs || {}) };
}
async function savePrefs() {
  await chrome.storage.local.set({ prefs: { theme, lang } });
}

/* ---------- segmented / pill groups ---------- */
function getGroup(name) {
  return groupEl(name).querySelector('.is-active')?.dataset.value;
}
function setGroup(name, value) {
  groupEl(name).querySelectorAll('[data-value]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.value === value);
  });
}

/* ---------- range fill + label ---------- */
function paintRate() {
  const r = $('playbackRate');
  const pct = ((r.value - r.min) / (r.max - r.min)) * 100;
  r.style.setProperty('--fill', pct + '%');
  $('rate-value').textContent = '×' + r.value;
}

/* ---------- theme + language ---------- */
function applyTheme(th) {
  theme = th === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
}

function applyI18n(lg) {
  lang = I18N[lg] ? lg : 'en';
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  setGroup('lang', lang);
  applyStatus(lastRs); // re-render dynamic strings in the new language
}

/* ---------- config <-> UI ---------- */
function fill(cfg) {
  setGroup('provider', cfg.llm.provider);
  setGroup('mode', cfg.mode);
  setGroup('fallback', cfg.quiz.fallback);
  setGroup('quizStrategy', cfg.quiz.searchStrategy || 'llm-only');
  $('apiKey').value = cfg.llm.apiKey;
  $('model').value = cfg.llm.model;
  $('baseUrl').value = cfg.llm.baseUrl;
  $('playbackRate').value = cfg.video.playbackRate;
  paintRate();
  syncProvider();
}

async function persist() {
  const cfg = await getConfig();
  cfg.llm.provider = getGroup('provider');
  cfg.llm.apiKey = $('apiKey').value.trim();
  cfg.llm.model = $('model').value.trim();
  cfg.llm.baseUrl = $('baseUrl').value.trim();
  cfg.mode = getGroup('mode');
  cfg.video.playbackRate = Number($('playbackRate').value) || 1;
  cfg.quiz.fallback = getGroup('fallback');
  cfg.quiz.searchStrategy = getGroup('quizStrategy') || 'llm-only';
  await setConfig(cfg);
}

function syncProvider() {
  const p = getGroup('provider');
  $('baseUrl-field').hidden = p !== 'custom';
  $('model').placeholder = MODEL_HINT[p] || 'model';

  const searchSupported = p === 'gemini' || p === 'openai';
  const searchBtn = groupEl('quizStrategy').querySelector('[data-value="llm-search"]');
  searchBtn.classList.toggle('is-disabled', !searchSupported);
  searchBtn.disabled = !searchSupported;
  $('quiz-strategy-note').hidden = searchSupported;

  if (!searchSupported && getGroup('quizStrategy') === 'llm-search') {
    setGroup('quizStrategy', 'llm-only');
    persist();
  }
}

/* ---------- status presentation ---------- */
function applyStatus(rs) {
  lastRs = rs;
  status = rs?.status || 'idle';
  const d = dict();
  const type = rs?.currentType;

  $('chip').dataset.status = status;
  $('chip-label').textContent = d.status[status] || status;

  const running = status === 'running' || status === 'paused';
  $('power').classList.toggle('is-running', running);

  const view = d.hero[status] || d.hero.idle;
  let [title, sub] = view;
  if (status === 'running') sub = d.runningSub(type ? (d.type[type] || type) : '');
  if (status === 'error') sub = rs?.error || sub || '';

  $('hero-status').textContent = title;
  $('hero-sub').textContent = sub;
  // Binary button: Stop while running, otherwise Start.
  $('power-label').textContent = running ? t('btn_stop') : t('btn_start');
}

async function refresh() {
  const rs = await chrome.runtime.sendMessage({ type: 'GET_RUNSTATE' }).catch(() => null);
  applyStatus(rs);
}

async function control(action) {
  await persist();
  // Bind the loop to the tab the user is looking at when they press Start.
  let tabId;
  if (action === 'START') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    tabId = tab?.id;
  }
  const res = await chrome.runtime.sendMessage({ type: 'CONTROL', action, tabId }).catch((e) => ({ error: String(e) }));
  if (res?.error === 'NOT_AUTHORIZED') { await refreshAuth(false); return; }
  if (res?.runState) applyStatus(res.runState);
  else applyStatus({ status: 'error', error: res?.error || 'no response' });
}

/* ---------- wiring ---------- */
groupEl('provider').addEventListener('click', (e) => {
  const b = e.target.closest('[data-value]');
  if (!b) return;
  setGroup('provider', b.dataset.value);
  syncProvider();
  persist();
});

['mode', 'fallback', 'quizStrategy'].forEach((name) => {
  groupEl(name).addEventListener('click', (e) => {
    const b = e.target.closest('[data-value]');
    if (!b) return;
    setGroup(name, b.dataset.value);
    persist();
  });
});

// language switch
groupEl('lang').addEventListener('click', (e) => {
  const b = e.target.closest('[data-value]');
  if (!b) return;
  applyI18n(b.dataset.value);
  savePrefs();
});

// theme toggle
$('theme-toggle').addEventListener('click', () => {
  applyTheme(theme === 'dark' ? 'light' : 'dark');
  savePrefs();
});

$('power').addEventListener('click', () => control(status === 'running' || status === 'paused' ? 'STOP' : 'START'));

['apiKey', 'model', 'baseUrl'].forEach((id) => $(id).addEventListener('change', persist));

$('playbackRate').addEventListener('input', paintRate);
$('playbackRate').addEventListener('change', persist);

$('reveal').addEventListener('click', () => {
  const k = $('apiKey');
  const show = k.type === 'password';
  k.type = show ? 'text' : 'password';
  $('reveal').classList.toggle('is-on', show);
});

$('test').addEventListener('click', async () => {
  await persist();
  const cfg = await getConfig();
  const out = $('test-result');
  const btn = $('test');
  btn.disabled = true;
  out.className = 'test-result';
  out.textContent = t('test_checking');
  const res = await chrome.runtime.sendMessage({ type: 'TEST_KEY', llm: cfg.llm }).catch((e) => ({ ok: false, error: String(e) }));
  btn.disabled = false;
  if (res?.ok) { out.className = 'test-result ok'; out.textContent = t('test_ok'); }
  else { out.className = 'test-result bad'; out.textContent = (res?.error || 'failed').slice(0, 40); }
});

$('adv-toggle').addEventListener('click', () => {
  const body = $('adv-body');
  const open = body.hidden;
  body.hidden = !open;
  $('adv-toggle').setAttribute('aria-expanded', String(open));
});

let polling = false;
function startPolling() {
  if (polling) return; // idempotent — never stack intervals
  polling = true;
  refresh();
  setInterval(refresh, 1500); // live status while the popup is open
}

$('signin').addEventListener('click', async () => {
  $('gate-sub').textContent = 'Checking…';
  const auth = await refreshAuth(true);
  if (auth?.allowed) startPolling(); // begin live status once authorized via the gate
});
$('signout').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'SIGN_OUT' }).catch(() => {});
  await refreshAuth(false);
});

/* ---------- boot ---------- */
(async () => {
  const prefs = await getPrefs();
  applyTheme(prefs.theme);
  applyI18n(prefs.lang);
  fill(await getConfig());
  const auth = await refreshAuth(false);   // cached; no Google prompt on open
  if (!auth?.allowed) return;               // stay on the gate until signed in
  startPolling();
})();
