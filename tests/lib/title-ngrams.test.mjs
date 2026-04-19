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

import { ngrams } from '../../src/lib/title-ngrams.mjs';

test('ngrams produces joined unigrams through maxN-grams', () => {
  assert.deepEqual(ngrams(['research', 'engineer', 'intern'], 1), [
    'research',
    'engineer',
    'intern',
  ]);
  assert.deepEqual(ngrams(['research', 'engineer', 'intern'], 2), [
    'research',
    'engineer',
    'intern',
    'research engineer',
    'engineer intern',
  ]);
  assert.deepEqual(ngrams(['a', 'b', 'c'], 3), ['a', 'b', 'c', 'a b', 'b c', 'a b c']);
});

test('ngrams caps at token length', () => {
  assert.deepEqual(ngrams(['only'], 3), ['only']);
  assert.deepEqual(ngrams([], 3), []);
});
