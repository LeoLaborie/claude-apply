import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../scripts/check-no-pii.sh', import.meta.url).pathname;

function runCheck(cwd) {
  try {
    const out = execSync(`bash ${SCRIPT}`, { cwd, encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, out };
  } catch (e) {
    return {
      code: e.status,
      out: (e.stdout?.toString() || '') + (e.stderr?.toString() || ''),
    };
  }
}

function initGitRepo(dir) {
  execSync('git init -q && git add -A && git -c user.email=t@t.t -c user.name=t commit -qm init', {
    cwd: dir,
  });
}

test('check-no-pii passes on clean tree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pii-ok-'));
  try {
    writeFileSync(join(dir, 'README.md'), '# hello world\nnothing sensitive here');
    writeFileSync(join(dir, '.pii-blocklist'), '# empty blocklist\n');
    initGitRepo(dir);
    const { code } = runCheck(dir);
    assert.equal(code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check-no-pii fails on leo.laborie leak', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pii-leak-'));
  try {
    writeFileSync(join(dir, 'bad.md'), 'contact: leo.laborie.ll@example.com');
    writeFileSync(join(dir, '.pii-blocklist'), '# empty\n');
    initGitRepo(dir);
    const { code, out } = runCheck(dir);
    assert.notEqual(code, 0);
    assert.match(out, /leo/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check-no-pii fails on phone number leak', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pii-phone-'));
  try {
    writeFileSync(join(dir, 'bad.md'), 'tel: 06 49 71 45 17');
    writeFileSync(join(dir, '.pii-blocklist'), '# empty\n');
    initGitRepo(dir);
    const { code } = runCheck(dir);
    assert.notEqual(code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check-no-pii fails on blocklisted company', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pii-co-'));
  try {
    writeFileSync(join(dir, '.pii-blocklist'), 'secret-co\n');
    writeFileSync(join(dir, 'apps.md'), 'I applied to secret-co yesterday');
    initGitRepo(dir);
    const { code, out } = runCheck(dir);
    assert.notEqual(code, 0);
    assert.match(out, /secret-co/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check-no-pii ignores commented lines in blocklist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pii-comment-'));
  try {
    writeFileSync(join(dir, '.pii-blocklist'), '# this is a comment\n# another comment\n');
    writeFileSync(join(dir, 'apps.md'), 'mentioning hash # in text is fine');
    initGitRepo(dir);
    const { code } = runCheck(dir);
    assert.equal(code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
