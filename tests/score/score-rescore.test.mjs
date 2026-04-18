import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const scoreBin = path.join(repoRoot, 'src/score/index.mjs');

const PROFILE_YAML = `first_name: Alice
last_name: Martin
email: alice.martin@example.com
phone: '+33600000000'
linkedin_url: https://linkedin.com/in/alice
github_url: https://github.com/alice
city: Paris
country: France
school: Example School
degree: MEng
graduation_year: 2026
work_authorization: EU citizen
requires_sponsorship: false
availability_start: '2026-09-01'
internship_duration_months: 6
cv_path: cv.md
auto_apply_min_score: 7
`;

function mkTmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'score-rescore-'));
  fs.mkdirSync(path.join(d, 'config'), { recursive: true });
  fs.mkdirSync(path.join(d, 'data', 'tracker-additions'), { recursive: true });
  fs.writeFileSync(path.join(d, 'config', 'cv.md'), '# CV\nDummy CV content.\n');
  fs.writeFileSync(path.join(d, 'config', 'candidate-profile.yml'), PROFILE_YAML);
  fs.mkdirSync(path.join(d, '.git'), { recursive: true });
  return d;
}

function writeOfferJson(dir, offer) {
  const p = path.join(dir, 'offer.json');
  fs.writeFileSync(p, JSON.stringify(offer));
  return p;
}

function runScore(args, tmp, extraEnv = {}) {
  return spawnSync('node', [scoreBin, ...args], {
    env: {
      ...process.env,
      CLAUDE_APPLY_CONFIG_DIR: path.join(tmp, 'config'),
      CLAUDE_APPLY_DATA_DIR: path.join(tmp, 'data'),
      ...extraEnv,
    },
    encoding: 'utf8',
  });
}

test('--re-score: URL absente de evaluations.jsonl → exit 2', () => {
  const tmp = mkTmp();
  const evalPath = path.join(tmp, 'data', 'evaluations.jsonl');
  fs.writeFileSync(
    evalPath,
    JSON.stringify({ id: '001', url: 'https://other/1', score: 3.0 }) + '\n'
  );
  const offerPath = writeOfferJson(tmp, { url: 'https://missing/1', body: 'x' });

  const proc = runScore(['--json-input', offerPath, '--re-score'], tmp);

  assert.equal(proc.status, 2);
  assert.match(proc.stderr, /not found in .*evaluations\.jsonl/);
});

