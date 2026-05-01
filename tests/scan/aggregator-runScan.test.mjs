import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { installMockFetch } from '../helpers.mjs';
import { runScan } from '../../src/scan/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixA = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'aggregators', 'greenhouse-board-a.json'),
    'utf8'
  )
);
const fixB = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'aggregators', 'greenhouse-board-b.json'),
    'utf8'
  )
);

const URL_A = 'https://boards-api.greenhouse.io/v1/boards/board-a/jobs?content=true';
const URL_B = 'https://boards-api.greenhouse.io/v1/boards/board-b/jobs?content=true';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-agg-'));
let restore;

afterEach(() => {
  if (restore) restore();
  for (const f of fs.readdirSync(tmp)) {
    try {
      fs.unlinkSync(path.join(tmp, f));
    } catch {}
  }
});

function paths() {
  return {
    pipelinePath: path.join(tmp, 'pipeline.md'),
    historyPath: path.join(tmp, 'scan-history.tsv'),
    filteredPath: path.join(tmp, 'filtered-out.tsv'),
    applicationsPath: path.join(tmp, 'applications.md'),
  };
}

const baseProfile = {
  min_start_date: '2026-08-24',
  blacklist_companies: [],
  target_locations: ['France', 'Paris', 'Remote'],
};

const portalsConfig = {
  title_filter: { positive: ['Intern', 'Stage'], negative: [] },
  tracked_companies: [],
  aggregators: {
    greenhouse: {
      boards: [
        { slug: 'board-a', company: 'Board A Inc' },
        { slug: 'board-b', company: 'Board B Co' },
      ],
    },
  },
};

test('runScan source=aggregator — applique le prefilter et écrit pipeline.md', async () => {
  restore = installMockFetch({ [URL_A]: fixA, [URL_B]: fixB });

  const p = paths();
  fs.writeFileSync(p.applicationsPath, '# Apps\n');

  const result = await runScan({
    portalsConfig,
    profile: baseProfile,
    ...p,
    dryRun: false,
    source: 'aggregator',
  });

  // Title filter (Intern|Stage) keeps:
  //   - "Software Engineering Intern" / Paris
  //   - "Research Internship" / London
  //   - "Stage Data Science" / Lyon
  // Location filter (target France/Paris/Remote) rejects "Research Internship" (London).
  // Final added: 2.
  assert.equal(result.added.length, 2);
  const titles = result.added.map((o) => o.title).sort();
  assert.deepEqual(titles, ['Software Engineering Intern', 'Stage Data Science']);

  const md = fs.readFileSync(p.pipelinePath, 'utf8');
  assert.ok(md.includes('Board A Inc'));
  assert.ok(md.includes('Board B Co'));
  assert.ok(md.includes('Software Engineering Intern'));
  assert.ok(md.includes('Stage Data Science'));

  // The aggregator entry shows up in perCompany under its synthetic name.
  const aggEntry = result.perCompany.find((c) => c.platform === 'aggregator:greenhouse');
  assert.ok(aggEntry, 'aggregator entry missing in perCompany');

  // Title-rejected ("Senior Backend Engineer", "Marketing Manager") + location-rejected
  // ("Research Internship" / London) are recorded in filtered-out.tsv.
  const filt = fs.readFileSync(p.filteredPath, 'utf8');
  assert.ok(filt.includes('Senior Backend Engineer') || filt.includes('Marketing Manager'));
});

test('runScan source=aggregator — dédup via scan-history.tsv au second run', async () => {
  restore = installMockFetch({ [URL_A]: fixA, [URL_B]: fixB });
  const p = paths();
  fs.writeFileSync(p.applicationsPath, '# Apps\n');

  const r1 = await runScan({
    portalsConfig,
    profile: baseProfile,
    ...p,
    dryRun: false,
    source: 'aggregator',
  });
  assert.equal(r1.added.length, 2);

  // Reinstall mock for the second run (same fixtures, same URLs).
  restore();
  restore = installMockFetch({ [URL_A]: fixA, [URL_B]: fixB });

  const r2 = await runScan({
    portalsConfig,
    profile: baseProfile,
    ...p,
    dryRun: false,
    source: 'aggregator',
  });
  assert.equal(r2.added.length, 0);
  assert.ok(
    r2.filtered.skipped_dup >= 2,
    `expected ≥2 skipped_dup, got ${r2.filtered.skipped_dup}`
  );
});

test("runScan source=ats (default) — n'invoque pas l'aggregator", async () => {
  restore = installMockFetch({});
  const p = paths();
  fs.writeFileSync(p.applicationsPath, '# Apps\n');

  const result = await runScan({
    portalsConfig: { ...portalsConfig, tracked_companies: [] },
    profile: baseProfile,
    ...p,
    dryRun: false,
    source: 'ats',
  });

  assert.equal(result.added.length, 0);
  assert.equal(result.scanned, 0);
});

test('runScan source — invalide rejetée explicitement', async () => {
  const p = paths();
  fs.writeFileSync(p.applicationsPath, '# Apps\n');
  await assert.rejects(
    () =>
      runScan({
        portalsConfig,
        profile: baseProfile,
        ...p,
        source: 'bogus',
      }),
    /invalid source "bogus"/
  );
});
