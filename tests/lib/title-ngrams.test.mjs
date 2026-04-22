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

import { suggestNgrams } from '../../src/lib/title-ngrams.mjs';

const STOP = new Set(['the', 'and', 'of', 'in', 'for', 'a', 'to', 'at']);

test('suggestNgrams ranks by count desc with lift, filters stop-words', () => {
  const titles = [
    'Research Engineer - LLM',
    'Research Engineer - Safety',
    'Applied Scientist LLM',
    'Applied Scientist Safety',
    'Software Engineer',
  ];
  const out = suggestNgrams(titles, {
    maxN: 2,
    minCount: 2,
    stopWords: STOP,
    existingTerms: [],
  });
  const ngramsOnly = out.map((e) => e.ngram);
  assert.ok(ngramsOnly.includes('research engineer'));
  assert.ok(ngramsOnly.includes('applied scientist'));
  const rResearch = out.find((e) => e.ngram === 'research engineer');
  assert.equal(rResearch.count, 2);
  assert.equal(rResearch.lift, 2 / 5);
});

test('suggestNgrams excludes existingTerms (case-insensitive, whole ngram)', () => {
  const out = suggestNgrams(['Applied Scientist', 'Applied Scientist'], {
    maxN: 2,
    minCount: 2,
    stopWords: new Set(),
    existingTerms: ['Applied Scientist'],
  });
  assert.ok(!out.some((e) => e.ngram === 'applied scientist'));
});

test('suggestNgrams drops ngrams below minCount', () => {
  const out = suggestNgrams(['alpha beta', 'gamma delta'], {
    maxN: 2,
    minCount: 2,
    stopWords: new Set(),
    existingTerms: [],
  });
  assert.deepEqual(out, []);
});

test('suggestNgrams drops ngrams that are entirely stop-words', () => {
  const out = suggestNgrams(['the and', 'the and', 'the and'], {
    maxN: 2,
    minCount: 2,
    stopWords: STOP,
    existingTerms: [],
  });
  assert.deepEqual(out, []);
});

test('suggestNgrams accepts array stopWords and applies sane defaults', () => {
  const titles = ['Research Engineer', 'Research Engineer', 'Software Engineer'];
  const out = suggestNgrams(titles, { stopWords: ['software'] });
  const ngramsOnly = out.map((e) => e.ngram);
  assert.ok(ngramsOnly.includes('research engineer'));
  assert.ok(!ngramsOnly.includes('software'));
});

test('suggestNgrams returns results with no options provided', () => {
  const out = suggestNgrams(['alpha beta', 'alpha beta', 'alpha beta']);
  assert.ok(out.some((e) => e.ngram === 'alpha beta'));
});
