import test from 'node:test';
import assert from 'node:assert/strict';

import { simulate } from '../../src/scan/tune-filter.mjs';

const rows = [
  {
    url: 'u1',
    title: 'Software Engineer Intern',
    company: 'OpenAI',
    portal: 'lever',
    first_seen: '2026-04-19',
  },
  {
    url: 'u2',
    title: 'ML Engineer Intern',
    company: 'Anthropic',
    portal: 'greenhouse',
    first_seen: '2026-04-19',
  },
  {
    url: 'u3',
    title: 'Senior Backend Engineer',
    company: 'Stripe',
    portal: 'greenhouse',
    first_seen: '2026-04-19',
  },
  {
    url: 'u4',
    title: 'Applied Scientist Intern - ML',
    company: 'DeepMind',
    portal: 'greenhouse',
    first_seen: '2026-04-19',
  },
  {
    url: 'u5',
    title: 'Research Engineer Intern',
    company: 'BlacklistedCorp',
    portal: 'lever',
    first_seen: '2026-04-19',
  },
];

test('simulate returns totals and ratio', () => {
  const res = simulate(
    { positive: ['Intern'], negative: [], required_any: [], blacklist: [] },
    rows
  );
  assert.equal(res.total, 5);
  assert.equal(res.accepted, 4);
  assert.equal(res.ratio, 4 / 5);
});

test('simulate buckets rejections by reason', () => {
  const res = simulate(
    { positive: ['Intern'], negative: [], required_any: [], blacklist: ['blacklistedcorp'] },
    rows
  );
  const reasons = [...res.rejectedByReason.keys()].sort();
  assert.ok(reasons.some((r) => r.startsWith('title:')));
  assert.ok(reasons.some((r) => r.startsWith('blacklist:')));
});

test('simulate caps sampleRejected at 10 per reason', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({
    url: `u${i}`,
    title: `Offer ${i}`,
    company: 'X',
    portal: 'lever',
    first_seen: '2026-04-19',
  }));
  const res = simulate(
    { positive: ['Intern'], negative: [], required_any: [], blacklist: [] },
    many
  );
  for (const sample of res.sampleRejected.values()) {
    assert.ok(sample.length <= 10);
  }
});

test('simulate byCompany ranks top 20 by accepted desc', () => {
  const many = [
    ...Array.from({ length: 3 }, (_, i) => ({
      url: `a${i}`,
      title: 'Intern',
      company: 'Alpha',
      portal: 'lever',
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      url: `b${i}`,
      title: 'Intern',
      company: 'Beta',
      portal: 'lever',
    })),
    ...Array.from({ length: 1 }, (_, i) => ({
      url: `c${i}`,
      title: 'Staff Engineer',
      company: 'Gamma',
      portal: 'lever',
    })),
  ];
  const res = simulate(
    { positive: ['Intern'], negative: [], required_any: [], blacklist: [] },
    many
  );
  assert.equal(res.byCompany[0].company, 'Beta');
  assert.equal(res.byCompany[0].accepted, 5);
  assert.equal(res.byCompany[1].company, 'Alpha');
});

test('simulate handles empty rows', () => {
  const res = simulate({ positive: [], negative: [], required_any: [], blacklist: [] }, []);
  assert.equal(res.total, 0);
  assert.equal(res.accepted, 0);
  assert.equal(res.ratio, 0);
});

test('simulate honours per-company skip_required_any', () => {
  const filter = { positive: ['Intern'], negative: [], required_any: ['ML'], blacklist: [] };
  const rowsSkip = [
    { url: 's1', title: 'Research Intern', company: 'Mistral AI', portal: 'lever' },
  ];
  const withOverride = simulate(filter, rowsSkip, {
    companies: [{ name: 'Mistral AI', skip_required_any: true }],
  });
  const withoutOverride = simulate(filter, rowsSkip);
  assert.equal(withOverride.accepted, 1);
  assert.equal(withoutOverride.accepted, 0);
});

test('simulate sampleRejected uses normalized company and portal', () => {
  const res = simulate({ positive: ['Intern'], negative: [], required_any: [], blacklist: [] }, [
    { url: 'u', title: 'Senior Engineer', company: '', portal: undefined },
  ]);
  const [sample] = res.sampleRejected.values().next().value;
  assert.equal(sample.company, '(unknown)');
  assert.equal(sample.portal, '(unknown)');
});

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, '..', '..', 'src', 'scan', 'tune-filter.mjs');
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'scan-history-sample.tsv');

function runCli(input, args) {
  return new Promise((resolve, reject) => {
    const p = spawn('node', [CLI, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (c) => (out += c.toString()));
    p.stderr.on('data', (c) => (err += c.toString()));
    p.on('error', reject);
    p.on('exit', (code) => resolve({ code, out, err }));
    p.stdin.write(input);
    p.stdin.end();
  });
}

test('CLI reads filter JSON on stdin, emits stats JSON on stdout', async () => {
  const filter = { positive: ['Intern'], negative: [], required_any: ['ML'], blacklist: [] };
  const { code, out } = await runCli(JSON.stringify(filter), ['--history', FIXTURE]);
  assert.equal(code, 0);
  const parsed = JSON.parse(out);
  assert.equal(parsed.total, 3);
  assert.equal(parsed.accepted, 1);
  assert.ok(Array.isArray(parsed.rejectedByReason));
  assert.ok(Array.isArray(parsed.sampleRejected));
  assert.ok(Array.isArray(parsed.byCompany));
});

test('CLI errors with exit code 2 when history missing', async () => {
  const { code, err } = await runCli('{}', ['--history', '/nonexistent']);
  assert.equal(code, 2);
  assert.match(err, /scan-history/);
});
