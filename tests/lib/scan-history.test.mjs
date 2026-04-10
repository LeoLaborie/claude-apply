import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadSeenUrls, appendHistoryRow } from '../../src/lib/scan-history.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-'));
afterEach(() => {
  for (const f of fs.readdirSync(tmp)) fs.unlinkSync(path.join(tmp, f));
});

test('loadSeenUrls — union de scan-history.tsv et applications.md', () => {
  const histPath = path.join(tmp, 'scan-history.tsv');
  const appsPath = path.join(tmp, 'applications.md');
  fs.writeFileSync(histPath,
    'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n' +
    'https://a.co/1\t2026-04-01\tlever\tX\tAcme\tadded\n' +
    'https://b.co/2\t2026-04-02\tlever\tY\tBeta\tskipped_title\n'
  );
  fs.writeFileSync(appsPath,
    '# Apps\n| # | Date | Company | Role | Score | Status | Report | Notes |\n' +
    '|---|---|---|---|---|---|---|---|\n' +
    '| 1 | 2026-04-05 | Gamma | Dev | 4.0 | Applied | [r](https://c.co/3) | note |\n'
  );
  const seen = loadSeenUrls(histPath, appsPath);
  assert.ok(seen instanceof Set);
  assert.equal(seen.has('https://a.co/1'), true);
  assert.equal(seen.has('https://b.co/2'), true);
  assert.equal(seen.has('https://c.co/3'), true);
  assert.equal(seen.has('https://nope.co/x'), false);
});

test('loadSeenUrls — fichiers inexistants retournent Set vide', () => {
  const seen = loadSeenUrls(
    path.join(tmp, 'no-hist.tsv'),
    path.join(tmp, 'no-apps.md')
  );
  assert.ok(seen instanceof Set);
  assert.equal(seen.size, 0);
});

test('appendHistoryRow — crée le fichier avec header si absent, puis append', () => {
  const p = path.join(tmp, 'h.tsv');
  appendHistoryRow(p, {
    url: 'https://a.co/1',
    first_seen: '2026-04-09',
    portal: 'lever',
    title: 'Dev',
    company: 'Acme',
    status: 'added',
  });
  appendHistoryRow(p, {
    url: 'https://b.co/2',
    first_seen: '2026-04-09',
    portal: 'lever',
    title: 'PM',
    company: 'Beta',
    status: 'skipped_title',
  });
  const content = fs.readFileSync(p, 'utf8');
  const lines = content.trim().split('\n');
  assert.equal(lines.length, 3); // header + 2 rows
  assert.equal(lines[0], 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus');
  assert.equal(lines[1].split('\t').length, 6);
  assert.ok(lines[1].includes('https://a.co/1'));
  assert.ok(lines[2].includes('skipped_title'));
});
