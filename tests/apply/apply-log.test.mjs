import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendApplyLog } from '../../src/apply/apply-log.mjs';

test('appendApplyLog writes a JSON line with required fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'applylog-'));
  const file = join(dir, 'apply-log.jsonl');
  appendApplyLog(file, {
    url: 'https://jobs.lever.co/acme/abc',
    company: 'Acme',
    role: 'ML Intern',
    language: 'fr',
    finalStatus: 'Applied',
    gifPath: '/tmp/run.gif',
    durationMs: 42000,
  });
  const line = readFileSync(file, 'utf8').trim();
  const parsed = JSON.parse(line);
  assert.equal(parsed.url, 'https://jobs.lever.co/acme/abc');
  assert.equal(parsed.final_status, 'Applied');
  assert.ok(parsed.timestamp);
  rmSync(dir, { recursive: true, force: true });
});

test('appendApplyLog appends (does not overwrite)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'applylog-'));
  const file = join(dir, 'apply-log.jsonl');
  appendApplyLog(file, { url: 'a', finalStatus: 'Applied' });
  appendApplyLog(file, { url: 'b', finalStatus: 'Failed' });
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  rmSync(dir, { recursive: true, force: true });
});
