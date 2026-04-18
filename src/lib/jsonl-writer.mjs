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

export function updateJsonlEntry(filePath, matchFn, newObj) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');
  let previous = null;
  let matchedIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (matchFn(obj)) {
      previous = obj;
      matchedIdx = i;
      break;
    }
  }

  if (matchedIdx === -1) return null;

  lines[matchedIdx] = JSON.stringify(newObj);
  const output = lines.join('\n');
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, output, 'utf8');
  fs.renameSync(tmpPath, filePath);
  return previous;
}
