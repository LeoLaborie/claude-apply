import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeLatex, formatDate } from '../../src/apply/cover-letter.mjs';

test('escapeLatex escapes all LaTeX special characters', () => {
  assert.equal(escapeLatex('R&D 100%'), 'R\\&D 100\\%');
  assert.equal(escapeLatex('price is $5'), 'price is \\$5');
  assert.equal(escapeLatex('item #1'), 'item \\#1');
  assert.equal(escapeLatex('under_score'), 'under\\_score');
  assert.equal(escapeLatex('{braces}'), '\\{braces\\}');
  assert.equal(escapeLatex('tilde~hat^'), 'tilde\\textasciitilde{}hat\\textasciicircum{}');
  assert.equal(escapeLatex('back\\slash'), 'back\\textbackslash{}slash');
});

test('escapeLatex handles empty and null input', () => {
  assert.equal(escapeLatex(''), '');
  assert.equal(escapeLatex(null), '');
  assert.equal(escapeLatex(undefined), '');
});

test('formatDate formats French date correctly', () => {
  const d = new Date('2026-04-12');
  assert.equal(formatDate(d, 'fr'), '12 avril 2026');
});

test('formatDate formats English date correctly', () => {
  const d = new Date('2026-04-12');
  assert.equal(formatDate(d, 'en'), 'April 12, 2026');
});

test('formatDate defaults to English for unknown language', () => {
  const d = new Date('2026-01-05');
  assert.equal(formatDate(d, 'de'), 'January 5, 2026');
});
