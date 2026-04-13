import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  escapeLatex,
  formatDate,
  renderLatex,
  CoverLetterError,
} from '../../src/apply/cover-letter.mjs';

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

test('renderLatex injects placeholders into template', async (t) => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-test-'));
  const spawnMock = t.mock.fn((cmd, args) => {
    const outDirArg = args.find((a) => a.startsWith('-output-directory='));
    const dir = outDirArg.split('=')[1];
    const texFile = args[args.length - 1];
    const name = path.basename(texFile, '.tex');
    fs.writeFileSync(path.join(dir, `${name}.pdf`), 'fake-pdf');
    return { status: 0, stdout: '', stderr: '' };
  });
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
    _spawnSync: spawnMock,
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

test('renderLatex escapes LaTeX special characters in body', async (t) => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-body-'));
  const spawnMock = t.mock.fn((cmd, args) => {
    const outDirArg = args.find((a) => a.startsWith('-output-directory='));
    const dir = outDirArg.split('=')[1];
    const texFile = args[args.length - 1];
    const name = path.basename(texFile, '.tex');
    fs.writeFileSync(path.join(dir, `${name}.pdf`), 'fake-pdf');
    return { status: 0, stdout: '', stderr: '' };
  });
  const result = await renderLatex({
    body: 'Led R&D on 50% of the $100K budget with #1 team_lead.',
    company: 'Acme',
    role: 'ML',
    candidateName: 'Alice Martin',
    email: 'a@b.c',
    phone: '+33',
    date: '2026',
    outDir,
    outName: 'body-esc',
    _spawnSync: spawnMock,
  });
  const tex = fs.readFileSync(result.texPath, 'utf8');
  assert.match(tex, /R\\&D/);
  assert.match(tex, /50\\%/);
  assert.match(tex, /\\\$100K/);
  assert.match(tex, /\\#1/);
  assert.match(tex, /team\\_lead/);
  fs.rmSync(outDir, { recursive: true });
});

test('CoverLetterError has code property', () => {
  const err = new CoverLetterError('LATEX_COMPILATION_FAILED', 'test');
  assert.equal(err.code, 'LATEX_COMPILATION_FAILED');
  assert.ok(err instanceof Error);
});

import { generateCoverLetter } from '../../src/apply/cover-letter.mjs';

test('generateCoverLetter calls buildLetterPrompt and returns pdfPath + textContent', async (t) => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-gen-'));

  const spawnMock = t.mock.fn((cmd, args, opts) => {
    if (cmd === 'claude') {
      return {
        status: 0,
        stdout: JSON.stringify({
          result: 'Generated letter body about ML.',
          usage: { input_tokens: 100, output_tokens: 50 },
          total_cost_usd: 0.001,
        }),
        stderr: '',
      };
    }
    if (cmd === 'pdflatex') {
      const outDirArg = args.find((a) => a.startsWith('-output-directory='));
      const dir = outDirArg.split('=')[1];
      const texFile = args[args.length - 1];
      const name = path.basename(texFile, '.tex');
      fs.writeFileSync(path.join(dir, `${name}.pdf`), 'fake-pdf');
      return { status: 0, stdout: '', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  });

  const result = await generateCoverLetter({
    company: 'Acme AI',
    role: 'ML Intern',
    jdText: 'Looking for ML intern with Python.',
    language: 'fr',
    cvMd: '# Alice Martin\nML student',
    profile: {
      first_name: 'Alice',
      last_name: 'Martin',
      email: 'alice@example.com',
      phone: '+33600000000',
    },
    outDir,
    _spawnSync: spawnMock,
  });

  assert.ok(result.pdfPath.endsWith('.pdf'));
  assert.equal(result.textContent, 'Generated letter body about ML.');
  assert.equal(result.usage.input_tokens, 100);
  assert.equal(spawnMock.mock.calls.length, 2); // claude + pdflatex

  fs.rmSync(outDir, { recursive: true });
});

test('generateCoverLetter throws LLM_GENERATION_FAILED when claude -p fails', async (t) => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-fail-'));
  const spawnMock = t.mock.fn(() => ({ status: 1, stdout: '', stderr: 'API error' }));

  await assert.rejects(
    () =>
      generateCoverLetter({
        company: 'X',
        role: 'Y',
        jdText: '',
        language: 'en',
        cvMd: '',
        profile: { first_name: 'A', last_name: 'B', email: '', phone: '' },
        outDir,
        _spawnSync: spawnMock,
      }),
    (err) => {
      assert.equal(err.code, 'LLM_GENERATION_FAILED');
      return true;
    }
  );

  fs.rmSync(outDir, { recursive: true });
});

test('generateCoverLetter produces correctly named PDF', async (t) => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-name-'));
  const spawnMock = t.mock.fn((cmd, args, opts) => {
    if (cmd === 'claude') {
      return {
        status: 0,
        stdout: JSON.stringify({ result: 'Body text.', usage: {} }),
        stderr: '',
      };
    }
    if (cmd === 'pdflatex') {
      const outDirArg = args.find((a) => a.startsWith('-output-directory='));
      const dir = outDirArg.split('=')[1];
      const texFile = args[args.length - 1];
      const name = path.basename(texFile, '.tex');
      fs.writeFileSync(path.join(dir, `${name}.pdf`), 'fake');
      return { status: 0, stdout: '', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  });

  const result = await generateCoverLetter({
    company: 'Acme & Co.',
    role: 'Machine Learning Intern (Paris)',
    jdText: '',
    language: 'fr',
    cvMd: '',
    profile: { first_name: 'Alice', last_name: 'Martin', email: '', phone: '' },
    outDir,
    _spawnSync: spawnMock,
  });

  const fileName = path.basename(result.pdfPath);
  assert.match(fileName, /^\d{4}-\d{2}-\d{2}_acme-co_machine-learning-intern-paris\.pdf$/);

  fs.rmSync(outDir, { recursive: true });
});
