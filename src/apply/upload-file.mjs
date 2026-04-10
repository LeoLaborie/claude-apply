#!/usr/bin/env node
/**
 * Upload a local file to an `<input type="file">` in a Chrome tab
 * via the Chrome DevTools Protocol using Playwright's `connectOverCDP`.
 *
 * Why: `input[type=file].value` can only be set to "" from page JS.
 * Page-side JS workarounds (fetch + DataTransfer) are blocked by CSP
 * and mixed-content policies on most HTTPS forms. CDP-level file
 * injection operates above the page sandbox and just works.
 *
 * Prereq: Chrome must be running with `--remote-debugging-port=9222`
 * (or a port passed via `cdpUrl`). The claude-in-chrome extension and
 * this script can share the same Chrome instance simultaneously.
 *
 * CLI:
 *   node upload-file.mjs --url <url-fragment> --selector '<css>' --file <abs-path> [--port 9222]
 *
 * Module:
 *   import { uploadFile } from './upload-file.mjs';
 *   await uploadFile({ pageMatcher, selector, filePath, cdpUrl });
 */

import { chromium } from 'playwright';
import { existsSync, statSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';

export class UploadError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function checkCdpUrl(cdpUrl) {
  try {
    const res = await fetch(`${cdpUrl}/json/version`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return await res.json();
  } catch (e) {
    throw new UploadError(
      'CDP_PORT_DOWN',
      `Chrome DevTools at ${cdpUrl} unreachable (${e.message}). ` +
        `Relaunch Chrome with: google-chrome --remote-debugging-port=9222`
    );
  }
}

/**
 * Upload a file to a file input in a Chrome tab via CDP.
 *
 * @param {object} opts
 * @param {string} opts.cdpUrl       - CDP endpoint, e.g. "http://localhost:9222"
 * @param {string|Function} opts.pageMatcher - URL substring or predicate (page) => bool
 * @param {string} opts.selector     - CSS selector for the file input
 * @param {string} opts.filePath     - Absolute path to the file to upload
 * @returns {{ success: boolean, filesCount: number, fileName: string, fileSize: number, path: string, pageUrl: string }}
 */
export async function uploadFile({
  cdpUrl = 'http://localhost:9222',
  pageMatcher,
  selector,
  filePath,
}) {
  if (!pageMatcher) throw new UploadError('BAD_ARGS', 'pageMatcher is required');
  if (!selector) throw new UploadError('BAD_ARGS', 'selector is required');
  if (!filePath) throw new UploadError('BAD_ARGS', 'filePath is required');

  const absPath = isAbsolute(filePath) ? filePath : resolve(filePath);
  if (!existsSync(absPath)) {
    throw new UploadError('FILE_NOT_FOUND', `File does not exist: ${absPath}`);
  }
  const fileStat = statSync(absPath);
  if (!fileStat.isFile()) {
    throw new UploadError('NOT_A_FILE', `Not a regular file: ${absPath}`);
  }

  await checkCdpUrl(cdpUrl);

  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const contexts = browser.contexts();
    let targetPage = null;

    const matchFn =
      typeof pageMatcher === 'function' ? pageMatcher : (page) => page.url().includes(pageMatcher);

    for (const ctx of contexts) {
      for (const p of ctx.pages()) {
        if (matchFn(p)) {
          targetPage = p;
          break;
        }
      }
      if (targetPage) break;
    }

    if (!targetPage) {
      const urls = contexts.flatMap((c) => c.pages().map((p) => p.url()));
      throw new UploadError(
        'TAB_NOT_FOUND',
        `No tab matches "${pageMatcher}". Open tabs:\n  - ${urls.join('\n  - ')}`
      );
    }

    const locator = targetPage.locator(selector).first();
    try {
      await locator.waitFor({ state: 'attached', timeout: 3000 });
    } catch {
      throw new UploadError('SELECTOR_NOT_FOUND', `Selector not found on page: ${selector}`);
    }

    await locator.setInputFiles(absPath);

    const verification = await locator.evaluate((el) => ({
      filesCount: el.files?.length || 0,
      fileName: el.files?.[0]?.name || null,
      fileSize: el.files?.[0]?.size || null,
    }));

    if (verification.filesCount !== 1) {
      throw new UploadError(
        'UPLOAD_VERIFY_FAILED',
        `Expected 1 file on input, got ${verification.filesCount}`
      );
    }

    return { success: true, ...verification, path: absPath, pageUrl: targetPage.url() };
  } finally {
    await browser.close();
  }
}

function parseArgs(argv) {
  const out = { cdpUrl: 'http://localhost:9222' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') out.pageMatcher = argv[++i];
    else if (a === '--selector') out.selector = argv[++i];
    else if (a === '--file') out.filePath = argv[++i];
    else if (a === '--port') out.cdpUrl = `http://localhost:${argv[++i]}`;
    else if (a === '--cdp-url') out.cdpUrl = argv[++i];
    else if (a === '-h' || a === '--help') out.help = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.pageMatcher || !args.selector || !args.filePath) {
    console.error(
      'Usage: node upload-file.mjs --url <url-fragment> --selector <css> --file <abs-path> [--port 9222]'
    );
    process.exit(args.help ? 0 : 2);
  }
  try {
    const result = await uploadFile(args);
    console.log(JSON.stringify(result));
    process.exit(0);
  } catch (e) {
    const payload = {
      ok: false,
      code: e.code || 'UNKNOWN_ERROR',
      error: e.message,
    };
    console.error(JSON.stringify(payload));
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
