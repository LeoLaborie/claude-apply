#!/usr/bin/env node
// Usage: node src/score/index.mjs <url> [--json-input path/to/offer.json] [--id NNN]
// Builds prompt, calls `claude -p` CLI, parses JSON response,
// appends to data/evaluations.jsonl + data/tracker-additions/<id>-<slug>.tsv.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPrompt } from './prompt-builder.mjs';
import { appendJsonl, appendFilteredOut } from '../lib/jsonl-writer.mjs';
import { writeTrackerTsv } from '../lib/tsv-writer.mjs';
import { detectClosedPage } from '../lib/page-liveness.mjs';
import { runPrefilter } from '../lib/prefilter-rules.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function parseYaml(filePath) {
  const yaml = await import('js-yaml');
  return yaml.load(fs.readFileSync(filePath, 'utf8'));
}

async function fetchOffer(url) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      // Realistic browser UA to reduce anti-bot detection.
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 900 },
      locale: 'fr-FR',
      extraHTTPHeaders: {
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
      },
    });
    const page = await ctx.newPage();

    // 1. Try networkidle (lets SPA hydrate fully), fallback to domcontentloaded.
    let response;
    try {
      response = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    } catch (err) {
      if (/Timeout|networkidle/i.test(err.message)) {
        response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      } else {
        throw err;
      }
    }
    const status = response?.status() ?? null;

    // 2. Post-load pause for SPAs that do lazy rendering after first paint.
    await page.waitForTimeout(1500).catch(() => {});

    // 3. Final URL (may differ from input if server redirected to a homepage).
    const finalUrl = page.url();

    const title = await page.title();
    const body = await page.evaluate(() => document.body?.innerText || '');
    const company =
      (await page.evaluate(() => {
        const og = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content');
        if (og) return og;
        return document.querySelector('h1')?.innerText || '';
      })) || '';
    const location = await page.evaluate(() => {
      const el = document.querySelector('[class*="location" i], [data-testid*="location" i]');
      return el?.innerText || '';
    });
    return { url, finalUrl, title, body, company, location, status };
  } finally {
    await browser.close();
  }
}

function callClaude(system, user) {
  // Batch mode: strip all Claude Code overhead (hooks, plugins, CLAUDE.md,
  // auto-memory, MCP) while keeping OAuth auth (Claude MAX subscription).
  // Run from /tmp so no project CLAUDE.md is auto-discovered.
  const emptyMcpPath = path.join(os.tmpdir(), 'claude-apply-empty-mcp.json');
  if (!fs.existsSync(emptyMcpPath)) {
    fs.writeFileSync(emptyMcpPath, '{"mcpServers":{}}');
  }
  const proc = spawnSync(
    'claude',
    [
      '-p',
      '--system-prompt', system,
      '--disable-slash-commands',
      '--no-chrome',
      '--strict-mcp-config',
      '--mcp-config', emptyMcpPath,
      '--setting-sources', '',
      '--output-format', 'json',
    ],
    {
      input: user,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      cwd: os.tmpdir(),
    }
  );
  if (proc.status !== 0) {
    throw new Error(`claude CLI failed (${proc.status}): ${proc.stderr}`);
  }
  const parsed = JSON.parse(proc.stdout);
  const u = parsed.usage || {};
  const totalTokens =
    (u.input_tokens || 0) +
    (u.cache_creation_input_tokens || 0) +
    (u.cache_read_input_tokens || 0) +
    (u.output_tokens || 0);
  console.error(
    `[usage] in=${u.input_tokens || 0} cache_create=${u.cache_creation_input_tokens || 0} cache_read=${u.cache_read_input_tokens || 0} out=${u.output_tokens || 0} total=${totalTokens} cost=$${(parsed.total_cost_usd || 0).toFixed(4)}`
  );
  return (parsed.result || '').trim();
}

function parseScoreJson(raw) {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in LLM response: ${raw}`);
  const obj = JSON.parse(match[0]);
  if (typeof obj.score !== 'number') throw new Error('Invalid score field');
  if (!['apply', 'skip'].includes(obj.verdict)) throw new Error('Invalid verdict');
  return obj;
}

function nextId(evaluationsPath) {
  if (!fs.existsSync(evaluationsPath)) return '001';
  const lines = fs.readFileSync(evaluationsPath, 'utf8').trim().split('\n').filter(Boolean);
  let max = 0;
  for (const l of lines) {
    try {
      const n = parseInt(JSON.parse(l).id, 10);
      if (n > max) max = n;
    } catch {}
  }
  return String(max + 1).padStart(3, '0');
}

async function main() {
  const CONFIG_DIR =
    process.env.CLAUDE_APPLY_CONFIG_DIR || path.join(__dirname, '..', '..', 'config');
  const DATA_DIR =
    process.env.CLAUDE_APPLY_DATA_DIR || path.join(__dirname, '..', '..', 'data');

  const args = process.argv.slice(2);
  let offer;
  if (args.includes('--json-input')) {
    const jsonPath = args[args.indexOf('--json-input') + 1];
    offer = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } else {
    const url = args[0];
    if (!url) {
      console.error('Usage: node src/score/index.mjs <url> | --json-input <path> [--id NNN]');
      process.exit(2);
    }
    offer = await fetchOffer(url);
  }

  // Liveness check: closed/broken/listing pages → exit early, zero Claude tokens.
  // Logged to data/filtered-out.tsv for audit.
  const liveness = detectClosedPage(offer);
  if (liveness.closed) {
    const date = new Date().toISOString().slice(0, 10);
    appendFilteredOut(path.join(DATA_DIR, 'filtered-out.tsv'), {
      date,
      url: offer.url || '',
      company: offer.company || 'unknown',
      title: offer.title || '',
      reason: `liveness: ${liveness.reason}`,
    });
    console.error(`[skip] page closed/broken — ${liveness.reason}`);
    console.log(JSON.stringify({ skipped: true, reason: liveness.reason, url: offer.url }));
    return;
  }

  const profile = await parseYaml(path.join(CONFIG_DIR, 'profile.yml'));
  const condensedPath = path.join(
    CONFIG_DIR,
    profile.evaluation?.profile_condensed_path || 'profile-condensed.md'
  );
  const profileCondensed = fs.readFileSync(condensedPath, 'utf8');

  const { system, user } = buildPrompt({
    profileCondensed,
    offer,
    jdMaxTokens: 1500,
  });

  const raw = callClaude(system, user);
  const scored = parseScoreJson(raw);

  const evalPath = path.join(DATA_DIR, 'evaluations.jsonl');
  const id = args.includes('--id') ? args[args.indexOf('--id') + 1] : nextId(evalPath);
  const date = new Date().toISOString().slice(0, 10);
  const record = {
    id,
    date,
    company: offer.company || 'unknown',
    role: offer.title || 'unknown',
    url: offer.url || '',
    location: offer.location || '',
    score: scored.score,
    verdict: scored.verdict,
    reason: scored.reason,
    status: 'Evaluated',
  };
  appendJsonl(evalPath, record);

  const tsvDir = path.join(DATA_DIR, 'tracker-additions');
  writeTrackerTsv(tsvDir, {
    num: id,
    date,
    company: record.company,
    role: record.role,
    score: scored.score,
    notes: scored.reason,
  });

  console.log(JSON.stringify(record));
}

main().catch((err) => {
  console.error(err);
  process.exit(3);
});
