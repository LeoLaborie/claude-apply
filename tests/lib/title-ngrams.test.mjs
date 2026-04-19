import test from 'node:test';
import assert from 'node:assert/strict';

import { tokenize } from '../../src/lib/title-ngrams.mjs';

test('tokenize lowercases, strips punctuation, collapses whitespace', () => {
  assert.deepEqual(tokenize('Research Engineer - Reinforcement Learning'), [
    'research',
    'engineer',
    'reinforcement',
    'learning',
  ]);
});

test('tokenize drops empty tokens and keeps unicode letters', () => {
  assert.deepEqual(tokenize('  Stagiaire  —  Développeur  '), ['stagiaire', 'développeur']);
});

test('tokenize returns [] for empty input', () => {
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize(null), []);
});
