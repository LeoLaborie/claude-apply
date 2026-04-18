import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDashboard } from '../../src/dashboard/build.mjs';

const HEADER_LINE = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const SEPARATOR_LINE = '|---|------|---------|------|-------|--------|-----|--------|-------|';

function setupFixtureTree() {
  const dir = mkdtempSync(join(tmpdir(), 'dash-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'reports'), { recursive: true });

  writeFileSync(
    join(dir, 'data', 'applications.md'),
    [
      '# Applications Tracker',
      '',
      HEADER_LINE,
      SEPARATOR_LINE,
      '| 1 | 2026-04-10 | Acme Corp | ML Engineer Intern | 4.5/5 | Applied |  |  | Good fit |',
      '| 2 | 2026-04-05 | Widgets Inc | Data Scientist Intern | 3.8/5 | Interview |  |  |  |',
    ].join('\n')
  );

  writeFileSync(join(dir, 'data', 'evaluations.jsonl'), '');
  writeFileSync(join(dir, 'data', 'filtered-out.tsv'), '');

  return dir;
}

test('buildDashboard generates non-empty HTML from applications fixture', async () => {
  const dir = setupFixtureTree();
  const outPath = join(dir, 'dashboard.html');

  try {
    await buildDashboard({
      applicationsPath: join(dir, 'data', 'applications.md'),
      reportsDir: join(dir, 'reports'),
      evaluationsPath: join(dir, 'data', 'evaluations.jsonl'),
      filteredOutPath: join(dir, 'data', 'filtered-out.tsv'),
      outputPath: outPath,
    });

    assert.ok(existsSync(outPath), 'dashboard.html should be created');
    const html = readFileSync(outPath, 'utf8');
    assert.ok(html.length > 500, `HTML should be substantial (got ${html.length} bytes)`);
    assert.match(html, /Acme Corp/, 'should include Acme Corp');
    assert.match(html, /ML Engineer Intern/, 'should include ML Engineer Intern');
    assert.match(html, /Widgets Inc/, 'should include Widgets Inc');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildDashboard handles empty applications gracefully', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dash-empty-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'reports'), { recursive: true });
  writeFileSync(join(dir, 'data', 'applications.md'), '# Applications Tracker\n');
  writeFileSync(join(dir, 'data', 'evaluations.jsonl'), '');
  writeFileSync(join(dir, 'data', 'filtered-out.tsv'), '');
  const outPath = join(dir, 'dashboard.html');

  try {
    await buildDashboard({
      applicationsPath: join(dir, 'data', 'applications.md'),
      reportsDir: join(dir, 'reports'),
      evaluationsPath: join(dir, 'data', 'evaluations.jsonl'),
      filteredOutPath: join(dir, 'data', 'filtered-out.tsv'),
      outputPath: outPath,
    });
    assert.ok(existsSync(outPath));
    const html = readFileSync(outPath, 'utf8');
    assert.ok(html.length > 100, 'HTML should still have base structure');
    assert.match(html, /<html/, 'should be valid HTML');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildDashboard includes filtered-out entries when tsv has data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dash-filtered-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'reports'), { recursive: true });
  writeFileSync(join(dir, 'data', 'applications.md'), '# Applications Tracker\n');
  writeFileSync(join(dir, 'data', 'evaluations.jsonl'), '');
  writeFileSync(
    join(dir, 'data', 'filtered-out.tsv'),
    '2026-04-10\thttps://example.com/job/99\tSome Corp\tJunior Dev\ttoo junior\n'
  );
  const outPath = join(dir, 'dashboard.html');

  try {
    await buildDashboard({
      applicationsPath: join(dir, 'data', 'applications.md'),
      reportsDir: join(dir, 'reports'),
      evaluationsPath: join(dir, 'data', 'evaluations.jsonl'),
      filteredOutPath: join(dir, 'data', 'filtered-out.tsv'),
      outputPath: outPath,
    });
    const html = readFileSync(outPath, 'utf8');
    assert.match(html, /Some Corp/, 'filtered-out company should appear');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function setupScoreFixture({ appScore, evalEntry }) {
  const dir = mkdtempSync(join(tmpdir(), 'dash-score-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'reports'), { recursive: true });

  writeFileSync(
    join(dir, 'data', 'applications.md'),
    [
      '# Applications Tracker',
      '',
      HEADER_LINE,
      SEPARATOR_LINE,
      `| 1 | 2026-04-10 | ScoreCo | Engineer | ${appScore} | Applied |  |  |  |`,
    ].join('\n')
  );

  writeFileSync(
    join(dir, 'data', 'evaluations.jsonl'),
    evalEntry ? JSON.stringify(evalEntry) + '\n' : ''
  );
  writeFileSync(join(dir, 'data', 'filtered-out.tsv'), '');

  return dir;
}

async function runAndRead(dir) {
  const outPath = join(dir, 'dashboard.html');
  await buildDashboard({
    applicationsPath: join(dir, 'data', 'applications.md'),
    reportsDir: join(dir, 'reports'),
    evaluationsPath: join(dir, 'data', 'evaluations.jsonl'),
    filteredOutPath: join(dir, 'data', 'filtered-out.tsv'),
    outputPath: outPath,
  });
  return readFileSync(outPath, 'utf8');
}

test('buildDashboard uses evaluations.jsonl score when applications.md has —', async () => {
  const dir = setupScoreFixture({
    appScore: '—',
    evalEntry: { id: '001', score: 8.4, reason: 'ok', verdict: 'apply' },
  });
  try {
    const html = await runAndRead(dir);
    assert.match(html, /<td class="score">8\.4<\/td>/, 'score should be 8.4 from evaluations');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildDashboard prefers evaluations.jsonl score over applications.md', async () => {
  const dir = setupScoreFixture({
    appScore: '4.2',
    evalEntry: { id: '001', score: 8.4, reason: 'ok', verdict: 'apply' },
  });
  try {
    const html = await runAndRead(dir);
    assert.match(html, /<td class="score">8\.4<\/td>/, 'evaluations score wins');
    assert.doesNotMatch(html, /<td class="score">4\.2<\/td>/, 'stale applications score gone');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildDashboard falls back to applications.md score when no evaluations match', async () => {
  const dir = setupScoreFixture({ appScore: '7.0', evalEntry: null });
  try {
    const html = await runAndRead(dir);
    assert.match(html, /<td class="score">7\.0<\/td>/, 'fallback to applications score');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildDashboard ignores malformed evaluations score and uses fallback', async () => {
  const dir = setupScoreFixture({
    appScore: '7.0',
    evalEntry: { id: '001', score: 'not-a-number', reason: 'x', verdict: 'skip' },
  });
  try {
    const html = await runAndRead(dir);
    assert.match(html, /<td class="score">7\.0<\/td>/, 'malformed score ignored, fallback used');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
