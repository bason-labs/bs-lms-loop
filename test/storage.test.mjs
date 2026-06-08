// test/storage.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendLessonToKb, DEFAULT_CONFIG, DEFAULT_RUNSTATE } from '../lib/storage.js';

test('appendLessonToKb adds a new lesson and records order', () => {
  const kb = { courseId: null, order: [], lessons: {} };
  const next = appendLessonToKb(kb, { id: 'L1', text: 'a' });
  assert.deepEqual(next.order, ['L1']);
  assert.equal(next.lessons.L1.text, 'a');
});

test('appendLessonToKb does not mutate input and merges existing', () => {
  const kb = { courseId: 'c', order: ['L1'], lessons: { L1: { id: 'L1', text: 'a', title: 't' } } };
  const next = appendLessonToKb(kb, { id: 'L1', text: 'b' });
  assert.equal(kb.lessons.L1.text, 'a');     // input untouched
  assert.equal(next.lessons.L1.text, 'b');   // value updated
  assert.equal(next.lessons.L1.title, 't');  // existing field merged
  assert.deepEqual(next.order, ['L1']);      // no duplicate id
});

test('defaults match spec shape', () => {
  assert.equal(DEFAULT_CONFIG.llm.provider, 'openai');
  assert.equal(DEFAULT_CONFIG.quiz.fallback, 'random');
  assert.equal(DEFAULT_RUNSTATE.status, 'idle');
});
