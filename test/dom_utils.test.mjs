// test/dom_utils.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

(0, eval)(readFileSync(new URL('../lib/dom_utils.js', import.meta.url), 'utf8'));
const dom = globalThis.__LMS.dom;

test('norm collapses whitespace and lowercases', () => {
  assert.equal(dom.norm('  Next   Lesson \n'), 'next lesson');
});

test('deriveLessonId is stable for same url+title', () => {
  const a = dom.deriveLessonId('https://lms/x/1#m', 'Intro');
  const b = dom.deriveLessonId('https://lms/x/1#m', 'Intro');
  assert.equal(a, b);
  assert.match(a, /^L[0-9a-z]+$/);
});

test('deriveLessonId differs across lessons', () => {
  assert.notEqual(dom.deriveLessonId('https://lms/x/1', 'A'), dom.deriveLessonId('https://lms/x/2', 'A'));
});
