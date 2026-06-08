import { getConfig, setConfig } from '../lib/storage.js';

const $ = (id) => document.getElementById(id);
const watched = ['provider', 'apiKey', 'model', 'baseUrl', 'mode', 'playbackRate', 'fallback'];

function fill(cfg) {
  $('provider').value = cfg.llm.provider;
  $('apiKey').value = cfg.llm.apiKey;
  $('model').value = cfg.llm.model;
  $('baseUrl').value = cfg.llm.baseUrl;
  $('mode').value = cfg.mode;
  $('playbackRate').value = cfg.video.playbackRate;
  $('fallback').value = cfg.quiz.fallback;
}

async function persist() {
  const cfg = await getConfig();
  cfg.llm.provider = $('provider').value;
  cfg.llm.apiKey = $('apiKey').value.trim();
  cfg.llm.model = $('model').value.trim();
  cfg.llm.baseUrl = $('baseUrl').value.trim();
  cfg.mode = $('mode').value;
  cfg.video.playbackRate = Number($('playbackRate').value) || 8;
  cfg.quiz.fallback = $('fallback').value;
  await setConfig(cfg);
}

async function control(action) {
  await persist();
  const res = await chrome.runtime.sendMessage({ type: 'CONTROL', action });
  $('status').textContent = res?.runState?.status || res?.error || 'unknown';
}

$('start').addEventListener('click', () => control('START'));
$('stop').addEventListener('click', () => control('STOP'));
$('test').addEventListener('click', async () => {
  await persist();
  const cfg = await getConfig();
  $('status').textContent = 'testing…';
  const res = await chrome.runtime.sendMessage({ type: 'TEST_KEY', llm: cfg.llm });
  $('status').textContent = res?.ok ? 'key OK' : `key failed: ${res?.error || ''}`;
});
watched.forEach((f) => $(f).addEventListener('change', persist));

(async () => {
  fill(await getConfig());
  const rs = await chrome.runtime.sendMessage({ type: 'GET_RUNSTATE' }).catch(() => null);
  $('status').textContent = rs?.status || 'idle';
})();
