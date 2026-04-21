import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '..', '..', 'src', 'dashboard', 'build.mjs');

for (const flag of ['--help', '-h']) {
  test(`/dashboard ${flag} exits 0 and prints usage — works without data`, () => {
    const res = spawnSync(process.execPath, [SCRIPT, flag], {
      env: {
        ...process.env,
        CLAUDE_APPLY_DATA_DIR: '/nonexistent/data',
        CLAUDE_APPLY_REPORTS_DIR: '/nonexistent/reports',
      },
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, `stderr=${res.stderr} stdout=${res.stdout}`);
    assert.match(res.stdout, /^Usage: \/dashboard/m);
    assert.match(res.stdout, /dashboard\.html/);
    assert.match(res.stdout, /See also:/);
  });
}
