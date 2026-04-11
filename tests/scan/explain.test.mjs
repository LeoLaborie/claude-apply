import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const EXPLAIN = path.join(REPO_ROOT, 'src', 'scan', 'explain.mjs');

function makeFixtureConfig(portalsYml, profileYml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-apply-explain-'));
  fs.writeFileSync(path.join(dir, 'portals.yml'), portalsYml);
  if (profileYml !== null) {
    fs.writeFileSync(path.join(dir, 'candidate-profile.yml'), profileYml);
  }
  return dir;
}

function runExplain(args, configDir) {
  return spawnSync('node', [EXPLAIN, ...args], {
    env: { ...process.env, CLAUDE_APPLY_CONFIG_DIR: configDir },
    encoding: 'utf8',
  });
}

test('explain: rejects "Backstage Portal" when positive is ["stage"]', () => {
  const dir = makeFixtureConfig(
    'tracked_companies: []\ntitle_filter:\n  positive:\n    - stage\n  negative: []\n',
    null
  );
  const res = runExplain(['Backstage Portal'], dir);
  assert.equal(res.status, 1, `stderr: ${res.stderr}`);
  assert.match(res.stdout, /REJECTED/);
  assert.match(res.stdout, /no positive match|title\.positive/);
  assert.match(res.stdout, /stage/);
});

test('explain: accepts "Stage Data Science" when positive is ["stage"]', () => {
  const dir = makeFixtureConfig(
    'tracked_companies: []\ntitle_filter:\n  positive:\n    - stage\n  negative: []\n',
    null
  );
  const res = runExplain(['Stage Data Science'], dir);
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  assert.match(res.stdout, /ACCEPTED|PASSED|pass/i);
});

test('explain: negative match is reported with the matched term', () => {
  const dir = makeFixtureConfig(
    'tracked_companies: []\ntitle_filter:\n  positive:\n    - intern\n  negative:\n    - sales\n',
    null
  );
  const res = runExplain(['Sales Intern'], dir);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /negative/);
  assert.match(res.stdout, /sales/);
});

test('explain: --company flag is honored for blacklist check', () => {
  const dir = makeFixtureConfig(
    'tracked_companies: []\ntitle_filter:\n  positive:\n    - intern\n  negative: []\n',
    'blacklist_companies:\n  - Foo\nmin_start_date: "2026-08-24"\n'
  );
  const res = runExplain(['ML Intern', '--company', 'Foo'], dir);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /blacklist/i);
});

test('explain: exits 2 with a usage error if no title given', () => {
  const dir = makeFixtureConfig('tracked_companies: []\ntitle_filter:\n  positive: []\n', null);
  const res = runExplain([], dir);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /usage/i);
});
