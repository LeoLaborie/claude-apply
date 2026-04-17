import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

test('score CLI — missing candidate-profile.yml exits 2 with clean message', () => {
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'score-cfg-'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'score-data-'));
  const offerFile = path.join(os.tmpdir(), 'score-offer-test.json');

  // Minimal offer JSON that passes detectClosedPage (no status, no error title)
  fs.writeFileSync(
    offerFile,
    JSON.stringify({
      url: 'https://example.com/job/senior-engineer',
      finalUrl: 'https://example.com/job/senior-engineer',
      title: 'Senior Engineer',
      body: 'We are looking for a senior engineer to join our growing team. You will work on exciting projects and collaborate with talented colleagues across the globe. Requirements include 5 or more years of experience, proficiency in JavaScript and Node.js, strong communication skills, experience with distributed systems, and a passion for building reliable software systems at scale. We offer competitive salary, fully remote work options, and a comprehensive benefits package including health insurance.',
      company: 'Example Corp',
      location: 'Remote',
      metadata_source: 'json-input',
    })
  );

  // Provide cv.md so the cv guard passes; omit candidate-profile.yml to trigger the profile guard
  fs.writeFileSync(path.join(cfgDir, 'cv.md'), '# CV\n\nAlice Martin — software engineer.\n');

  try {
    const res = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, 'src', 'score', 'index.mjs'), '--json-input', offerFile],
      {
        env: {
          ...process.env,
          CLAUDE_APPLY_CONFIG_DIR: cfgDir,
          CLAUDE_APPLY_DATA_DIR: dataDir,
        },
        encoding: 'utf8',
      }
    );

    assert.equal(
      res.status,
      2,
      `expected exit 2 when profile missing, got ${res.status}\nstderr: ${res.stderr}`
    );
    assert.match(res.stderr, /candidate-profile\.yml/, 'stderr mentions candidate-profile.yml');
    assert.match(res.stderr, /\/apply-onboard/, 'stderr mentions /apply-onboard');
    assert.doesNotMatch(
      res.stderr,
      /\bat async\b|\bat Object\./,
      'stderr must not contain a stack trace'
    );
  } finally {
    fs.rmSync(cfgDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(offerFile, { force: true });
  }
});
