import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../../src/scan/discover-company.mjs';

let tmpDir;
afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  tmpDir = null;
});

function mkTmp() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-batch-'));
  return tmpDir;
}

function captureWrites() {
  const writes = [];
  return { writes, _write: (s) => writes.push(s) };
}

function fakeVerifiers({ hits = {} } = {}) {
  const make = (platform) => async (slug) => {
    const key = `${platform}:${slug}`;
    if (hits[key]) return { ok: true, count: hits[key] };
    return { ok: false, status: 404, reason: 'not found' };
  };
  return {
    lever: make('lever'),
    greenhouse: make('greenhouse'),
    ashby: make('ashby'),
    workable: make('workable'),
  };
}

test('main --batch emits one JSONL line per name, in input order', async () => {
  const dir = mkTmp();
  const namesFile = path.join(dir, 'names.txt');
  fs.writeFileSync(namesFile, 'Foo\nBar\nBaz\n');

  const verifiers = fakeVerifiers({ hits: { 'lever:bar': 5 } });
  const { writes, _write } = captureWrites();

  process.env.DISCOVER_DELAY_MS = '0';
  const code = await main({
    argv: ['node', 'discover-company.mjs', '--batch', namesFile],
    verifiers,
    _write,
  });
  delete process.env.DISCOVER_DELAY_MS;

  assert.equal(code, 0);
  assert.equal(writes.length, 3, `expected 3 lines, got ${writes.length}`);

  const records = writes.map((l) => JSON.parse(l));
  assert.deepEqual(
    records.map((r) => r.name),
    ['Foo', 'Bar', 'Baz']
  );
  assert.equal(records[0].result.ok, false);
  assert.equal(records[1].result.ok, true);
  assert.equal(records[1].result.platform, 'lever');
  assert.equal(records[1].result.slug, 'bar');
  assert.equal(records[2].result.ok, false);
});

test('main --batch skips empty lines and # comments', async () => {
  const dir = mkTmp();
  const namesFile = path.join(dir, 'names.txt');
  fs.writeFileSync(namesFile, '# header\n\nFoo\n   \n# mid\nBar\n');

  const { writes, _write } = captureWrites();
  process.env.DISCOVER_DELAY_MS = '0';
  const code = await main({
    argv: ['node', 'discover-company.mjs', '--batch', namesFile],
    verifiers: fakeVerifiers(),
    _write,
  });
  delete process.env.DISCOVER_DELAY_MS;

  assert.equal(code, 0);
  assert.equal(writes.length, 2);
  assert.equal(JSON.parse(writes[0]).name, 'Foo');
  assert.equal(JSON.parse(writes[1]).name, 'Bar');
});

test('main --batch + positional name returns exit 1', async () => {
  const dir = mkTmp();
  const namesFile = path.join(dir, 'names.txt');
  fs.writeFileSync(namesFile, 'Foo\n');

  const { _write } = captureWrites();
  const stderrCaptured = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => {
    stderrCaptured.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    return true;
  };

  let code;
  try {
    code = await main({
      argv: ['node', 'discover-company.mjs', 'Acme', '--batch', namesFile],
      verifiers: fakeVerifiers(),
      _write,
    });
  } finally {
    process.stderr.write = origWrite;
  }

  assert.equal(code, 1);
  assert.match(stderrCaptured.join(''), /--batch/);
});

test('main --batch with missing file returns exit 1', async () => {
  const { _write } = captureWrites();
  const stderrCaptured = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => {
    stderrCaptured.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    return true;
  };

  let code;
  try {
    code = await main({
      argv: ['node', 'discover-company.mjs', '--batch', '/nonexistent/path/names.txt'],
      verifiers: fakeVerifiers(),
      _write,
    });
  } finally {
    process.stderr.write = origWrite;
  }

  assert.equal(code, 1);
  assert.match(stderrCaptured.join(''), /batch/);
});

test('main --batch with empty file returns exit 0 and writes nothing', async () => {
  const dir = mkTmp();
  const namesFile = path.join(dir, 'empty.txt');
  fs.writeFileSync(namesFile, '');

  const { writes, _write } = captureWrites();
  const code = await main({
    argv: ['node', 'discover-company.mjs', '--batch', namesFile],
    verifiers: fakeVerifiers(),
    _write,
  });

  assert.equal(code, 0);
  assert.equal(writes.length, 0);
});
