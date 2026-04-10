import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  parseApplications,
  serializeApplications,
  appendApplication,
} from '../../src/lib/applications-md.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'appmd-'));
afterEach(() => {
  for (const f of fs.readdirSync(tmp)) fs.unlinkSync(path.join(tmp, f));
});

// ── Fixtures ───────────────────────────────────────────────────────────────

const SINGLE_ENTRY_MD = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-04-01 | Acme Corp | Software Intern | 4.2/5 | Applied | ❌ | [001](reports/001-acme-2026-04-01.md) | Good match |
`;

const MULTI_ENTRY_MD = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-04-01 | Acme Corp | Software Intern | 4.2/5 | Applied | ❌ | [001](reports/001-acme-2026-04-01.md) | Good match |
| 2 | 2026-04-02 | Widgets Inc | Data Intern | 3.8/5 | Evaluated | ❌ | [002](reports/002-widgets-2026-04-02.md) | Solid fit |
| 3 | 2026-04-03 | Beta Ltd | ML Intern | 4.5/5 | Discarded | ❌ | [003](reports/003-beta-2026-04-03.md) | Closed |
`;

const SAMPLE_APP = {
  num: '1',
  date: '2026-04-01',
  company: 'Acme Corp',
  role: 'Software Intern',
  score: '4.2/5',
  status: 'Applied',
  pdf: '❌',
  report: '[001](reports/001-acme-2026-04-01.md)',
  notes: 'Good match',
};

// ── Tests ──────────────────────────────────────────────────────────────────

test('parseApplications("") returns []', () => {
  assert.deepEqual(parseApplications(''), []);
});

test('parseApplications(null/undefined) returns []', () => {
  assert.deepEqual(parseApplications(null), []);
  assert.deepEqual(parseApplications(undefined), []);
});

test('parse single-entry markdown returns array of length 1 with correct fields', () => {
  const apps = parseApplications(SINGLE_ENTRY_MD);
  assert.equal(apps.length, 1);
  const a = apps[0];
  assert.equal(a.num, '1');
  assert.equal(a.date, '2026-04-01');
  assert.equal(a.company, 'Acme Corp');
  assert.equal(a.role, 'Software Intern');
  assert.equal(a.score, '4.2/5');
  assert.equal(a.status, 'Applied');
  assert.equal(a.pdf, '❌');
  assert.equal(a.notes, 'Good match');
});

test('parse multi-entry markdown returns correct count and field values', () => {
  const apps = parseApplications(MULTI_ENTRY_MD);
  assert.equal(apps.length, 3);
  assert.equal(apps[0].company, 'Acme Corp');
  assert.equal(apps[1].company, 'Widgets Inc');
  assert.equal(apps[2].company, 'Beta Ltd');
  assert.equal(apps[1].score, '3.8/5');
  assert.equal(apps[2].status, 'Discarded');
});

test('round-trip: serializeApplications(parseApplications(x)) equals x', () => {
  const apps = parseApplications(MULTI_ENTRY_MD);
  const out = serializeApplications(apps);
  const reparsed = parseApplications(out);
  assert.equal(reparsed.length, apps.length);
  for (let i = 0; i < apps.length; i++) {
    assert.equal(reparsed[i].company, apps[i].company);
    assert.equal(reparsed[i].role, apps[i].role);
    assert.equal(reparsed[i].score, apps[i].score);
    assert.equal(reparsed[i].status, apps[i].status);
    assert.equal(reparsed[i].notes, apps[i].notes);
  }
});

test('appendApplication on a fresh file creates it and writes the entry', async () => {
  const p = path.join(tmp, 'applications.md');
  await appendApplication(p, SAMPLE_APP);
  assert.ok(fs.existsSync(p));
  const content = fs.readFileSync(p, 'utf8');
  assert.ok(content.includes('# Applications Tracker'));
  assert.ok(content.includes('Acme Corp'));
  assert.ok(content.includes('4.2/5'));
  // Verify tmp file was cleaned up
  assert.equal(fs.existsSync(p + '.tmp'), false);
});

test('appendApplication on existing file appends without clobbering prior entries', async () => {
  const p = path.join(tmp, 'applications2.md');
  const first = { ...SAMPLE_APP, num: '1', company: 'Acme Corp', role: 'Software Intern' };
  const second = {
    num: '2',
    date: '2026-04-02',
    company: 'Widgets Inc',
    role: 'Data Intern',
    score: '3.8/5',
    status: 'Evaluated',
    pdf: '❌',
    report: '[002](reports/002-widgets-2026-04-02.md)',
    notes: 'Solid fit',
  };
  await appendApplication(p, first);
  await appendApplication(p, second);
  const apps = parseApplications(fs.readFileSync(p, 'utf8'));
  assert.equal(apps.length, 2);
  assert.equal(apps[0].company, 'Acme Corp');
  assert.equal(apps[1].company, 'Widgets Inc');
});

test('atomic append: file exists with both entries after two appends', async () => {
  const p = path.join(tmp, 'applications3.md');
  await appendApplication(p, { ...SAMPLE_APP, num: '1' });
  await appendApplication(p, {
    num: '2',
    date: '2026-04-05',
    company: 'Beta Ltd',
    role: 'ML Intern',
    score: '4.5/5',
    status: 'Discarded',
    pdf: '❌',
    report: '[002](reports/002-beta-2026-04-05.md)',
    notes: 'Closed',
  });
  assert.ok(fs.existsSync(p));
  assert.equal(fs.existsSync(p + '.tmp'), false, '.tmp must be renamed away');
  const content = fs.readFileSync(p, 'utf8');
  assert.ok(content.includes('Acme Corp'), 'first entry present');
  assert.ok(content.includes('Beta Ltd'), 'second entry present');
});
