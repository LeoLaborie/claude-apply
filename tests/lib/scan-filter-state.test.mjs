import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  hashFilterConfig,
  loadFilterState,
  saveFilterState,
  purgeSkippedFromHistory,
} from '../../src/lib/scan-filter-state.mjs';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'scan-filter-state-'));
}

// ---------- hashFilterConfig ----------

test('hashFilterConfig: same config → same hash', () => {
  const cfg = {
    whitelist: { positive: ['Intern'], negative: [], required_any: ['ML'] },
    blacklist: [],
    minStartDate: '2026-08-24',
    targetLocations: ['France', 'Paris'],
    profileLanguages: [{ code: 'fr', level: 'native' }],
  };
  assert.equal(hashFilterConfig(cfg), hashFilterConfig(cfg));
});

test('hashFilterConfig: key order does not matter', () => {
  const a = {
    whitelist: { positive: ['A'], negative: ['B'], required_any: ['C'] },
    blacklist: [],
    minStartDate: '',
    targetLocations: [],
    profileLanguages: [],
  };
  const b = {
    blacklist: [],
    profileLanguages: [],
    whitelist: { required_any: ['C'], negative: ['B'], positive: ['A'] },
    targetLocations: [],
    minStartDate: '',
  };
  assert.equal(hashFilterConfig(a), hashFilterConfig(b));
});

test('hashFilterConfig: adding a required_any term changes the hash', () => {
  const a = {
    whitelist: { positive: ['Intern'], negative: [], required_any: ['ML'] },
    blacklist: [],
    minStartDate: '2026-08-24',
    targetLocations: ['France'],
    profileLanguages: [],
  };
  const b = { ...a, whitelist: { ...a.whitelist, required_any: ['ML', 'research'] } };
  assert.notEqual(hashFilterConfig(a), hashFilterConfig(b));
});

test('hashFilterConfig: changing targetLocations changes the hash', () => {
  const a = {
    whitelist: { positive: [], negative: [], required_any: [] },
    blacklist: [],
    minStartDate: '',
    targetLocations: ['France'],
    profileLanguages: [],
  };
  const b = { ...a, targetLocations: ['France', 'Remote'] };
  assert.notEqual(hashFilterConfig(a), hashFilterConfig(b));
});

test('hashFilterConfig: empty/missing config still produces a stable hash', () => {
  assert.equal(hashFilterConfig({}), hashFilterConfig(null));
  assert.equal(hashFilterConfig({}), hashFilterConfig(undefined));
});

test('hashFilterConfig: required_any_in affects the hash', () => {
  const a = {
    whitelist: { positive: ['Intern'], negative: [], required_any: ['ML'] },
    blacklist: [],
    minStartDate: '',
    targetLocations: [],
    profileLanguages: [],
  };
  const b = { ...a, whitelist: { ...a.whitelist, required_any_in: ['description'] } };
  assert.notEqual(hashFilterConfig(a), hashFilterConfig(b));
});

// ---------- save/load ----------

test('saveFilterState + loadFilterState round-trip', () => {
  const dir = tmpDir();
  const p = path.join(dir, 'state.json');
  saveFilterState(p, { filter_hash: 'abc123' });
  const s = loadFilterState(p);
  assert.equal(s.filter_hash, 'abc123');
  assert.ok(s.last_updated);
});

test('loadFilterState returns null on missing file', () => {
  const dir = tmpDir();
  assert.equal(loadFilterState(path.join(dir, 'nope.json')), null);
});

test('loadFilterState returns null on corrupt JSON', () => {
  const dir = tmpDir();
  const p = path.join(dir, 'bad.json');
  fs.writeFileSync(p, '{not json', 'utf8');
  assert.equal(loadFilterState(p), null);
});

test('loadFilterState returns null on missing filter_hash field', () => {
  const dir = tmpDir();
  const p = path.join(dir, 'empty.json');
  fs.writeFileSync(p, '{"foo":"bar"}', 'utf8');
  assert.equal(loadFilterState(p), null);
});

// ---------- purgeSkippedFromHistory ----------

test('purgeSkippedFromHistory drops skipped_* rows, keeps added and error_fetch', () => {
  const dir = tmpDir();
  const p = path.join(dir, 'history.tsv');
  const rows = [
    'url\tfirst_seen\tportal\ttitle\tcompany\tstatus',
    'https://a/1\t2026-04-22\tlever\tX\tA\tskipped_title',
    'https://a/2\t2026-04-22\tlever\tY\tA\tadded',
    'https://b/3\t2026-04-22\tgreenhouse\tZ\tB\tskipped_location',
    'error://C\t2026-04-22\tunknown\terr\tC\terror_fetch',
    'https://a/4\t2026-04-22\tlever\tW\tA\tskipped_language',
  ];
  fs.writeFileSync(p, rows.join('\n') + '\n', 'utf8');

  const result = purgeSkippedFromHistory(p);
  assert.equal(result.purged, 3);
  assert.equal(result.kept, 2);

  const after = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
  assert.equal(after.length, 3); // header + 2 kept
  assert.match(after[1], /added$/);
  assert.match(after[2], /error_fetch$/);
});

test('purgeSkippedFromHistory is safe on missing file', () => {
  const dir = tmpDir();
  const result = purgeSkippedFromHistory(path.join(dir, 'missing.tsv'));
  assert.deepEqual(result, { kept: 0, purged: 0 });
});

test('purgeSkippedFromHistory handles empty file (header only)', () => {
  const dir = tmpDir();
  const p = path.join(dir, 'empty.tsv');
  fs.writeFileSync(p, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n', 'utf8');
  const result = purgeSkippedFromHistory(p);
  assert.deepEqual(result, { kept: 0, purged: 0 });
});
