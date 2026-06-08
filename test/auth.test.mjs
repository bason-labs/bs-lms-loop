// test/auth.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { normalizeEmail, emailHash, parseUserinfo, whitelistDocUrl, parseWhitelistDoc } from '../lib/auth.js';

test('normalizeEmail trims and lowercases', () => {
  assert.equal(normalizeEmail('  Foo@Bar.COM '), 'foo@bar.com');
  assert.equal(normalizeEmail(null), '');
});

test('emailHash is SHA-256 of the normalized email', async () => {
  const expected = createHash('sha256').update('a@b.com').digest('hex');
  assert.equal(await emailHash('  A@B.com '), expected);
});

test('parseUserinfo extracts a normalized email or null', () => {
  assert.equal(parseUserinfo({ email: 'X@Y.com', email_verified: true }), 'x@y.com');
  assert.equal(parseUserinfo({}), null);
});

test('whitelistDocUrl points at the right Firestore document', () => {
  assert.equal(
    whitelistDocUrl('proj', 'abc123'),
    'https://firestore.googleapis.com/v1/projects/proj/databases/(default)/documents/whitelist/abc123'
  );
});

test('parseWhitelistDoc: allowed when doc exists and not explicitly inactive', () => {
  assert.deepEqual(parseWhitelistDoc(200, { fields: {} }), { allowed: true });
  assert.deepEqual(parseWhitelistDoc(200, { fields: { active: { booleanValue: false } } }), { allowed: false });
  assert.deepEqual(parseWhitelistDoc(404, { error: {} }), { allowed: false });
});
