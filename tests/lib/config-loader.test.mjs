import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MissingConfigError, requireConfig } from '../../src/lib/config-loader.mjs';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-loader-'));
}

test('requireConfig — throws MissingConfigError when file absent', () => {
  const dir = makeTmpDir();
  try {
    const absent = path.join(dir, 'nope.yml');
    assert.throws(
      () => requireConfig(absent),
      (err) => {
        assert.ok(err instanceof MissingConfigError);
        assert.equal(err.name, 'MissingConfigError');
        assert.equal(err.code, 'MISSING_CONFIG');
        assert.equal(err.path, absent);
        assert.match(err.message, /introuvable/);
        assert.match(err.message, /\/apply-onboard/);
        return true;
      }
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('requireConfig — does not throw when file exists', () => {
  const dir = makeTmpDir();
  try {
    const file = path.join(dir, 'ok.yml');
    fs.writeFileSync(file, 'a: 1\n', 'utf8');
    assert.doesNotThrow(() => requireConfig(file));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('MissingConfigError — message uses path relative to cwd when possible', () => {
  const dir = makeTmpDir();
  try {
    const absent = path.join(dir, 'deep', 'nope.yml');
    try {
      requireConfig(absent);
      assert.fail('expected throw');
    } catch (err) {
      assert.ok(err instanceof MissingConfigError);
      const rel = path.relative(process.cwd(), absent);
      assert.ok(
        err.message.startsWith(rel) || err.message.startsWith(absent),
        `message should start with a path reference, got: ${err.message}`
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
