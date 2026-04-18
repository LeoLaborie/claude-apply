#!/usr/bin/env node
// Portal scanner for Group A companies (API-friendly ATS: Lever, Greenhouse,
// Ashby). Zero LLM tokens, zero Playwright. Reads portals.yml +
// candidate-profile.yml for blacklist / min_start_date overrides,
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
import { fetchWorkday } from './ats/workday.mjs';
import { runPrefilter } from '../lib/prefilter-rules.mjs';
import { appendFilteredOut } from '../lib/jsonl-writer.mjs';
import { readPipelineMd, appendOffer, writePipelineMd } from '../lib/pipeline-md.mjs';
import { loadSeenUrls, appendHistoryRow } from '../lib/scan-history.mjs';
import { loadProfile } from '../lib/load-profile.mjs';
import { MissingConfigError, requireConfig } from '../lib/config-loader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DISPATCH = {
  lever: fetchLever,
  greenhouse: fetchGreenhouse,
  ashby: fetchAshby,
  workday: fetchWorkday,
};

function reasonToStatus(reason) {
  if (!reason) return 'skipped_other';
  if (reason.startsWith('title:')) return 'skipped_title';
  if (reason.startsWith('blacklist:')) return 'skipped_blacklist';
  if (reason.startsWith('location:')) return 'skipped_location';
  if (reason.startsWith('start_date:')) return 'skipped_date';
  return 'skipped_other';
}

function buildSearchTerms(positiveTerms) {
  if (!Array.isArray(positiveTerms) || positiveTerms.length === 0) return [];
  return positiveTerms.filter((t) => typeof t === 'string' && !t.startsWith('/'));
}

async function fetchCompanyOffers(company, whitelist) {
  const det = detectPlatform(company.careers_url);
  if (!det) {
    return { company: company.name, platform: null, offers: [], error: 'platform not detected' };
  }
  const fn = DISPATCH[det.platform];
  if (!fn) {
    return { company: company.name, platform: det.platform, offers: [], error: 'no fetcher' };
  }
  try {
    const opts =
      det.platform === 'workday'
        ? { searchTerms: buildSearchTerms(whitelist.positive) }
        : undefined;
    const offers = opts ? await fn(det.slug, company.name, opts) : await fn(det.slug, company.name);
    return { company: company.name, platform: det.platform, offers, error: null };
  } catch (err) {
    return { company: company.name, platform: det.platform, offers: [], error: err.message };
  }
}

