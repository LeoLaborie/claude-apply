import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeVerdict,
  parseScoreJson,
  DEFAULT_AUTO_APPLY_MIN_SCORE,
} from '../../src/score/index.mjs';

test('computeVerdict — score >= threshold → apply', () => {
  assert.equal(computeVerdict(7, 7), 'apply');
  assert.equal(computeVerdict(8.5, 7), 'apply');
  assert.equal(computeVerdict(10, 7), 'apply');
});

test('computeVerdict — score < threshold → skip', () => {
  assert.equal(computeVerdict(6.9, 7), 'skip');
  assert.equal(computeVerdict(4.5, 7), 'skip');
  assert.equal(computeVerdict(0, 7), 'skip');
});

test('computeVerdict — issue #39 fixture: 4.5 with threshold 7 → skip', () => {
  assert.equal(computeVerdict(4.5, 7), 'skip');
});

test('computeVerdict — default threshold is applied when omitted', () => {
  assert.equal(DEFAULT_AUTO_APPLY_MIN_SCORE, 7);
  assert.equal(computeVerdict(7), 'apply');
  assert.equal(computeVerdict(6), 'skip');
});

test('computeVerdict — rejects non-numeric score', () => {
  assert.throws(() => computeVerdict('7', 7), /must be a number/);
  assert.throws(() => computeVerdict(NaN, 7), /must be a number/);
});

test('parseScoreJson — accepts {score, reason} without verdict', () => {
  const raw = '{"score": 8.2, "reason": "strong ML match"}';
  const parsed = parseScoreJson(raw);
  assert.equal(parsed.score, 8.2);
  assert.equal(parsed.reason, 'strong ML match');
  assert.equal(parsed.verdict, undefined);
});

test('parseScoreJson — tolerates surrounding text around JSON', () => {
  const raw = 'Here is the result:\n{"score": 3.1, "reason": "weak match"}\ndone';
  const parsed = parseScoreJson(raw);
  assert.equal(parsed.score, 3.1);
  assert.equal(parsed.reason, 'weak match');
});

test('parseScoreJson — rejects missing score', () => {
  assert.throws(() => parseScoreJson('{"reason": "x"}'), /score/);
});

test('parseScoreJson — rejects missing reason', () => {
  assert.throws(() => parseScoreJson('{"score": 5}'), /reason/);
});
