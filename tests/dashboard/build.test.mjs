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
