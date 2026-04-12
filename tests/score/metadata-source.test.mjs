import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScoreArgs } from '../../src/score/index.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const scoreBin = path.join(repoRoot, 'src/score/index.mjs');

function mkTmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'score-meta-'));
  fs.mkdirSync(path.join(d, 'config'), { recursive: true });
  fs.mkdirSync(path.join(d, 'data'), { recursive: true });
  fs.writeFileSync(path.join(d, 'config', 'cv.md'), '# CV\nDummy CV body.\n');
  return d;
}

test('parseScoreArgs — bare URL (scrape path)', () => {
  const f = parseScoreArgs(['https://jobs.example.com/a']);
  assert.equal(f.url, 'https://jobs.example.com/a');
  assert.equal(f.fromPipeline, false);
  assert.equal(f.company, null);
});

test('parseScoreArgs — all three metadata flags', () => {
  const f = parseScoreArgs([
    'https://jobs.example.com/a',
    '--company',
    'Acme Corp',
    '--role',
    'Software Engineer',
    '--location',
    'Paris',
  ]);
  assert.equal(f.company, 'Acme Corp');
  assert.equal(f.role, 'Software Engineer');
  assert.equal(f.location, 'Paris');
});

test('parseScoreArgs — --from-pipeline alone', () => {
  const f = parseScoreArgs(['https://jobs.example.com/a', '--from-pipeline']);
  assert.equal(f.fromPipeline, true);
  assert.equal(f.url, 'https://jobs.example.com/a');
});

test('parseScoreArgs — partial metadata flags throws', () => {
  assert.throws(
    () => parseScoreArgs(['https://jobs.example.com/a', '--company', 'Acme Corp']),
    /all-or-nothing/
  );
});

test('parseScoreArgs — --from-pipeline + --company throws', () => {
  assert.throws(
    () =>
      parseScoreArgs([
        'https://jobs.example.com/a',
        '--from-pipeline',
        '--company',
        'Acme Corp',
        '--role',
        'X',
        '--location',
        'Paris',
      ]),
    /mutually exclusive/
  );
});

test('parseScoreArgs — preserves --id and --json-input', () => {
  const f = parseScoreArgs(['--json-input', '/tmp/offer.json', '--id', '042']);
  assert.equal(f.jsonInput, '/tmp/offer.json');
  assert.equal(f.id, '042');
});

test('parseScoreArgs — --company without a value is treated as missing', () => {
  // No value for --company → flags.company stays null → validation passes
  // (no metadata flags at all). The trailing positional remains the URL.
  const f = parseScoreArgs(['https://jobs.example.com/a', '--company']);
  assert.equal(f.company, null);
  assert.equal(f.url, 'https://jobs.example.com/a');
});

test('parseScoreArgs — --company followed by another flag is treated as missing', () => {
  // --company has no real value (the next token is another flag) → throws
  // because --role and --location ARE provided, so company is the only missing one.
  assert.throws(
    () =>
      parseScoreArgs([
        'https://jobs.example.com/a',
        '--company',
        '--role',
        'Software Engineer',
        '--location',
        'Paris',
      ]),
    /all-or-nothing/
  );
});

test('--from-pipeline: exits 2 when url is absent from pipeline.md', () => {
  const tmp = mkTmp();
  fs.writeFileSync(
    path.join(tmp, 'data', 'pipeline.md'),
    '# Pipeline\n\n## Acme Corp (Paris)\n\n- [ ] https://jobs.example.com/a | Acme Corp | SWE\n'
  );
  const proc = spawnSync(
    'node',
    [scoreBin, 'https://jobs.example.com/missing', '--from-pipeline'],
    {
      env: {
        ...process.env,
        CLAUDE_APPLY_CONFIG_DIR: path.join(tmp, 'config'),
        CLAUDE_APPLY_DATA_DIR: path.join(tmp, 'data'),
      },
      encoding: 'utf8',
    }
  );
  assert.equal(proc.status, 2);
  assert.match(proc.stderr, /not found in pipeline\.md/);
});

test('--from-pipeline: exits 2 when pipeline.md does not exist', () => {
  const tmp = mkTmp();
  // No pipeline.md created in tmp/data
  const proc = spawnSync('node', [scoreBin, 'https://jobs.example.com/a', '--from-pipeline'], {
    env: {
      ...process.env,
      CLAUDE_APPLY_CONFIG_DIR: path.join(tmp, 'config'),
      CLAUDE_APPLY_DATA_DIR: path.join(tmp, 'data'),
    },
    encoding: 'utf8',
  });
  assert.equal(proc.status, 2);
  assert.match(proc.stderr, /does not exist/);
});

test('--company without --role/--location exits 2 with clear message', () => {
  const tmp = mkTmp();
  const proc = spawnSync(
    'node',
    [scoreBin, 'https://jobs.example.com/a', '--company', 'Acme Corp'],
    {
      env: {
        ...process.env,
        CLAUDE_APPLY_CONFIG_DIR: path.join(tmp, 'config'),
        CLAUDE_APPLY_DATA_DIR: path.join(tmp, 'data'),
      },
      encoding: 'utf8',
    }
  );
  assert.equal(proc.status, 2);
  assert.match(proc.stderr, /all-or-nothing/);
});

test('--from-pipeline + --company is rejected as mutually exclusive', () => {
  const tmp = mkTmp();
  const proc = spawnSync(
    'node',
    [
      scoreBin,
      'https://jobs.example.com/a',
      '--from-pipeline',
      '--company',
      'Acme Corp',
      '--role',
      'SWE',
      '--location',
      'Paris',
    ],
    {
      env: {
        ...process.env,
        CLAUDE_APPLY_CONFIG_DIR: path.join(tmp, 'config'),
        CLAUDE_APPLY_DATA_DIR: path.join(tmp, 'data'),
      },
      encoding: 'utf8',
    }
  );
  assert.equal(proc.status, 2);
  assert.match(proc.stderr, /mutually exclusive/);
});

test('parseScoreArgs — --batch flag', () => {
  const f = parseScoreArgs(['--batch']);
  assert.equal(f.batch, true);
  assert.equal(f.parallel, 5);
  assert.equal(f.url, null);
});

test('parseScoreArgs — --parallel implies --batch', () => {
  const f = parseScoreArgs(['--parallel', '3']);
  assert.equal(f.batch, true);
  assert.equal(f.parallel, 3);
});

test('parseScoreArgs — --batch + URL throws', () => {
  assert.throws(
    () => parseScoreArgs(['https://jobs.example.com/a', '--batch']),
    /mutually exclusive/
  );
});

test('parseScoreArgs — --parallel without value defaults to 5', () => {
  const f = parseScoreArgs(['--batch', '--parallel']);
  assert.equal(f.parallel, 5);
});

test('parseScoreArgs — --batch + --from-pipeline throws', () => {
  assert.throws(() => parseScoreArgs(['--batch', '--from-pipeline']), /mutually exclusive/);
});
