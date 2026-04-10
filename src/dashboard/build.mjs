#!/usr/bin/env node
// Dashboard generator: builds a self-contained dashboard.html from
// applications.md, reports/*.md, evaluations.jsonl, and filtered-out.tsv.
//
// Usage (CLI):
//   node src/dashboard/build.mjs
//
// Or import buildDashboard() for programmatic / test use.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseApplications } from '../lib/applications-md.mjs';

// Statuses: normalize variants to canonical English.
const STATUS_MAP = {
  Evaluada: 'Evaluated',
  Evaluated: 'Evaluated',
  Applied: 'Applied',
  Aplicada: 'Applied',
  Discarded: 'Discarded',
  Descartada: 'Discarded',
  SKIP: 'SKIP',
  Rejected: 'Rejected',
  Rechazada: 'Rejected',
  Interview: 'Interview',
  Offer: 'Offer',
  Responded: 'Responded',
};

// Derive a human-readable company name from a job URL.
// Handles welcometothejungle, greenhouse, ashby, lever.
function deriveCompanyFromUrl(url) {
  if (!url) return null;
  const patterns = [
    /welcometothejungle\.com\/[a-z-]+\/companies\/([^/]+)\/jobs\//i,
    /(?:boards|job-boards)\.greenhouse\.io\/([^/]+)\/jobs\//i,
    /jobs\.ashbyhq\.com\/([^/?#]+)/i,
    /jobs\.lever\.co\/([^/?#]+)/i,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) {
      const slug = decodeURIComponent(m[1]);
      return slug
        .split(/[-_]/)
        .filter(Boolean)
        .map((w) => {
          const lower = w.toLowerCase();
          if (lower === 'ai' || lower === 'ml' || lower === 'hr' || lower === 'bcg') return lower.toUpperCase();
          return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(' ');
    }
  }
  return null;
}

// Clean a noisy title-style role string.
function cleanRole(role, company) {
  if (!role) return role;
  let cleaned = role
    .replace(/\s*[-–]\s*(Stage|Internship)\s+(à|in|en)\s+[^-–]*$/i, '')
    .replace(/\s*[-–]\s*Stage\s*$/i, '')
    .trim();
  if (company) {
    const safeCompany = company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned
      .replace(new RegExp(`\\s*[-–]\\s*${safeCompany}\\s*[-–]?\\s*$`, 'i'), '')
      .replace(new RegExp(`\\s*[-–]\\s*${safeCompany}\\s*[-–]\\s*`, 'i'), ' — ')
      .trim();
  }
  return cleaned || role;
}

const COMPANY_NOISE_RE =
  /\b(unknown|internship|stage|stagiaire|job application|current openings|attention required|cloudflare|sorry|error\s*404|jobs at)\b/i;

/**
 * Build the dashboard HTML file from the given data sources.
 *
 * @param {object} opts
 * @param {string} opts.applicationsPath  - Path to applications.md
 * @param {string} opts.reportsDir        - Path to reports/ directory
 * @param {string} opts.evaluationsPath   - Path to evaluations.jsonl
 * @param {string} opts.filteredOutPath   - Path to filtered-out.tsv
 * @param {string} opts.outputPath        - Where to write dashboard.html
 */
export async function buildDashboard({
  applicationsPath,
  reportsDir,
  evaluationsPath,
  filteredOutPath,
  outputPath,
}) {
  // 1. Parse applications.md using the shared parser
  const md = existsSync(applicationsPath) ? readFileSync(applicationsPath, 'utf8') : '';
  const parsed = parseApplications(md);

  const rows = parsed.map((a) => ({
    num: parseInt(a.num, 10) || 0,
    date: a.date,
    company: a.company,
    role: a.role,
    score: /^\d/.test(a.score) ? parseFloat(a.score) : null,
    status: STATUS_MAP[a.status] || a.status,
    reportFile: (() => {
      const m = a.report.match(/\(reports\/([^)]+)\)/);
      return m ? m[1] : null;
    })(),
    notes: a.notes || '',
    url: null,
  }));

  // 2. Extract URL from each report file
  for (const r of rows) {
    if (!r.reportFile) continue;
    const fp = join(reportsDir, r.reportFile);
    if (!existsSync(fp)) continue;
    const txt = readFileSync(fp, 'utf8');
    const m = txt.match(/^\*\*URL:\*\*\s*(\S+)/m);
    if (m) r.url = m[1];
  }

  // 3. Enrich from evaluations.jsonl
  if (existsSync(evaluationsPath)) {
    const jsonlText = readFileSync(evaluationsPath, 'utf8');
    const evalByNum = new Map();
    for (const line of jsonlText.split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        const n = parseInt(obj.id, 10);
        if (!Number.isNaN(n)) evalByNum.set(n, obj);
      } catch {
        // corrupted JSONL line, skip
      }
    }
    for (const r of rows) {
      let reportNum = null;
      if (r.reportFile) {
        const m = r.reportFile.match(/^(\d+)-/);
        if (m) reportNum = parseInt(m[1], 10);
      }
      const ev = (reportNum != null && evalByNum.get(reportNum)) || evalByNum.get(r.num);
      if (!ev) continue;
      if (!r.url && ev.url) r.url = ev.url;
      if (ev.verdict) r.verdict = ev.verdict;
      if (ev.reason && !r.notes) r.notes = ev.reason;
    }
  }

  // 4. Fix noisy company/role fields derived from ATS slugs
  for (const r of rows) {
    const company = r.company || '';
    const looksNoisy = !company || COMPANY_NOISE_RE.test(company) || company.length > 40;
    if (looksNoisy && r.url) {
      const derived = deriveCompanyFromUrl(r.url);
      if (derived) r.company = derived;
    }
    if (r.role) r.role = cleanRole(r.role, r.company);
  }

  // 5. Build final apps list
  const apps = rows.map((r) => ({
    company: r.company,
    role: r.role,
    score: r.score,
    status: r.status,
    url: r.url || null,
    notes: r.notes,
  }));

  // Sort by score descending (null last), then company name
  apps.sort((a, b) => {
    const sa = a.score ?? -1;
    const sb = b.score ?? -1;
    if (sb !== sa) return sb - sa;
    return (a.company || '').localeCompare(b.company || '');
  });

  // 6. Load filtered-out TSV
  let filteredOut = [];
  if (existsSync(filteredOutPath)) {
    const raw = readFileSync(filteredOutPath, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      const cols = line.split('\t');
      if (cols.length < 5) continue;
      const [date, url, company, title, reason] = cols;
      filteredOut.push({ date, url, company, title, reason });
    }
  }

  // 7. Generate self-contained HTML
  const html = generateHtml(apps, filteredOut);
  writeFileSync(outputPath, html, 'utf8');

  console.log(
    `Dashboard written to ${outputPath}: ${apps.length} applications, ${filteredOut.length} filtered out.`,
  );
}

function generateHtml(apps, filteredOut) {
  const appRows = apps
    .map((a) => {
      const scoreDisplay = a.score != null ? a.score.toFixed(1) : '—';
      const statusClass = (a.status || '').toLowerCase().replace(/\s+/g, '-');
      const title = `${a.company || 'Unknown'} — ${a.role || ''}`;
      const urlAttr = a.url ? ` href="${escapeHtml(a.url)}" target="_blank" rel="noopener"` : '';
      const link = a.url ? `<a${urlAttr}>${escapeHtml(title)}</a>` : escapeHtml(title);
      return `    <tr>
      <td>${link}</td>
      <td class="score">${escapeHtml(scoreDisplay)}</td>
      <td><span class="status status-${escapeHtml(statusClass)}">${escapeHtml(a.status || '')}</span></td>
      <td class="notes">${escapeHtml(a.notes || '')}</td>
    </tr>`;
    })
    .join('\n');

  const filteredRows = filteredOut
    .map((f) => {
      const urlAttr = f.url ? ` href="${escapeHtml(f.url)}" target="_blank" rel="noopener"` : '';
      const link = f.url ? `<a${urlAttr}>${escapeHtml(f.title || f.url)}</a>` : escapeHtml(f.title || '');
      return `    <tr>
      <td>${escapeHtml(f.date || '')}</td>
      <td>${escapeHtml(f.company || '')}</td>
      <td>${link}</td>
      <td class="notes">${escapeHtml(f.reason || '')}</td>
    </tr>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Application Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #f5f5f5; color: #222; padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 1.5rem; }
    h2 { font-size: 1.1rem; margin: 2rem 0 0.75rem; }
    .summary { margin-bottom: 1rem; color: #555; font-size: 0.9rem; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
    th, td { padding: 0.65rem 0.9rem; text-align: left; border-bottom: 1px solid #eee; font-size: 0.875rem; }
    th { background: #f0f0f0; font-weight: 600; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #fafafa; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .score { font-variant-numeric: tabular-nums; }
    .status { display: inline-block; padding: 0.2em 0.6em; border-radius: 4px; font-size: 0.78rem; font-weight: 600; }
    .status-applied { background: #dbeafe; color: #1e40af; }
    .status-interview { background: #d1fae5; color: #065f46; }
    .status-offer { background: #fef3c7; color: #92400e; }
    .status-rejected { background: #fee2e2; color: #991b1b; }
    .status-discarded { background: #f3f4f6; color: #6b7280; }
    .status-evaluated { background: #ede9fe; color: #5b21b6; }
    .status-skip { background: #f3f4f6; color: #9ca3af; }
    .notes { color: #666; max-width: 30ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .filtered-section { margin-top: 2.5rem; }
    .generated-at { font-size: 0.78rem; color: #999; margin-top: 2rem; }
  </style>
</head>
<body>
  <h1>Application Dashboard</h1>
  <p class="summary">${apps.length} application${apps.length !== 1 ? 's' : ''} tracked &middot; ${filteredOut.length} filtered out</p>

  <table>
    <thead>
      <tr>
        <th>Position</th>
        <th>Score</th>
        <th>Status</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
${appRows || '    <tr><td colspan="4" style="color:#999;text-align:center">No applications yet.</td></tr>'}
    </tbody>
  </table>

${filteredOut.length > 0 ? `  <div class="filtered-section">
    <h2>Filtered Out (${filteredOut.length})</h2>
    <table>
      <thead>
        <tr><th>Date</th><th>Company</th><th>Position</th><th>Reason</th></tr>
      </thead>
      <tbody>
${filteredRows}
      </tbody>
    </table>
  </div>` : ''}

  <p class="generated-at">Generated at ${new Date().toISOString()}</p>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// CLI guard — run directly as a script
if (import.meta.url === `file://${process.argv[1]}`) {
  const dataDir = process.env.CLAUDE_APPLY_DATA_DIR || './data';
  const reportsDir = process.env.CLAUDE_APPLY_REPORTS_DIR || './reports';
  await buildDashboard({
    applicationsPath: `${dataDir}/applications.md`,
    reportsDir,
    evaluationsPath: `${dataDir}/evaluations.jsonl`,
    filteredOutPath: `${dataDir}/filtered-out.tsv`,
    outputPath: './dashboard.html',
  });
}
