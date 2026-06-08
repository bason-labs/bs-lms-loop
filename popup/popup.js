import { getConfig, setConfig } from '../lib/storage.js';

const $ = (id) => document.getElementById(id);
const groupEl = (name) => document.querySelector(`[data-group="${name}"]`);

const MODEL_HINT = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
  gemini: 'gemini-1.5-flash',
  custom: 'your-model'
};

let status = 'idle';

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

/* ---------- config <-> UI ---------- */
function fill(cfg) {
  setGroup('provider', cfg.llm.provider);
  setGroup('mode', cfg.mode);
  setGroup('fallback', cfg.quiz.fallback);
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
  cfg.video.playbackRate = Number($('playbackRate').value) || 8;
  cfg.quiz.fallback = getGroup('fallback');
  await setConfig(cfg);
}

function syncProvider() {
  const p = getGroup('provider');
  $('baseUrl-field').hidden = p !== 'custom';
  $('model').placeholder = MODEL_HINT[p] || 'model';
}

/* ---------- status presentation ---------- */
const SUB_RUNNING = (t) => (t ? `Handling the ${t} lesson · clicking through.` : 'Working through the course…');

function applyStatus(rs) {
  status = rs?.status || 'idle';
  const type = rs?.currentType;
  const chip = $('chip');
  chip.dataset.status = status;
  $('chip-label').textContent = status;

  const power = $('power');
  const running = status === 'running' || status === 'paused';
  power.classList.toggle('is-running', running);

  const view = {
    idle: ['Standing by', 'Open a lesson and start the loop.', 'Start automating'],
    running: ['Running', SUB_RUNNING(type), 'Stop'],
    paused: ['Paused', 'The loop is holding here.', 'Resume'],
    done: ['Course complete', 'Nothing left to advance.', 'Run again'],
    error: ['Hit a snag', rs?.error || 'Something went wrong — check the page.', 'Try again']
  }[status] || ['Standing by', 'Open a lesson and start the loop.', 'Start automating'];

  $('hero-status').textContent = view[0];
  $('hero-sub').textContent = view[1];
  $('power-label').textContent = view[2];
}

async function refresh() {
  const rs = await chrome.runtime.sendMessage({ type: 'GET_RUNSTATE' }).catch(() => null);
  applyStatus(rs);
}

async function control(action) {
  await persist();
  const res = await chrome.runtime.sendMessage({ type: 'CONTROL', action }).catch((e) => ({ error: String(e) }));
  if (res?.runState) applyStatus(res.runState);
  else applyStatus({ status: 'error', error: res?.error || 'no response' });
}

/* ---------- wiring ---------- */
// provider pills
groupEl('provider').addEventListener('click', (e) => {
  const b = e.target.closest('[data-value]');
  if (!b) return;
  setGroup('provider', b.dataset.value);
  syncProvider();
  persist();
});

// segmented controls (mode + fallback)
['mode', 'fallback'].forEach((name) => {
  groupEl(name).addEventListener('click', (e) => {
    const b = e.target.closest('[data-value]');
    if (!b) return;
    setGroup(name, b.dataset.value);
    persist();
  });
});

// power button morphs by status
$('power').addEventListener('click', () => control(status === 'running' || status === 'paused' ? 'STOP' : 'START'));

// text inputs
['apiKey', 'model', 'baseUrl'].forEach((id) => $(id).addEventListener('change', persist));

// range
$('playbackRate').addEventListener('input', paintRate);
$('playbackRate').addEventListener('change', persist);

// key reveal
$('reveal').addEventListener('click', () => {
  const k = $('apiKey');
  const show = k.type === 'password';
  k.type = show ? 'text' : 'password';
  $('reveal').classList.toggle('is-on', show);
});

// test key
$('test').addEventListener('click', async () => {
  await persist();
  const cfg = await getConfig();
  const out = $('test-result');
  const btn = $('test');
  btn.disabled = true;
  out.className = 'test-result';
  out.textContent = 'checking…';
  const res = await chrome.runtime.sendMessage({ type: 'TEST_KEY', llm: cfg.llm }).catch((e) => ({ ok: false, error: String(e) }));
  btn.disabled = false;
  if (res?.ok) { out.className = 'test-result ok'; out.textContent = 'key works ✓'; }
  else { out.className = 'test-result bad'; out.textContent = (res?.error || 'failed').slice(0, 40); }
});

// behavior disclosure
$('adv-toggle').addEventListener('click', () => {
  const body = $('adv-body');
  const open = body.hidden;
  body.hidden = !open;
  $('adv-toggle').setAttribute('aria-expanded', String(open));
});

/* ---------- boot ---------- */
(async () => {
  fill(await getConfig());
  await refresh();
  setInterval(refresh, 1500); // live status while the popup is open
})();
