import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { appendJsonl, appendFilteredOut } from '../../src/lib/jsonl-writer.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'co-'));

afterEach(() => {
  for (const f of fs.readdirSync(tmp)) fs.unlinkSync(path.join(tmp, f));
});

test('appendJsonl écrit une ligne JSON + newline', () => {
  const p = path.join(tmp, 'evals.jsonl');
  appendJsonl(p, { id: '001', score: 4.2 });
  appendJsonl(p, { id: '002', score: 3.1 });
  const lines = fs.readFileSync(p, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]), { id: '001', score: 4.2 });
  assert.deepEqual(JSON.parse(lines[1]), { id: '002', score: 3.1 });
});

test('appendFilteredOut écrit une ligne TSV 5 colonnes', () => {
  const p = path.join(tmp, 'filtered.tsv');
  appendFilteredOut(p, {
    date: '2026-04-09',
    url: 'https://x.co/1',
    company: 'Acme',
    title: 'Sales Intern',
    reason: 'title: negative match "Sales"',
  });
  const content = fs.readFileSync(p, 'utf8');
  const [line] = content.trim().split('\n');
  const cols = line.split('\t');
  assert.equal(cols.length, 5);
  assert.equal(cols[0], '2026-04-09');
  assert.equal(cols[3], 'Sales Intern');
});

test('appendFilteredOut échappe les tabs dans les champs', () => {
  const p = path.join(tmp, 'filtered.tsv');
  appendFilteredOut(p, {
    date: '2026-04-09',
    url: 'https://x.co/1',
    company: 'A\tB',
    title: 'Dev',
    reason: 'x',
  });
  const line = fs.readFileSync(p, 'utf8').trim();
  assert.equal(line.split('\t').length, 5);
});
