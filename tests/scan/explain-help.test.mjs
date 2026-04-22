import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '..', '..', 'src', 'scan', 'explain.mjs');

for (const flag of ['--help', '-h']) {
  test(`/explain ${flag} exits 0 and prints usage — works without config`, () => {
    const res = spawnSync(process.execPath, [SCRIPT, flag], {
      env: {
        ...process.env,
        CLAUDE_APPLY_CONFIG_DIR: '/nonexistent/cfg',
      },
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, `stderr=${res.stderr} stdout=${res.stdout}`);
    assert.match(res.stdout, /^Usage: \/explain/m);
    assert.match(res.stdout, /--company <name>/);
    assert.match(res.stdout, /--location <loc>/);
    assert.match(res.stdout, /Exit codes/);
    assert.match(res.stdout, /title-filter/);
  });
}
