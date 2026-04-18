import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeTrackerTsv } from '../../src/lib/tsv-writer.mjs';

test('writeTrackerTsv — formats score as X.X/10', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsv-writer-'));
  const filePath = writeTrackerTsv(dir, {
    num: 42,
    date: '2026-04-18',
    company: 'Acme',
    role: 'ML Intern',
    score: 8.4,
    notes: 'ok',
  });
  const line = fs.readFileSync(filePath, 'utf8');
  const cells = line.trimEnd().split('\t');
  assert.equal(cells[5], '8.4/10');
  assert.ok(!line.includes('8.4/5'));
});
