import { test, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { uploadFile, UploadError } from '../../src/apply/upload-file.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures');
const CDP_PORT = 9223;
const HTTP_PORT = 8765;
const CV_PATH = join(FIXTURES_DIR, 'fake-cv.pdf');

let server, browser, tmpDir;

before(async () => {
  // 1. Static HTTP server serving tests/fixtures/
  server = createServer((req, res) => {
    const urlPath = req.url === '/' ? '/index.html' : req.url;
    const filePath = join(FIXTURES_DIR, urlPath);
    if (!existsSync(filePath)) {
      res.writeHead(404); res.end('not found'); return;
    }
    const ext = filePath.split('.').pop();
    const mime = ext === 'html' ? 'text/html' : ext === 'pdf' ? 'application/pdf' : 'text/plain';
    res.writeHead(200, { 'content-type': mime });
    res.end(readFileSync(filePath));
  });
  await new Promise((resolve) => server.listen(HTTP_PORT, resolve));

  // 2. Headless Chromium with CDP exposed on CDP_PORT
  browser = await chromium.launch({
    headless: true,
    args: [`--remote-debugging-port=${CDP_PORT}`],
  });

  // Wait for CDP to be ready
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (res.ok) break;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }

  // Open the fixture page so there's a tab for uploadFile to find
  const page = await browser.newPage();
  await page.goto(`http://localhost:${HTTP_PORT}/upload-form.html`);
  await page.waitForSelector('#cv');

  // Temp dir for edge-case fixtures
  tmpDir = mkdtempSync(join(tmpdir(), 'apply-upload-'));
});

after(async () => {
  await browser?.close();
  server?.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

test('uploadFile: fake-cv.pdf fixture must exist and be a real PDF', () => {
  assert.ok(existsSync(CV_PATH), 'tests/fixtures/fake-cv.pdf must exist');
  const bytes = readFileSync(CV_PATH);
  assert.ok(bytes.length >= 100, `PDF too small: ${bytes.length} bytes`);
  assert.ok(bytes.slice(0, 4).toString() === '%PDF', 'File does not start with %PDF');
});

test('uploadFile: happy path sets the file on matching input', async () => {
  const result = await uploadFile({
    cdpUrl: `http://localhost:${CDP_PORT}`,
    pageMatcher: 'upload-form',
    selector: '#cv',
    filePath: CV_PATH,
  });
  assert.ok(result.success, 'uploadFile should succeed');
  assert.equal(result.filesCount, 1);
  assert.equal(result.fileName, 'fake-cv.pdf');
  assert.ok(result.fileSize > 0);
  assert.ok(result.pageUrl.includes('upload-form'));
});

test('uploadFile: file input is actually populated in the page after upload', async () => {
  await uploadFile({
    cdpUrl: `http://localhost:${CDP_PORT}`,
    pageMatcher: 'upload-form',
    selector: '#cv',
    filePath: CV_PATH,
  });

  // Verify by re-connecting to the page and reading the DOM
  const connected = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
  try {
    const contexts = connected.contexts();
    let targetPage = null;
    for (const ctx of contexts) {
      for (const p of ctx.pages()) {
        if (p.url().includes('upload-form')) { targetPage = p; break; }
      }
      if (targetPage) break;
    }
    assert.ok(targetPage, 'Should find the fixture page');
    const fileName = await targetPage.evaluate(() => {
      const input = document.getElementById('cv');
      return input.files && input.files[0] ? input.files[0].name : null;
    });
    assert.equal(fileName, 'fake-cv.pdf', 'DOM should reflect uploaded file');
  } finally {
    await connected.close();
  }
});

test('uploadFile: pageMatcher as a function works', async () => {
  const result = await uploadFile({
    cdpUrl: `http://localhost:${CDP_PORT}`,
    pageMatcher: (page) => page.url().includes('upload-form'),
    selector: '#cv',
    filePath: CV_PATH,
  });
  assert.ok(result.success);
  assert.equal(result.filesCount, 1);
});

test('uploadFile: throws FILE_NOT_FOUND for missing file', async () => {
  await assert.rejects(
    uploadFile({
      cdpUrl: `http://localhost:${CDP_PORT}`,
      pageMatcher: 'upload-form',
      selector: '#cv',
      filePath: '/nonexistent/path/cv.pdf',
    }),
    (e) => e instanceof UploadError && e.code === 'FILE_NOT_FOUND',
  );
});

test('uploadFile: throws TAB_NOT_FOUND for unmatched URL', async () => {
  await assert.rejects(
    uploadFile({
      cdpUrl: `http://localhost:${CDP_PORT}`,
      pageMatcher: 'zzz-no-such-url-xyz',
      selector: '#cv',
      filePath: CV_PATH,
    }),
    (e) => e instanceof UploadError && e.code === 'TAB_NOT_FOUND',
  );
});

test('uploadFile: throws SELECTOR_NOT_FOUND for bad selector', async () => {
  await assert.rejects(
    uploadFile({
      cdpUrl: `http://localhost:${CDP_PORT}`,
      pageMatcher: 'upload-form',
      selector: '#no-such-input-xyz',
      filePath: CV_PATH,
    }),
    (e) => e instanceof UploadError && e.code === 'SELECTOR_NOT_FOUND',
  );
});

test('uploadFile: throws CDP_PORT_DOWN when port unreachable', async () => {
  await assert.rejects(
    uploadFile({
      cdpUrl: 'http://localhost:59998',
      pageMatcher: 'upload-form',
      selector: '#cv',
      filePath: CV_PATH,
    }),
    (e) => e instanceof UploadError && e.code === 'CDP_PORT_DOWN',
  );
});

test('uploadFile: throws BAD_ARGS when pageMatcher is missing', async () => {
  await assert.rejects(
    uploadFile({ selector: '#cv', filePath: CV_PATH }),
    (e) => e instanceof UploadError && e.code === 'BAD_ARGS',
  );
});
