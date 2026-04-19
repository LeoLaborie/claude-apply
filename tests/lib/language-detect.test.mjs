import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelRank, MIN_LANGUAGE_LEVEL } from '../../src/lib/language-detect.mjs';

test('levelRank: orders A1 < A2 < B1 < B2 < C1 < C2 < native', () => {
  assert.ok(levelRank('A1') < levelRank('A2'));
  assert.ok(levelRank('A2') < levelRank('B1'));
  assert.ok(levelRank('B1') < levelRank('B2'));
  assert.ok(levelRank('B2') < levelRank('C1'));
  assert.ok(levelRank('C1') < levelRank('C2'));
  assert.ok(levelRank('C2') < levelRank('native'));
});

test('levelRank: unknown level returns 0', () => {
  assert.equal(levelRank('Z9'), 0);
  assert.equal(levelRank(undefined), 0);
  assert.equal(levelRank(null), 0);
  assert.equal(levelRank(''), 0);
});

test('levelRank: case-insensitive', () => {
  assert.equal(levelRank('b2'), levelRank('B2'));
  assert.equal(levelRank('NATIVE'), levelRank('native'));
});

test('MIN_LANGUAGE_LEVEL constant equals B2', () => {
  assert.equal(MIN_LANGUAGE_LEVEL, 'B2');
});
