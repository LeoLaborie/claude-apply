import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  mkdtempSync,
  rmSync,
  cpSync,
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

test('setup.sh: copies templates into config/ and does not touch real $HOME', () => {
  const work = mkdtempSync(join(tmpdir(), 'claude-apply-setup-'));
  const fakeHome = mkdtempSync(join(tmpdir(), 'claude-apply-home-'));
  try {
    cpSync(join(REPO_ROOT, 'scripts'), join(work, 'scripts'), { recursive: true });
    cpSync(join(REPO_ROOT, 'templates'), join(work, 'templates'), { recursive: true });
    mkdirSync(join(work, 'node_modules'), { recursive: true });
    writeFileSync(
      join(work, 'package.json'),
      JSON.stringify({ name: 'setup-test', version: '0.0.0', type: 'module' })
    );
    writeFileSync(join(fakeHome, '.bashrc'), '# original\n');

    execFileSync('bash', ['scripts/setup.sh'], {
      cwd: work,
      env: {
        ...process.env,
        HOME: fakeHome,
        PATH: process.env.PATH,
      },
      input: 'n\n',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    assert.ok(
      existsSync(join(work, 'config', 'candidate-profile.yml')),
      'config/candidate-profile.yml should be created'
    );
    assert.ok(existsSync(join(work, 'config', 'cv.md')));
    assert.ok(existsSync(join(work, 'config', 'portals.yml')));
    assert.ok(existsSync(join(work, 'data', 'applications.md')));

    const bashrc = readFileSync(join(fakeHome, '.bashrc'), 'utf8');
    assert.ok(bashrc.includes('alias chrome-apply='), 'bashrc should contain the alias');
    assert.ok(bashrc.includes('# original'), 'bashrc should keep original contents');
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  }
});
