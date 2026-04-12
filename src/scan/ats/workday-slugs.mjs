import fs from 'node:fs';

export function loadSlugRegistry(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}
