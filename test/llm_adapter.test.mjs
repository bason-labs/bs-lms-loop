// test/llm_adapter.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSolvePrompt, buildRequest, parseResponse, parseAnswerJson } from '../lib/llm_adapter.js';

test('buildSolvePrompt yields system+user with numbered options and context', () => {
  const m = buildSolvePrompt({ question: 'Q?', options: ['a', 'b'], context: 'ctx' });
  assert.equal(m[0].role, 'system');
  assert.equal(m[1].role, 'user');
  assert.match(m[1].content, /0\. a/);
  assert.match(m[1].content, /1\. b/);
  assert.match(m[1].content, /ctx/);
});

test('buildRequest openai: bearer auth + json mode', () => {
  const r = buildRequest('openai', { apiKey: 'k', model: 'gpt-4o-mini' }, buildSolvePrompt({ question: 'q', options: ['a'] }));
  assert.match(r.url, /openai\.com\/v1\/chat\/completions/);
  assert.equal(r.headers.authorization, 'Bearer k');
  assert.deepEqual(r.body.response_format, { type: 'json_object' });
});

test('buildRequest anthropic: browser header + system separated from messages', () => {
  const r = buildRequest('anthropic', { apiKey: 'k', model: 'claude-x' }, buildSolvePrompt({ question: 'q', options: ['a'] }));
  assert.equal(r.headers['x-api-key'], 'k');
  assert.equal(r.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.ok(r.body.system.length > 0);
  assert.ok(r.body.messages.every((m) => m.role !== 'system'));
});

test('buildRequest gemini: key in query + model in path', () => {
  const r = buildRequest('gemini', { apiKey: 'k', model: 'gemini-1.5-flash' }, buildSolvePrompt({ question: 'q', options: ['a'] }));
  assert.match(r.url, /key=k/);
  assert.match(r.url, /gemini-1\.5-flash:generateContent/);
});

test('buildRequest unknown provider throws', () => {
  assert.throws(() => buildRequest('nope', {}, []));
});

test('buildRequest custom uses baseUrl; throws when baseUrl missing', () => {
  const r = buildRequest('custom', { apiKey: 'k', model: 'm', baseUrl: 'https://my.host' }, buildSolvePrompt({ question: 'q', options: ['a'] }));
  assert.equal(r.url, 'https://my.host/v1/chat/completions');
  assert.equal(r.headers.authorization, 'Bearer k');
  assert.throws(() => buildRequest('custom', { apiKey: 'k', model: 'm', baseUrl: '' }, []));
});

test('parseResponse extracts text per provider (incl. custom + default)', () => {
  assert.equal(parseResponse('openai', { choices: [{ message: { content: 'x' } }] }), 'x');
  assert.equal(parseResponse('custom', { choices: [{ message: { content: 'c' } }] }), 'c');
  assert.equal(parseResponse('anthropic', { content: [{ text: 'a' }, { text: 'b' }] }), 'ab');
  assert.equal(parseResponse('gemini', { candidates: [{ content: { parts: [{ text: 'g' }] } }] }), 'g');
  assert.equal(parseResponse('unknown', {}), '');
});

test('parseAnswerJson tolerates surrounding prose', () => {
  const a = parseAnswerJson('Sure: {"answerIndices":[1,2],"answerText":["b"],"reason":"r"} done');
  assert.deepEqual(a.answerIndices, [1, 2]);
  assert.deepEqual(a.answerText, ['b']);
  assert.equal(a.reason, 'r');
});

test('parseAnswerJson returns null on garbage', () => {
  assert.equal(parseAnswerJson('no json here'), null);
});

test('parseAnswerJson drops null/empty indices (no spurious index 0)', () => {
  const a = parseAnswerJson('{"answerIndices":[null,"",2],"answerText":[],"reason":""}');
  assert.deepEqual(a.answerIndices, [2]);
});
