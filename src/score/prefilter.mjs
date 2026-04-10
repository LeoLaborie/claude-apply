#!/usr/bin/env node
// Usage: node src/score/prefilter.mjs <url> [--json-input path/to/offer.json]
// Reads profile.yml + portals.yml, fetches JD via Playwright if URL given,
// runs runPrefilter(), writes to data/filtered-out.tsv if rejected,
// prints {pass, reason?} to stdout.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPrefilter } from '../lib/prefilter-rules.mjs';
import { appendFilteredOut } from '../lib/jsonl-writer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function parseYaml(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const yaml = await import('js-yaml');
  return yaml.load(raw);
}

async function loadConfig() {
  const CONFIG_DIR =
    process.env.CLAUDE_APPLY_CONFIG_DIR || path.join(__dirname, '..', '..', 'config');
  const DATA_DIR =
    process.env.CLAUDE_APPLY_DATA_DIR || path.join(__dirname, '..', '..', 'data');
  const profilePath = path.join(CONFIG_DIR, 'profile.yml');
  const portalsPath = path.join(CONFIG_DIR, 'portals.yml');
  const profile = await parseYaml(profilePath);
  const portals = await parseYaml(portalsPath);
  return {
    minStartDate: profile.evaluation?.min_start_date || '2026-08-24',
    blacklist: profile.evaluation?.blacklist_companies || [],
    whitelist: portals.title_filter || { positive: [], negative: [] },
    dataDir: DATA_DIR,
  };
}

async function fetchOffer(url) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const title = await page.title();
    const body = await page.evaluate(() => document.body?.innerText || '');
    const company =
      (await page.evaluate(() => {
        const og = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content');
        if (og) return og;
        return document.querySelector('h1')?.innerText || '';
      })) || '';
    return { url, title, body, company };
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  let offer;
  if (args.includes('--json-input')) {
    const idx = args.indexOf('--json-input');
    const jsonPath = args[idx + 1];
    offer = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } else {
    const url = args[0];
    if (!url) {
      console.error('Usage: node src/score/prefilter.mjs <url> | --json-input <path>');
      process.exit(2);
    }
    offer = await fetchOffer(url);
  }

  const config = await loadConfig();
  const result = runPrefilter(offer, config);

  if (!result.pass) {
    const tsvPath = path.join(config.dataDir, 'filtered-out.tsv');
    appendFilteredOut(tsvPath, {
      date: new Date().toISOString().slice(0, 10),
      url: offer.url || '',
      company: offer.company || '',
      title: offer.title || '',
      reason: result.reason,
    });
  }

  console.log(JSON.stringify(result));
  process.exit(result.pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(3);
});
