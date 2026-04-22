import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '..', '..', 'src', 'scan', 'index.mjs');

for (const flag of ['--help', '-h']) {
  test(`/scan ${flag} exits 0 and prints usage — works without config`, () => {
    const res = spawnSync(process.execPath, [SCRIPT, flag], {
      env: {
        ...process.env,
        CLAUDE_APPLY_CONFIG_DIR: '/nonexistent/cfg',
        CLAUDE_APPLY_DATA_DIR: '/nonexistent/data',
      },
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, `stderr=${res.stderr} stdout=${res.stdout}`);
    assert.match(res.stdout, /^Usage: \/scan/m);
    assert.match(res.stdout, /--dry-run/);
    assert.match(res.stdout, /--only <slug>/);
    assert.match(res.stdout, /--json/);
    assert.match(res.stdout, /docs\/scan-workflow\.md/);
    assert.match(res.stdout, /See also:/);
  });
}