test("--re-score: URL présente → remplace la ligne, préserve l'id, supprime l'ancien TSV", () => {
  const tmp = mkTmp();
  const evalPath = path.join(tmp, 'data', 'evaluations.jsonl');
  const tsvDir = path.join(tmp, 'data', 'tracker-additions');

  fs.writeFileSync(
    evalPath,
    [
      JSON.stringify({
        id: '007',
        date: '2026-01-01',
        company: 'OldCo',
        role: 'Old Role',
        url: 'https://x/7',
        score: 2.0,
        verdict: 'skip',
        reason: 'old reason',
        status: 'Evaluated',
      }),
      JSON.stringify({ id: '008', url: 'https://x/8', score: 4.0 }),
    ].join('\n') + '\n'
  );
  fs.writeFileSync(path.join(tsvDir, '007-oldco.tsv'), 'old tsv\n');

  const offerPath = writeOfferJson(tmp, {
    url: 'https://x/7',
    finalUrl: 'https://x/7',
    status: 200,
    body:
      'Full JD text. We are looking for a senior engineer to join our team. ' +
      'The role involves building scalable systems, leading technical reviews, ' +
      'collaborating with product managers, and mentoring junior engineers. ' +
      'You will work on distributed systems, observability, and developer tools. ' +
      'We offer a competitive salary, remote-friendly culture, and great benefits. ' +
      'Required: 5+ years experience, strong CS fundamentals, cloud platforms. ' +
      'Nice to have: open-source contributions, public speaking, mentorship.',
    company: 'NewCo',
    title: 'Senior Engineer',
    location: 'Paris',
    metadata_source: 'json-input',
  });

  const proc = runScore(['--json-input', offerPath, '--re-score'], tmp, {
    CLAUDE_APPLY_STUB_SCORE: '4.5',
    CLAUDE_APPLY_STUB_REASON: 'much better fit now',
  });

  assert.equal(proc.status, 0, `stderr: ${proc.stderr}`);
  const lines = fs
    .readFileSync(evalPath, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  const updated = lines.find((l) => l.url === 'https://x/7');
  assert.equal(updated.id, '007');
  assert.equal(updated.score, 4.5);
  assert.equal(updated.reason, 'much better fit now');
  assert.equal(updated.company, 'NewCo');
  assert.equal(updated.role, 'Senior Engineer');
  assert.notEqual(updated.date, '2026-01-01');
  assert.equal(fs.existsSync(path.join(tsvDir, '007-oldco.tsv')), false);
  const newTsvs = fs.readdirSync(tsvDir).filter((f) => f.startsWith('007-'));
  assert.equal(newTsvs.length, 1);
  assert.match(newTsvs[0], /^007-newco\.tsv$/);
});

test("--re-score: page closed → entry inchangée, pas d'écriture filtered-out", () => {
  const tmp = mkTmp();
  const evalPath = path.join(tmp, 'data', 'evaluations.jsonl');
  const filteredPath = path.join(tmp, 'data', 'filtered-out.tsv');
  const tsvDir = path.join(tmp, 'data', 'tracker-additions');

  const original = {
    id: '011',
    date: '2026-01-01',
    company: 'C',
    role: 'R',
    url: 'https://x/11',
    score: 3.5,
    verdict: 'skip',
    reason: 'original',
    status: 'Evaluated',
  };
  fs.writeFileSync(evalPath, JSON.stringify(original) + '\n');
  fs.writeFileSync(path.join(tsvDir, '011-c.tsv'), 'original tsv\n');

  const offerPath = writeOfferJson(tmp, {
    url: 'https://x/11',
    finalUrl: 'https://x/11',
    status: 404,
    body: '',
  });

  const proc = runScore(['--json-input', offerPath, '--re-score'], tmp);

  assert.equal(proc.status, 0, `stderr: ${proc.stderr}`);
  assert.match(proc.stderr, /page closed.*keeping existing score/);
  const line = JSON.parse(fs.readFileSync(evalPath, 'utf8').trim());
  assert.deepEqual(line, original);
  assert.equal(fs.existsSync(filteredPath), false);
  assert.equal(fs.existsSync(path.join(tsvDir, '011-c.tsv')), true);
});

test('--re-score + --id NNN: --id ignoré, id existant préservé (warning stderr)', () => {
  const tmp = mkTmp();
  const evalPath = path.join(tmp, 'data', 'evaluations.jsonl');
  fs.writeFileSync(
    evalPath,
    JSON.stringify({
      id: '005',
      url: 'https://x/5',
      company: 'C',
      role: 'R',
      score: 3,
    }) + '\n'
  );
  const longBody = 'Full JD for role R at C. '.repeat(30);
  const offerPath = writeOfferJson(tmp, {
    url: 'https://x/5',
    status: 200,
    body: longBody,
    company: 'C',
    title: 'R',
  });

  const proc = runScore(['--json-input', offerPath, '--re-score', '--id', '999'], tmp, {
    CLAUDE_APPLY_STUB_SCORE: '3.5',
    CLAUDE_APPLY_STUB_REASON: 'ok',
  });

  assert.equal(proc.status, 0, `stderr: ${proc.stderr}`);
  assert.match(proc.stderr, /--id ignored.*preserving existing id 005/);
  const line = JSON.parse(fs.readFileSync(evalPath, 'utf8').trim());
  assert.equal(line.id, '005');
  assert.equal(line.score, 3.5);
});
