#!/usr/bin/env node
// Usage: node src/score/index.mjs <url> [flags]
//   <url>             Offer URL (omit when --json-input is set)
//   --from-pipeline   Look up {company, role, location} in data/pipeline.md by URL
//   --company X --role Y --location Z   Authoritative metadata overrides (all-or-nothing)
//   --json-input <path>   Read pre-built offer JSON instead of fetching
//   --id NNN          Force evaluation id (default: auto-increment)
// Builds prompt, calls `claude -p` CLI, parses JSON response,
// appends to data/evaluations.jsonl + data/tracker-additions/<id>-<slug>.tsv.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPrompt } from './prompt-builder.mjs';
import { appendJsonl, appendFilteredOut } from '../lib/jsonl-writer.mjs';
import { writeTrackerTsv } from '../lib/tsv-writer.mjs';
import { detectClosedPage } from '../lib/page-liveness.mjs';
import { runPrefilter } from '../lib/prefilter-rules.mjs';
import { loadProfile, ProfileMissingError } from '../lib/load-profile.mjs';
import { readPipelineMd, findOfferByUrl } from '../lib/pipeline-md.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function fetchOfferBody(url) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 900 },
      locale: 'fr-FR',
      extraHTTPHeaders: { 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8' },
    });
    const page = await ctx.newPage();

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
    await page.waitForTimeout(1500).catch(() => {});
    const finalUrl = page.url();

    const pageTitle = await page.title();
    const body = await page.evaluate(() => document.body?.innerText || '');
    const scrapedCompany =
      (await page.evaluate(() => {
        const og = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content');
        if (og) return og;
        return document.querySelector('h1')?.innerText || '';
      })) || '';
    const scrapedLocation = await page.evaluate(() => {
      const el = document.querySelector('[class*="location" i], [data-testid*="location" i]');
      return el?.innerText || '';
    });
    return {
      finalUrl,
      status,
      body,
      scrapedTitle: pageTitle,
      scrapedCompany,
      scrapedLocation,
    };
  } finally {
    await browser.close();
  }
}

async function buildOffer(url, overrides = {}) {
  const { company, title, location, source } = overrides;
  const fetched = await fetchOfferBody(url);
  if (source === 'scrape') {
    return {
      url,
      finalUrl: fetched.finalUrl,
      status: fetched.status,
      body: fetched.body,
      title: fetched.scrapedTitle || '',
      company: fetched.scrapedCompany || '',
      location: fetched.scrapedLocation || '',
      metadata_source: 'scrape',
    };
  }
  return {
    url,
    finalUrl: fetched.finalUrl,
    status: fetched.status,
    body: fetched.body,
    title: title ?? '',
    company: company ?? '',
    location: location ?? '',
    metadata_source: source,
  };
}

export function callClaudeAsync(system, user) {
  const emptyMcpPath = path.join(os.tmpdir(), 'claude-apply-empty-mcp.json');
  if (!fs.existsSync(emptyMcpPath)) {
    fs.writeFileSync(emptyMcpPath, '{"mcpServers":{}}');
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(
      'claude',
      [
        '-p',
        '--system-prompt',
        system,
        '--disable-slash-commands',
        '--no-chrome',
        '--strict-mcp-config',
        '--mcp-config',
        emptyMcpPath,
        '--setting-sources',
        '',
        '--output-format',
        'json',
      ],
      {
        cwd: os.tmpdir(),
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claude CLI failed (${code}): ${stderr}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        const u = parsed.usage || {};
        const totalTokens =
          (u.input_tokens || 0) +
          (u.cache_creation_input_tokens || 0) +
          (u.cache_read_input_tokens || 0) +
          (u.output_tokens || 0);
        console.error(
          `[usage] in=${u.input_tokens || 0} cache_create=${u.cache_creation_input_tokens || 0} cache_read=${u.cache_read_input_tokens || 0} out=${u.output_tokens || 0} total=${totalTokens} cost=$${(parsed.total_cost_usd || 0).toFixed(4)}`
        );
        resolve((parsed.result || '').trim());
      } catch (err) {
        reject(
          new Error(
            `Failed to parse claude output: ${err.message}\nstdout: ${stdout.slice(0, 500)}`
          )
        );
      }
    });

    proc.on('error', (err) => reject(new Error(`Failed to spawn claude: ${err.message}`)));

    proc.stdin.write(user);
    proc.stdin.end();
  });
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

