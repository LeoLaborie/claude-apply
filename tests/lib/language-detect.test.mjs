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

import { detectRequiredLanguages } from '../../src/lib/language-detect.mjs';

test('detectRequiredLanguages: "Spanish speaker" → [es]', () => {
  assert.deepEqual(detectRequiredLanguages('Data Scientist - Spanish speaker'), ['es']);
});

test('detectRequiredLanguages: "Deutschsprachig" → [de]', () => {
  assert.deepEqual(detectRequiredLanguages('Senior Deutschsprachig Engineer'), ['de']);
});

test('detectRequiredLanguages: "Nederlandstalig" → [nl]', () => {
  assert.deepEqual(detectRequiredLanguages('Nederlandstalig Analyst'), ['nl']);
});

test('detectRequiredLanguages: Italian marker → [it]', () => {
  assert.deepEqual(detectRequiredLanguages('Italian speaking Data Engineer'), ['it']);
});

test('detectRequiredLanguages: Portuguese marker → [pt]', () => {
  assert.deepEqual(detectRequiredLanguages('Portuguese speaker - LATAM'), ['pt']);
});

test('detectRequiredLanguages: accent support "español" → [es]', () => {
  assert.deepEqual(detectRequiredLanguages('Español native required'), ['es']);
});

test('detectRequiredLanguages: multi-language bilingual title', () => {
  const res = detectRequiredLanguages('Bilingual German/Spanish Analyst');
  assert.deepEqual(res.sort(), ['de', 'es']);
});

test('detectRequiredLanguages: no language marker → []', () => {
  assert.deepEqual(detectRequiredLanguages('Machine Learning Engineer'), []);
});

test('detectRequiredLanguages: country name without language marker does not match', () => {
  assert.deepEqual(detectRequiredLanguages('Argentinian Data Scientist'), []);
});

test('detectRequiredLanguages: empty / null input → []', () => {
  assert.deepEqual(detectRequiredLanguages(''), []);
  assert.deepEqual(detectRequiredLanguages(null), []);
  assert.deepEqual(detectRequiredLanguages(undefined), []);
});

test('detectRequiredLanguages: Japanese marker → [ja]', () => {
  assert.deepEqual(detectRequiredLanguages('Japanese speaking Sales Engineer'), ['ja']);
});

test('detectRequiredLanguages: nationality adjective as market descriptor does not match', () => {
  assert.deepEqual(detectRequiredLanguages('German Automotive Market Intern'), []);
  assert.deepEqual(detectRequiredLanguages('Italian Market Analyst'), []);
  assert.deepEqual(detectRequiredLanguages('Spanish Market Intern'), []);
  assert.deepEqual(detectRequiredLanguages('Japanese Electronics Engineer'), []);
  assert.deepEqual(detectRequiredLanguages('Dutch Healthcare Specialist'), []);
  assert.deepEqual(detectRequiredLanguages('Chinese Tech Market Manager'), []);
});

test('detectRequiredLanguages: qualifier before adjective also matches', () => {
  assert.deepEqual(detectRequiredLanguages('Native Spanish Account Manager'), ['es']);
  assert.deepEqual(detectRequiredLanguages('Fluent German Sales Lead'), ['de']);
});
