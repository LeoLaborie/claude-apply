import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { escapeLatex, formatDate, renderLatex, CoverLetterError } from '../../src/apply/cover-letter.mjs';

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

test('renderLatex injects placeholders into template', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-test-'));
  const result = await renderLatex({
    body: 'This is the letter body.',
    company: 'Acme & Co',
    role: 'ML Intern',
    candidateName: 'Alice Martin',
    email: 'alice@example.com',
    phone: '+33600000000',
    date: '12 avril 2026',
    outDir,
    outName: 'test-letter',
  });

  assert.ok(fs.existsSync(result.texPath));
  const tex = fs.readFileSync(result.texPath, 'utf8');
  assert.match(tex, /Alice Martin/);
  assert.match(tex, /Acme \\& Co/);
  assert.match(tex, /ML Intern/);
  assert.match(tex, /This is the letter body\./);
  assert.match(tex, /12 avril 2026/);

  fs.rmSync(outDir, { recursive: true });
});

test('CoverLetterError has code property', () => {
  const err = new CoverLetterError('LATEX_COMPILATION_FAILED', 'test');
  assert.equal(err.code, 'LATEX_COMPILATION_FAILED');
  assert.ok(err instanceof Error);
});
