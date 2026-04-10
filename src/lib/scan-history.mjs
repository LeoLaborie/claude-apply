// Scan history reader/writer and applications.md URL extractor.
// scan-history.tsv format:
//   url\tfirst_seen\tportal\ttitle\tcompany\tstatus

import fs from 'node:fs';
import path from 'node:path';

const HEADER = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus';
const URL_RE = /https?:\/\/[^\s|)<>]+/g;

function sanitize(value) {
  return String(value ?? '').replace(/[\t\r\n]+/g, ' ');
}

export function loadSeenUrls(historyPath, applicationsPath) {
  const seen = new Set();

  if (fs.existsSync(historyPath)) {
    const raw = fs.readFileSync(historyPath, 'utf8');
    const lines = raw.split('\n');
    for (const line of lines.slice(1)) {
      // skip header
      if (!line.trim()) continue;
      const url = line.split('\t')[0];
      if (url) seen.add(url.trim());
    }
  }

  if (applicationsPath && fs.existsSync(applicationsPath)) {
    const raw = fs.readFileSync(applicationsPath, 'utf8');
    const matches = raw.match(URL_RE) || [];
    for (const u of matches) seen.add(u);
  }

  return seen;
}

export function appendHistoryRow(filePath, row) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const exists = fs.existsSync(filePath);
  const cols = [row.url, row.first_seen, row.portal, row.title, row.company, row.status]
    .map(sanitize)
    .join('\t');
  const chunk = exists ? `${cols}\n` : `${HEADER}\n${cols}\n`;
  fs.appendFileSync(filePath, chunk, 'utf8');
}
