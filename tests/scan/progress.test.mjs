import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { installMockFetch } from '../helpers.mjs';
import { runScan } from '../../src/scan/index.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-progress-'));

afterEach(() => {
  for (const f of fs.readdirSync(tmp)) {
    try {
      fs.unlinkSync(path.join(tmp, f));
    } catch {}
  }
});

test('onProgress is called once per company with correct shape', async () => {
  const leverJson = [
    {
      hostedUrl: 'https://jobs.lever.co/acme/job1',
      text: 'ML Intern',
      categories: { location: 'Paris' },
      descriptionPlain: 'Stage Paris France septembre 2026.',
    },
    {
      hostedUrl: 'https://jobs.lever.co/acme/job2',
      text: 'Senior Engineer',
      categories: { location: 'Paris' },
      descriptionPlain: 'Senior role.',
    },
  ];
  const ashbyJson = {
    jobs: [
      {
        jobUrl: 'https://jobs.ashbyhq.com/beta/job3',
        title: 'Data Intern',
        location: 'Paris',
        descriptionPlain: 'Stage Paris France septembre 2026.',
      },
    ],
  };

  const restore = installMockFetch({
    'https://api.lever.co/v0/postings/acme?mode=json': leverJson,
    'https://api.ashbyhq.com/posting-api/job-board/beta?includeCompensation=false': ashbyJson,
  });

  const portalsConfig = {
    title_filter: { positive: ['Intern', 'Stage'], negative: ['Senior'] },
    tracked_companies: [
      { name: 'Acme Corp', careers_url: 'https://jobs.lever.co/acme', enabled: true },
      { name: 'Beta Inc', careers_url: 'https://jobs.ashbyhq.com/beta', enabled: true },
    ],
  };
  const profile = {
    min_start_date: '2026-08-24',
    blacklist_companies: [],
    target_locations: ['Paris', 'France', 'Remote'],
  };

  const calls = [];
  const onProgress = (info) => calls.push(info);

  const applicationsPath = path.join(tmp, 'applications.md');
  fs.writeFileSync(applicationsPath, '# Apps\n');

  await runScan({
    portalsConfig,
    profile,
    pipelinePath: path.join(tmp, 'pipeline.md'),
    historyPath: path.join(tmp, 'scan-history.tsv'),
    filteredPath: path.join(tmp, 'filtered-out.tsv'),
    applicationsPath,
    dryRun: false,
    onProgress,
  });

  restore();

  assert.equal(calls.length, 2, `expected 2 onProgress calls, got ${calls.length}`);

  // First company: Acme Corp (lever) — 2 raw, 1 new (Senior filtered out)
  assert.equal(calls[0].index, 1);
  assert.equal(calls[0].total, 2);
  assert.equal(calls[0].company, 'Acme Corp');
  assert.equal(calls[0].platform, 'lever');
  assert.equal(calls[0].count, 2);
  assert.equal(calls[0].newCount, 1);
  assert.equal(calls[0].error, null);

  // Second company: Beta Inc (ashby) — 1 raw, 1 new
  assert.equal(calls[1].index, 2);
  assert.equal(calls[1].total, 2);
  assert.equal(calls[1].company, 'Beta Inc');
  assert.equal(calls[1].platform, 'ashby');
  assert.equal(calls[1].count, 1);
  assert.equal(calls[1].newCount, 1);
  assert.equal(calls[1].error, null);
});

test('onProgress reports errors for failing companies', async () => {
  const restore = installMockFetch({});

  const portalsConfig = {
    title_filter: { positive: [], negative: [] },
    tracked_companies: [
      { name: 'Broken Co', careers_url: 'https://jobs.lever.co/broken', enabled: true },
    ],
  };
  const profile = {
    min_start_date: '2026-08-24',
    blacklist_companies: [],
    target_locations: ['Paris', 'France', 'Remote'],
  };

  const calls = [];
  const onProgress = (info) => calls.push(info);

  const applicationsPath = path.join(tmp, 'applications.md');
  fs.writeFileSync(applicationsPath, '# Apps\n');

  await runScan({
    portalsConfig,
    profile,
    pipelinePath: path.join(tmp, 'pipeline.md'),
    historyPath: path.join(tmp, 'scan-history.tsv'),
    filteredPath: path.join(tmp, 'filtered-out.tsv'),
    applicationsPath,
    dryRun: true,
    onProgress,
  });

  restore();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].index, 1);
  assert.equal(calls[0].total, 1);
  assert.equal(calls[0].company, 'Broken Co');
  assert.equal(calls[0].count, 0);
  assert.ok(calls[0].error, 'expected a non-null error');
});

test('no onProgress callback does not throw', async () => {
  const restore = installMockFetch({
    'https://api.lever.co/v0/postings/quiet?mode=json': [],
  });

  const portalsConfig = {
    title_filter: { positive: [], negative: [] },
    tracked_companies: [
      { name: 'Quiet Co', careers_url: 'https://jobs.lever.co/quiet', enabled: true },
    ],
  };
  const profile = {
    min_start_date: '2026-08-24',
    blacklist_companies: [],
    target_locations: ['Paris', 'France', 'Remote'],
  };

  const applicationsPath = path.join(tmp, 'applications.md');
  fs.writeFileSync(applicationsPath, '# Apps\n');

  await runScan({
    portalsConfig,
    profile,
    pipelinePath: path.join(tmp, 'pipeline.md'),
    historyPath: path.join(tmp, 'scan-history.tsv'),
    filteredPath: path.join(tmp, 'filtered-out.tsv'),
    applicationsPath,
    dryRun: true,
  });

  restore();
});
