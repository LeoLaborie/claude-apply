import fs from 'node:fs';
import path from 'node:path';

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function sanitizeTsv(value) {
  return String(value ?? '').replace(/[\t\r\n]+/g, ' ');
}

export function appendJsonl(filePath, obj) {
  ensureDir(filePath);
  fs.appendFileSync(filePath, JSON.stringify(obj) + '\n', 'utf8');
}

export function appendFilteredOut(filePath, entry) {
  ensureDir(filePath);
  const cols = [entry.date, entry.url, entry.company, entry.title, entry.reason]
    .map(sanitizeTsv)
    .join('\t');
  fs.appendFileSync(filePath, cols + '\n', 'utf8');
}
