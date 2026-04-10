#!/usr/bin/env node
// Portal scanner for Group A companies (API-friendly ATS: Lever, Greenhouse,
// Ashby). Zero LLM tokens, zero Playwright. Reads portals.yml + profile.yml,
// dispatches to src/scan/ats/{platform}.mjs, applies runPrefilter(), appends
// results to pipeline.md + scan-history.tsv + filtered-out.tsv.
//
// Workable was dropped: Hugging Face moved to an auth-protected SPA.
//
// Usage:
//   node src/scan/index.mjs                  # scan all enabled Group A companies
//   node src/scan/index.mjs --only <slug>    # scan a single company by ATS slug
//   node src/scan/index.mjs --dry-run        # compute everything, write nothing
//   node src/scan/index.mjs --json           # emit structured JSON to stdout

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectPlatform } from './ats-detect.mjs';
import { fetchLever } from './ats/lever.mjs';
import { fetchGreenhouse } from './ats/greenhouse.mjs';
import { fetchAshby } from './ats/ashby.mjs';
import { runPrefilter } from './prefilter-rules.mjs';
import { appendFilteredOut } from '../lib/jsonl-writer.mjs';
import {
  readPipelineMd,
  appendOffer,
  writePipelineMd,
} from '../lib/pipeline-md.mjs';
import { loadSeenUrls, appendHistoryRow } from '../lib/scan-history.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DISPATCH = {
  lever: fetchLever,
  greenhouse: fetchGreenhouse,
  ashby: fetchAshby,
};

function reasonToStatus(reason) {
  if (!reason) return 'skipped_other';
  if (reason.startsWith('title:')) return 'skipped_title';
  if (reason.startsWith('blacklist:')) return 'skipped_blacklist';
  if (reason.startsWith('location:')) return 'skipped_location';
  if (reason.startsWith('start_date:')) return 'skipped_date';
  return 'skipped_other';
}

async function parseYaml(filePath) {
  const { parse } = await import('yaml');
  return parse(fs.readFileSync(filePath, 'utf8'));
}

async function fetchCompanyOffers(company) {
  const det = detectPlatform(company.careers_url);
  if (!det) {
    return { company: company.name, platform: null, offers: [], error: 'platform not detected' };
  }
  const fn = DISPATCH[det.platform];
  if (!fn) {
    return { company: company.name, platform: det.platform, offers: [], error: 'no fetcher' };
  }
  try {
    const offers = await fn(det.slug, company.name);
    return { company: company.name, platform: det.platform, offers, error: null };
  } catch (err) {
    return { company: company.name, platform: det.platform, offers: [], error: err.message };
  }
}

export async function runScan(opts) {
  const {
    portalsConfig,
    profileConfig,
    pipelinePath,
    historyPath,
    filteredPath,
    applicationsPath,
    dryRun = false,
    onlySlug = null,
  } = opts;

  const whitelist = portalsConfig.title_filter || { positive: [], negative: [] };
  const prefilterConfig = {
    whitelist,
    blacklist: profileConfig.evaluation?.blacklist_companies || [],
    minStartDate: profileConfig.evaluation?.min_start_date || '2026-08-24',
  };

  let companies = (portalsConfig.tracked_companies || [])
    .filter((c) => c.enabled !== false)
    .filter((c) => detectPlatform(c.careers_url) !== null);

  if (onlySlug) {
    companies = companies.filter((c) => {
      const d = detectPlatform(c.careers_url);
      return d && d.slug === onlySlug;
    });
  }

  const fetchResults = await Promise.all(companies.map(fetchCompanyOffers));

  const seen = loadSeenUrls(historyPath, applicationsPath);

  const today = new Date().toISOString().slice(0, 10);
  const doc = dryRun
    ? { header: '', sections: [] }
    : readPipelineMd(pipelinePath);

  const added = [];
  const errors = [];
  const filtered = {
    skipped_dup: 0,
    skipped_title: 0,
    skipped_blacklist: 0,
    skipped_location: 0,
    skipped_date: 0,
    skipped_other: 0,
  };
  let raw = 0;
  let historyWrites = 0;
  const perCompany = [];

  for (const result of fetchResults) {
    if (result.error) {
      errors.push({ company: result.company, error: result.error });
      // Only log to scan-history if this error sentinel isn't already tracked
      // (prevents unbounded growth for persistently-failing companies).
      const errorUrl = `error://${result.company}`;
      if (!dryRun && !seen.has(errorUrl)) {
        seen.add(errorUrl);
        appendHistoryRow(historyPath, {
          url: errorUrl,
          first_seen: today,
          portal: result.platform || 'unknown',
          title: result.error.slice(0, 200),
          company: result.company,
          status: 'error_fetch',
        });
        historyWrites++;
      }
      perCompany.push({ company: result.company, platform: result.platform, count: 0, error: result.error });
      continue;
    }

    perCompany.push({ company: result.company, platform: result.platform, count: result.offers.length });
    raw += result.offers.length;

    for (const offer of result.offers) {
      if (seen.has(offer.url)) {
        // URL already in scan-history or applications.md — no need to re-log
        // (it already has a row with its original status). Just count it.
        filtered.skipped_dup++;
        continue;
      }
      seen.add(offer.url); // prevent intra-run duplicates

      let check;
      try {
        check = runPrefilter(offer, prefilterConfig);
      } catch (err) {
        filtered.skipped_other = (filtered.skipped_other || 0) + 1;
        errors.push({ company: offer.company, error: `prefilter: ${err.message}` });
        if (!dryRun) {
          appendHistoryRow(historyPath, {
            url: offer.url,
            first_seen: today,
            portal: result.platform,
            title: offer.title,
            company: offer.company,
            status: 'skipped_other',
          });
          historyWrites++;
        }
        continue;
      }
      if (!check.pass) {
        const status = reasonToStatus(check.reason);
        filtered[status] = (filtered[status] || 0) + 1;
        if (!dryRun) {
          appendHistoryRow(historyPath, {
            url: offer.url,
            first_seen: today,
            portal: result.platform,
            title: offer.title,
            company: offer.company,
            status,
          });
          historyWrites++;
          appendFilteredOut(filteredPath, {
            date: today,
            url: offer.url,
            company: offer.company,
            title: offer.title,
            reason: check.reason,
          });
        }
        continue;
      }

      added.push(offer);
      appendOffer(doc, offer);
      if (!dryRun) {
        appendHistoryRow(historyPath, {
          url: offer.url,
          first_seen: today,
          portal: result.platform,
          title: offer.title,
          company: offer.company,
          status: 'added',
        });
        historyWrites++;
      }
    }
  }

  if (!dryRun && added.length > 0) {
    writePipelineMd(pipelinePath, doc);
  }

  return { scanned: companies.length, raw, perCompany, filtered, added, errors, historyWrites };
}

