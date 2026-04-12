// Fetcher for Workday-hosted job boards.
// Endpoint: POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
// Returns Offer[] conforming to the Offer contract.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY = JSON.parse(readFileSync(join(__dirname, 'workday-registry.json'), 'utf8'));
const REGISTRY_BY_TENANT = new Map(REGISTRY.map((e) => [e.tenant, e]));

export function lookupRegistry(tenant) {
  if (typeof tenant !== 'string') return null;
  return REGISTRY_BY_TENANT.get(tenant.toLowerCase()) ?? null;
}

const WORKDAY_URL_RE =
  /^https?:\/\/([^.]+)\.(wd\d+)\.myworkdayjobs\.com(?:\/[a-z]{2}-[A-Z]{2})?\/([^\/?#]+)(?:\/|\?|#|$)/i;

export function parseWorkdayUrl(url) {
  if (typeof url !== 'string') {
    throw new Error('parseWorkdayUrl: not a Workday URL (input is not a string)');
  }
  const m = url.match(WORKDAY_URL_RE);
  if (!m) {
    throw new Error(`parseWorkdayUrl: not a Workday URL: ${url}`);
  }
  return { tenant: m[1].toLowerCase(), pod: m[2].toLowerCase(), site: m[3] };
}

const DEFAULT_PAGE_SIZE = 20;

function buildJobUrl({ tenant, pod, site }, externalPath) {
  return `https://${tenant}.${pod}.myworkdayjobs.com/en-US/${site}${externalPath}`;
}

async function postJobs({ tenant, pod, site }, { limit, offset }) {
  const url = `https://${tenant}.${pod}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'claude-apply-scan/1.0',
    },
    body: JSON.stringify({ appliedFacets: {}, limit, offset, searchText: '' }),
  });
  if (!res.ok) {
    throw new Error(`Workday API ${tenant}/${site}: HTTP ${res.status}`);
  }
  return res.json();
}

export async function verifySlug(url) {
  let parts;
  try {
    parts = parseWorkdayUrl(url);
  } catch (err) {
    return { ok: false, reason: err.message };
  }
  const endpoint = `https://${parts.tenant}.${parts.pod}.myworkdayjobs.com/wday/cxs/${parts.tenant}/${parts.site}/jobs`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'claude-apply-verify/1.0',
    },
    body: JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: '' }),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, reason: `HTTP ${res.status}` };
  }
  const data = await res.json();
  const count = Array.isArray(data?.jobPostings) ? data.jobPostings.length : 0;
  return { ok: true, count };
}

export async function fetchWorkday(url, companyName, opts = {}) {
  const parts = parseWorkdayUrl(url);
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const offers = [];
  let offset = 0;
  while (true) {
    const page = await postJobs(parts, { limit: pageSize, offset });
    const postings = Array.isArray(page?.jobPostings) ? page.jobPostings : [];
    for (const p of postings) {
      offers.push({
        url: buildJobUrl(parts, p.externalPath || ''),
        title: p.title || '',
        company: companyName,
        location: p.locationsText || '',
        body: '',
        platform: 'workday',
      });
    }
    if (postings.length < pageSize) break;
    offset += pageSize;
  }
  return offers;
}
