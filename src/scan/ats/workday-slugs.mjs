import fs from 'node:fs';

export function loadSlugRegistry(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function normalizeKey(name) {
  return name.trim().toLowerCase().replace(/\s+/g, '');
}

export function lookupWorkdaySlug(registry, companyName) {
  const key = normalizeKey(companyName);
  const entry = registry[key];
  return entry ? { tenant: entry.tenant, pod: entry.pod, slug: entry.slug } : null;
}