function formatSummary(result, dryRun) {
  const lines = [];
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  lines.push(`Portal Scan — ${now}`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`Entreprises scannées : ${result.scanned}/${result.scanned}`);
  lines.push(`Offres brutes         : ${result.raw}`);
  for (const c of result.perCompany) {
    const mark = c.error ? '✗' : '✓';
    const note = c.error ? `(${c.error})` : `(${c.platform})`;
    lines.push(`  ${mark} ${c.company.padEnd(18)} ${String(c.count).padStart(3)} offres ${note}`);
  }
  lines.push('');
  lines.push('Filtrage :');
  lines.push(`  • Déjà vues       ${result.filtered.skipped_dup}`);
  lines.push(`  • Titre rejeté    ${result.filtered.skipped_title}`);
  lines.push(`  • Blacklist       ${result.filtered.skipped_blacklist}`);
  lines.push(`  • Localisation    ${result.filtered.skipped_location}`);
  lines.push(`  • Date            ${result.filtered.skipped_date}`);
  lines.push('');
  lines.push(`Nouvelles ajoutées : ${result.added.length}`);
  for (const o of result.added) {
    lines.push(`  + ${o.company.padEnd(18)} | ${o.title}`);
  }
  lines.push('');
  if (dryRun) {
    lines.push('(dry-run — aucun fichier modifié)');
  } else {
    lines.push('Fichiers mis à jour :');
    lines.push(`  pipeline.md           (+${result.added.length} lignes)`);
    lines.push(`  scan-history.tsv      (+${result.historyWrites ?? 0} lignes)`);
  }
  if (result.errors.length > 0) {
    lines.push('');
    lines.push('Erreurs :');
    for (const e of result.errors) {
      lines.push(`  ! ${e.company}: ${e.error}`);
    }
  }
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const asJson = args.includes('--json');
  const onlyIdx = args.indexOf('--only');
  let onlySlug = null;
  if (onlyIdx >= 0) {
    const next = args[onlyIdx + 1];
    if (!next || next.startsWith('--')) {
      console.error('Error: --only requires a slug argument (e.g. --only mistral)');
      process.exit(2);
    }
    onlySlug = next;
  }

  const CONFIG_DIR = process.env.CLAUDE_APPLY_CONFIG_DIR || path.join(__dirname, '..', '..', 'config');
  const DATA_DIR = process.env.CLAUDE_APPLY_DATA_DIR || path.join(__dirname, '..', '..', 'data');

  const portalsConfig = await parseYaml(path.join(CONFIG_DIR, 'portals.yml'));
  const profileConfig = await parseYaml(path.join(CONFIG_DIR, 'profile.yml'));

  const result = await runScan({
    portalsConfig,
    profileConfig,
    pipelinePath: path.join(DATA_DIR, 'pipeline.md'),
    historyPath: path.join(DATA_DIR, 'scan-history.tsv'),
    filteredPath: path.join(DATA_DIR, 'filtered-out.tsv'),
    applicationsPath: path.join(DATA_DIR, 'applications.md'),
    dryRun,
    onlySlug,
  });

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatSummary(result, dryRun));
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
