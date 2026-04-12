import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { installMockFetch } from '../helpers.mjs';
import { runScan } from '../../src/scan/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-'));

afterEach(() => {
  for (const f of fs.readdirSync(tmp)) {
    try {
      fs.unlinkSync(path.join(tmp, f));
    } catch {}
  }
});

test('runScan — e2e avec 2 companies mockées, écrit pipeline + history', async () => {
  const portalsConfig = {
    title_filter: {
      positive: ['Intern', 'Stage'],
      negative: ['Senior'],
    },
    tracked_companies: [
      { name: 'Mistral AI', careers_url: 'https://jobs.lever.co/mistral', enabled: true },
      { name: 'Photoroom', careers_url: 'https://jobs.ashbyhq.com/photoroom', enabled: true },
    ],
  };
  const profile = {
    min_start_date: '2026-08-24',
    blacklist_companies: [],
    target_locations: ['France', 'Paris', 'Remote'],
  };

  const leverJson = [
    {
      hostedUrl: 'https://jobs.lever.co/mistral/job1',
      text: 'Research Intern',
      categories: { location: 'Paris' },
      descriptionPlain: 'Stage de 6 mois à Paris, France, starting September 2026.',
    },
    {
      hostedUrl: 'https://jobs.lever.co/mistral/job2',
      text: 'Senior Engineer',
      categories: { location: 'Paris' },
      descriptionPlain: 'Senior role Paris France.',
    },
  ];
  const ashbyJson = {
    jobs: [
      {
        jobUrl: 'https://jobs.ashbyhq.com/photoroom/job3',
        title: 'ML Engineer Intern',
        location: 'Paris, France',
        descriptionPlain: 'Stage Paris France septembre 2026.',
      },
    ],
  };

  const restore = installMockFetch({
    'https://api.lever.co/v0/postings/mistral?mode=json': leverJson,
    'https://api.ashbyhq.com/posting-api/job-board/photoroom?includeCompensation=false': ashbyJson,
  });

  const pipelinePath = path.join(tmp, 'pipeline.md');
  const historyPath = path.join(tmp, 'scan-history.tsv');
  const filteredPath = path.join(tmp, 'filtered-out.tsv');
  const applicationsPath = path.join(tmp, 'applications.md');
  fs.writeFileSync(applicationsPath, '# Apps\n');

  const result = await runScan({
    portalsConfig,
    profile,
    pipelinePath,
    historyPath,
    filteredPath,
    applicationsPath,
    dryRun: false,
  });

  restore();

  // 2 lever offers + 1 ashby = 3 raw
  assert.equal(result.raw, 3);
  // 2 passed filters: Mistral "Research Intern" + Photoroom "ML Engineer Intern"
  assert.equal(result.added.length, 2);
  // 1 rejected by title (Senior Engineer)
  assert.equal(result.filtered.skipped_title, 1);

  // pipeline.md should contain the 2 added offers
  const md = fs.readFileSync(pipelinePath, 'utf8');
  assert.ok(md.includes('Research Intern'));
  assert.ok(md.includes('ML Engineer Intern'));
  assert.equal(md.includes('Senior Engineer'), false);

  // scan-history.tsv should have 3 rows + header
  const hist = fs.readFileSync(historyPath, 'utf8').trim().split('\n');
  assert.equal(hist.length, 4);

  // filtered-out.tsv should have the Senior Engineer row
  const filt = fs.readFileSync(filteredPath, 'utf8');
  assert.ok(filt.includes('Senior Engineer'));
});

test('runScan — Workday end-to-end (URL nue + URL avec locale)', async () => {
  // Reuse the existing terminating-page fixture so we don't need pagination mocks.
  const fxPath = path.join(REPO_ROOT, 'tests', 'fixtures', 'workday-totalenergies-page2.json');
  const workdayBody = JSON.parse(fs.readFileSync(fxPath, 'utf8'));

  const portalsConfig = {
    title_filter: { positive: ['Engineer', 'Ingénieur'], negative: [] },
    tracked_companies: [
      {
        name: 'TotalEnergies (bare)',
        careers_url: 'https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers',
        enabled: true,
      },
      {
        name: 'TotalEnergies (locale)',
        careers_url: 'https://totalenergies.wd3.myworkdayjobs.com/en-US/TotalEnergies_careers',
        enabled: true,
      },
    ],
  };
  const profile = {
    min_start_date: '2020-01-01',
    blacklist_companies: [],
    target_locations: ['France', 'Paris', 'Remote'],
  };

  // Both companies hit the same Workday API endpoint (locale is stripped
  // by parseWorkdayUrl). The fixture is a short page so fetchWorkday's
  // pagination loop terminates after a single call per company.
  const workdayEndpoint =
    'https://totalenergies.wd3.myworkdayjobs.com/wday/cxs/totalenergies/TotalEnergies_careers/jobs';
  const restore = installMockFetch({ [workdayEndpoint]: workdayBody });

  const pipelinePath = path.join(tmp, 'pipeline.md');
  const historyPath = path.join(tmp, 'scan-history.tsv');
  const filteredPath = path.join(tmp, 'filtered-out.tsv');
  const applicationsPath = path.join(tmp, 'applications.md');
  fs.writeFileSync(applicationsPath, '# Apps\n');

  const result = await runScan({
    portalsConfig,
    profile,
    pipelinePath,
    historyPath,
    filteredPath,
    applicationsPath,
    dryRun: false,
  });

  restore();

  // 2 companies × 1 job each (fixture has 1 jobPosting)
  assert.equal(
    result.raw,
    2 * 1,
    `expected raw = 2 (two companies × 1 job each), got ${result.raw}`
  );

  const errs = (result.errors || []).filter((e) =>
    String(e.company || '').startsWith('TotalEnergies')
  );
  assert.equal(errs.length, 0, `expected no Workday errors, got: ${JSON.stringify(errs)}`);

  // pipeline.md should mention TotalEnergies (proves offers were written).
  const md = fs.readFileSync(pipelinePath, 'utf8');
  assert.ok(
    md.includes('TotalEnergies'),
    'expected pipeline.md to contain at least one TotalEnergies offer'
  );
});

test('scan CLI — missing candidate-profile.yml fails with ProfileMissingError', () => {
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-cfg-'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-data-'));
  try {
    fs.writeFileSync(
      path.join(cfgDir, 'portals.yml'),
      'tracked_companies: []\ntitle_filter:\n  positive: []\n  negative: []\n',
      'utf8'
    );

    const res = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, 'src', 'scan', 'index.mjs'), '--dry-run', '--json'],
      {
        env: {
          ...process.env,
          CLAUDE_APPLY_CONFIG_DIR: cfgDir,
          CLAUDE_APPLY_DATA_DIR: dataDir,
        },
        encoding: 'utf8',
      }
    );

    assert.notEqual(res.status, 0, 'expected non-zero exit when profile missing');
    assert.match(
      res.stderr,
      /candidate-profile\.yml/,
      `expected stderr to mention candidate-profile.yml, got: ${res.stderr}`
    );
    assert.match(res.stderr, /\/onboard/, `expected stderr to mention /onboard`);
  } finally {
    fs.rmSync(cfgDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