export function parseScoreArgs(argv) {
  const args = argv.slice();
  const flags = {
    url: null,
    jsonInput: null,
    id: null,
    company: null,
    role: null,
    location: null,
    fromPipeline: false,
  };

  function take(name) {
    const i = args.indexOf(name);
    if (i === -1) return null;
    const v = args[i + 1];
    if (v === undefined || v.startsWith('--')) return null;
    args.splice(i, 2);
    return v;
  }

  flags.jsonInput = take('--json-input');
  flags.id = take('--id');
  flags.company = take('--company');
  flags.role = take('--role');
  flags.location = take('--location');
  const fpIdx = args.indexOf('--from-pipeline');
  if (fpIdx !== -1) {
    flags.fromPipeline = true;
    args.splice(fpIdx, 1);
  }
  flags.url = args.find((a) => !a.startsWith('--')) || null;

  const hasAnyMetadataFlag = flags.company || flags.role || flags.location;
  const hasAllMetadataFlags = flags.company && flags.role && flags.location;

  if (hasAnyMetadataFlag && !hasAllMetadataFlags) {
    throw new Error('--company, --role, and --location must be provided together (all-or-nothing)');
  }
  if (flags.fromPipeline && hasAnyMetadataFlag) {
    throw new Error('--from-pipeline is mutually exclusive with --company/--role/--location');
  }

  return flags;
}

async function main() {
  const CONFIG_DIR =
    process.env.CLAUDE_APPLY_CONFIG_DIR || path.join(__dirname, '..', '..', 'config');
  const DATA_DIR = process.env.CLAUDE_APPLY_DATA_DIR || path.join(__dirname, '..', '..', 'data');

  let flags;
  try {
    flags = parseScoreArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  let offer;
  if (flags.jsonInput) {
    offer = JSON.parse(fs.readFileSync(flags.jsonInput, 'utf8'));
    if (!offer.metadata_source) offer.metadata_source = 'json-input';
  } else {
    if (!flags.url) {
      console.error(
        'Usage: node src/score/index.mjs <url> [--from-pipeline | --company X --role Y --location Z] [--id NNN]'
      );
      process.exit(2);
    }

    if (flags.fromPipeline) {
      const pipelinePath = path.join(DATA_DIR, 'pipeline.md');
      if (!fs.existsSync(pipelinePath)) {
        console.error(`--from-pipeline: ${pipelinePath} does not exist`);
        process.exit(2);
      }
      const doc = readPipelineMd(pipelinePath);
      const hit = findOfferByUrl(doc, flags.url);
      if (!hit) {
        console.error(`--from-pipeline: url not found in pipeline.md: ${flags.url}`);
        process.exit(2);
      }
      offer = await buildOffer(flags.url, {
        source: 'pipeline',
        company: hit.company,
        title: hit.title,
        location: hit.location,
      });
    } else if (flags.company) {
      offer = await buildOffer(flags.url, {
        source: 'flags',
        company: flags.company,
        title: flags.role,
        location: flags.location,
      });
    } else {
      offer = await buildOffer(flags.url, { source: 'scrape' });
    }
  }

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

  const { cvMarkdown } = await loadProfile(CONFIG_DIR);
  if (!cvMarkdown) {
    throw new ProfileMissingError(`config/cv.md not found in ${CONFIG_DIR} — run /onboard`);
  }

  const { system, user } = buildPrompt({
    cvMarkdown,
    offer,
    jdMaxTokens: 1500,
  });

  const raw = await callClaudeAsync(system, user);
  const scored = parseScoreJson(raw);

  const evalPath = path.join(DATA_DIR, 'evaluations.jsonl');
  const id = flags.id || nextId(evalPath);
  const date = new Date().toISOString().slice(0, 10);
  const record = {
    id,
    date,
    company: offer.company || 'unknown',
    role: offer.title || 'unknown',
    url: offer.url || '',
    location: offer.location || '',
    metadata_source: offer.metadata_source || 'unknown',
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(3);
  });
}
