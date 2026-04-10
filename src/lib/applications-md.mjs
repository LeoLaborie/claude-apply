// Parser and writer for data/applications.md.
// Format: markdown table with columns:
//   # | Date | Company | Role | Score | Status | PDF | Report | Notes
// Supports round-trip parse → serialize for well-formed inputs.

import fs from 'node:fs/promises';
import path from 'node:path';

const HEADER_LINE = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const SEPARATOR_LINE = '|---|------|---------|------|-------|--------|-----|--------|-------|';
const TITLE_RE = /^#\s+.+/;
const ROW_RE = /^\|(.+)\|$/;

/**
 * Parse a pipe-delimited markdown table row into an array of trimmed cell values.
 * @param {string} line
 * @returns {string[]}
 */
function parseRow(line) {
  return line
    .slice(1, -1) // strip leading/trailing |
    .split('|')
    .map((cell) => cell.trim());
}

/**
 * @typedef {Object} Application
 * @property {number|string} num       — sequential number
 * @property {string}        date      — YYYY-MM-DD
 * @property {string}        company   — company name
 * @property {string}        role      — job title / position
 * @property {string}        score     — e.g. "4.2/5"
 * @property {string}        status    — canonical status
 * @property {string}        pdf       — emoji or link
 * @property {string}        report    — markdown link e.g. [001](reports/001-...)
 * @property {string}        notes     — free-form notes
 */

/**
 * Parse applications.md markdown string into an array of Application objects.
 * @param {string} markdown
 * @returns {Application[]}
 */
export function parseApplications(markdown) {
  if (!markdown || !markdown.trim()) return [];

  const lines = markdown.split('\n');
  const apps = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect table header
    if (!inTable) {
      if (trimmed.startsWith('| #') && trimmed.includes('Company')) {
        inTable = true;
        continue;
      }
      continue;
    }

    // Skip separator line
    if (/^\|[-| ]+\|$/.test(trimmed)) continue;

    // End of table on blank line or non-table line
    if (!ROW_RE.test(trimmed)) {
      inTable = false;
      continue;
    }

    const cells = parseRow(trimmed);
    if (cells.length < 9) continue;

    apps.push({
      num: cells[0],
      date: cells[1],
      company: cells[2],
      role: cells[3],
      score: cells[4],
      status: cells[5],
      pdf: cells[6],
      report: cells[7],
      notes: cells[8],
    });
  }

  return apps;
}

/**
 * Serialize an array of Application objects back to the applications.md table format.
 * @param {Application[]} apps
 * @returns {string}
 */
export function serializeApplications(apps) {
  const rows = apps.map((a) => {
    return `| ${a.num} | ${a.date} | ${a.company} | ${a.role} | ${a.score} | ${a.status} | ${a.pdf} | ${a.report} | ${a.notes} |`;
  });
  return `# Applications Tracker\n\n${HEADER_LINE}\n${SEPARATOR_LINE}\n${rows.join('\n')}\n`;
}

/**
 * Append a single Application entry to the file at filePath.
 * Uses a tmp-file + rename for atomicity.
 * Creates the file (with header) if it does not exist.
 * @param {string} filePath
 * @param {Application} app
 * @returns {Promise<void>}
 */
export async function appendApplication(filePath, app) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  let existing = '';
  try {
    existing = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  let content;
  if (!existing.trim()) {
    // Fresh file — create header + new row
    const row = `| ${app.num} | ${app.date} | ${app.company} | ${app.role} | ${app.score} | ${app.status} | ${app.pdf} | ${app.report} | ${app.notes} |`;
    content = `# Applications Tracker\n\n${HEADER_LINE}\n${SEPARATOR_LINE}\n${row}\n`;
  } else {
    // Append row before the trailing newline of the table
    const row = `| ${app.num} | ${app.date} | ${app.company} | ${app.role} | ${app.score} | ${app.status} | ${app.pdf} | ${app.report} | ${app.notes} |`;
    content = existing.trimEnd() + '\n' + row + '\n';
  }

  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, filePath);
}
