import { test, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { classifyField } from '../../src/apply/field-classifier.mjs';
import { classifyConfirmation } from '../../src/apply/confirmation-detector.mjs';
import { uploadFile } from '../../src/apply/upload-file.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures');
const APPLY_FIXTURES_DIR = join(FIXTURES_DIR, 'apply');
const CV_PATH = join(FIXTURES_DIR, 'fake-cv.pdf');
const HTTP_PORT = 8766;
const CDP_PORT = 9224;

let server, browser;

before(async () => {
  server = createServer((req, res) => {
    const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const filePath = join(APPLY_FIXTURES_DIR, urlPath);
    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const ext = filePath.split('.').pop();
    const mime = ext === 'html' ? 'text/html' : ext === 'pdf' ? 'application/pdf' : 'text/plain';
    res.writeHead(200, { 'content-type': mime });
    res.end(readFileSync(filePath));
  });
  await new Promise((resolve) => server.listen(HTTP_PORT, resolve));

  browser = await chromium.launch({
    headless: true,
    args: [`--remote-debugging-port=${CDP_PORT}`],
  });

  for (let i = 0; i < 20; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
});

after(async () => {
  await browser?.close();
  server?.close();
});

async function extractFields(page) {
  return await page.evaluate(() => {
    const labelMap = new Map();
    for (const l of document.querySelectorAll('label[for]')) {
      labelMap.set(l.getAttribute('for'), l.textContent.trim());
    }
    const out = [];
    for (const el of document.querySelectorAll('input, textarea, select')) {
      const id = el.id || '';
      let label = labelMap.get(id) || '';
      if (!label && el.closest('label')) label = el.closest('label').textContent.trim();
      out.push({
        name: el.getAttribute('name') || '',
        id,
        label,
        type:
          el.tagName === 'TEXTAREA'
            ? 'textarea'
            : el.tagName === 'SELECT'
            ? 'select'
            : el.getAttribute('type') || 'text',
        required: el.hasAttribute('required'),
      });
    }
    return out;
  });
}

const CASES = [
  { ats: 'lever', fixture: 'lever-form.html', expected: ['full_name', 'email', 'cv_upload'] },
  {
    ats: 'greenhouse',
    fixture: 'greenhouse-form.html',
    expected: ['first_name', 'last_name', 'email', 'cv_upload'],
  },
  { ats: 'ashby', fixture: 'ashby-form.html', expected: ['full_name', 'email', 'cv_upload'] },
  { ats: 'wttj', fixture: 'wttj-form.html', expected: ['first_name', 'last_name', 'email', 'cv_upload'] },
];

for (const { ats, fixture, expected } of CASES) {
  test(`${ats}: end-to-end apply flow (classify → upload → submit → confirm)`, async () => {
    const page = await browser.newPage();
    const url = `http://localhost:${HTTP_PORT}/${fixture}`;
    await page.goto(url);

    // 1. Classify fields from live DOM
    const fields = await extractFields(page);
    const classes = new Set(fields.map(classifyField));
    for (const key of expected) {
      assert.ok(classes.has(key), `${ats}: missing ${key}, got [${[...classes].join(',')}]`);
    }

    // 2. Upload CV via CDP helper
    const fileSelector = await page.evaluate(() => {
      const f = document.querySelector('input[type="file"]');
      return f ? '#' + f.id : null;
    });
    assert.ok(fileSelector, `${ats}: no file input found`);
    const upload = await uploadFile({
      cdpUrl: `http://localhost:${CDP_PORT}`,
      pageMatcher: fixture,
      selector: fileSelector,
      filePath: CV_PATH,
    });
    assert.ok(upload.success);
    assert.equal(upload.fileName, 'fake-cv.pdf');

    // 3. Fill required text fields + tick consent
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('input[required], input:not([type]):not([type=file]):not([type=checkbox])')) {
        if (el.type === 'file' || el.type === 'checkbox') continue;
        if (!el.value) {
          el.value =
            el.type === 'email'
              ? 'alice@example.com'
              : el.type === 'tel'
              ? '+33600000000'
              : el.type === 'url'
              ? 'https://example.com'
              : 'Alice';
        }
      }
      for (const cb of document.querySelectorAll('input[type=checkbox]')) cb.checked = true;
    });

    // 4. Submit and wait for DOM swap
    const beforeUrl = page.url();
    await page.evaluate(() => document.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true })));
    await page.waitForSelector('h1', { timeout: 2000 });

    // 5. Detect confirmation
    const pageText = await page.evaluate(() => document.body.innerText);
    const afterUrl = page.url();
    const result = classifyConfirmation({ beforeUrl, afterUrl, pageText });
    assert.equal(result.status, 'Applied', `${ats}: expected Applied, got ${result.status} (${result.reason})`);

    await page.close();
  });
}