export async function runScan(opts) {
  const {
    portalsConfig,
    profile,
    pipelinePath,
    historyPath,
    filteredPath,
    applicationsPath,
    dryRun = false,
    onlySlug = null,
    onProgress = null,
  } = opts;

  const whitelist = portalsConfig.title_filter || { positive: [], negative: [] };
  const targetLocations =
    profile.target_locations || [profile.country, profile.city, 'Remote'].filter(Boolean);
  const prefilterConfig = {
    whitelist,
    blacklist: profile.blacklist_companies || [],
    minStartDate: profile.min_start_date || '2026-08-24',
    targetLocations,
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

  const eligibleTotal = companies.length;

  const companyByName = new Map(companies.map((c) => [c.name, c]));
  const fetchResults = await Promise.all(companies.map((c) => fetchCompanyOffers(c, whitelist)));

  const seen = loadSeenUrls(historyPath, applicationsPath);

  const today = new Date().toISOString().slice(0, 10);
  const doc = dryRun ? { header: '', sections: [] } : readPipelineMd(pipelinePath);

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
  let filteredWrites = 0;
  const perCompany = [];
  let progressIndex = 0;

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
      perCompany.push({
        company: result.company,
        platform: result.platform,
        rawCount: 0,
        afterFilterCount: 0,
        newCount: 0,
        error: result.error,
        warning: null,
      });
      progressIndex++;
      if (onProgress) {
        onProgress({
          index: progressIndex,
          total: fetchResults.length,
          company: result.company,
          platform: result.platform,
          rawCount: 0,
          afterFilterCount: 0,
          newCount: 0,
          error: result.error,
        });
      }
      continue;
    }

    raw += result.offers.length;

    const companyConfig = companyByName.get(result.company);
    const effectiveConfig = {
      ...prefilterConfig,
      ...(companyConfig?.skip_required_any && {
        whitelist: { ...whitelist, required_any: [] },
      }),
      ...(Array.isArray(companyConfig?.target_locations) && {
        targetLocations: companyConfig.target_locations,
      }),
    };

    let companyAfterFilter = 0;
    let companyNew = 0;
    for (const offer of result.offers) {
      let check;
      try {
        check = runPrefilter(offer, effectiveConfig);
      } catch (err) {
        filtered.skipped_other = (filtered.skipped_other || 0) + 1;
        errors.push({ company: offer.company, error: `prefilter: ${err.message}` });
        if (!dryRun && !seen.has(offer.url)) {
          seen.add(offer.url);
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
        if (!dryRun && !seen.has(offer.url)) {
          seen.add(offer.url);
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
          filteredWrites++;
        }
        continue;
      }

      // Offer passed prefilter — count it before dedup check
      companyAfterFilter++;

      if (seen.has(offer.url)) {
        filtered.skipped_dup++;
        continue;
      }
      seen.add(offer.url);

      added.push(offer);
      companyNew++;
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

    const warning =
      result.offers.length === 0 ? 'board live but empty — possibly wrong slug' : null;
    perCompany.push({
      company: result.company,
      platform: result.platform,
      rawCount: result.offers.length,
      afterFilterCount: companyAfterFilter,
      newCount: companyNew,
      error: null,
      warning,
    });

    progressIndex++;
    if (onProgress) {
      onProgress({
        index: progressIndex,
        total: fetchResults.length,
        company: result.company,
        platform: result.platform,
        rawCount: result.offers.length,
        afterFilterCount: companyAfterFilter,
        newCount: companyNew,
        error: null,
      });
    }
  }

  if (!dryRun && added.length > 0) {
    writePipelineMd(pipelinePath, doc);
  }

  return {
    scanned: companies.length,
    eligibleTotal,
    raw,
    perCompany,
    filtered,
    added,
    errors,
    historyWrites,
    filteredWrites,
  };
}

export function formatSummary(result, dryRun) {
  const lines = [];
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  lines.push(`Portal Scan — ${now}`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push(`Entreprises scannées : ${result.scanned}/${result.eligibleTotal ?? result.scanned}`);
  lines.push(`Offres brutes         : ${result.raw}`);
  for (const c of result.perCompany) {
    const mark = c.error ? '✗' : c.warning ? '⚠' : '✓';
    const note = c.error
      ? `(${c.error})`
      : c.warning
        ? `(${c.platform} — ${c.warning})`
        : `(${c.platform})`;
    const counts =
      c.error || c.rawCount === c.afterFilterCount
        ? `${c.rawCount} raw, ${c.newCount} new`
        : `${c.rawCount} raw → ${c.afterFilterCount} after filter → ${c.newCount} new`;
    lines.push(`  ${mark} ${c.company.padEnd(18)} ${counts} ${note}`);
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
    lines.push(`  filtered-out.tsv      (+${result.filteredWrites ?? 0} lignes)`);
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

  const CONFIG_DIR =
    process.env.CLAUDE_APPLY_CONFIG_DIR || path.join(__dirname, '..', '..', 'config');
  const DATA_DIR = process.env.CLAUDE_APPLY_DATA_DIR || path.join(__dirname, '..', '..', 'data');

  const portalsPath = path.join(CONFIG_DIR, 'portals.yml');
  requireConfig(portalsPath);

  const yaml = await import('js-yaml');
  const portalsConfig = yaml.load(fs.readFileSync(portalsPath, 'utf8'));
  const { profile } = await loadProfile(CONFIG_DIR);

  const result = await runScan({
    portalsConfig,
    profile,
    pipelinePath: path.join(DATA_DIR, 'pipeline.md'),
    historyPath: path.join(DATA_DIR, 'scan-history.tsv'),
    filteredPath: path.join(DATA_DIR, 'filtered-out.tsv'),
    applicationsPath: path.join(DATA_DIR, 'applications.md'),
    dryRun,
    onlySlug,
    onProgress: ({ index, total, company, rawCount, afterFilterCount, newCount, error }) => {
      if (error) {
        process.stderr.write(`[${index}/${total}] \u2717 ${company} \u2014 ${error}\n`);
      } else {
        const alreadySeen = afterFilterCount - newCount;
        const line =
          afterFilterCount === rawCount
            ? `${rawCount} raw, ${newCount} new`
            : `${rawCount} raw \u2192 ${afterFilterCount} after filter \u2192 ${newCount} new (${alreadySeen} already seen)`;
        process.stderr.write(`[${index}/${total}] \u2713 ${company} \u2014 ${line}\n`);
      }
    },
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
    if (err instanceof MissingConfigError) {
      console.error(err.message);
      process.exit(2);
    }
    console.error(err);
    process.exit(1);
  });
}
