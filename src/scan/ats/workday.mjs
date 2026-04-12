// Fetcher for Workday-hosted job boards.
// Endpoint: POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
// Returns Offer[] conforming to the Offer contract.

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
const DEFAULT_MAX_OFFERS = 200;

function buildJobUrl({ tenant, pod, site }, externalPath) {
  return `https://${tenant}.${pod}.myworkdayjobs.com/en-US/${site}${externalPath}`;
}

async function postJobs({ tenant, pod, site }, { limit, offset, searchText = '' }) {
  const url = `https://${tenant}.${pod}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'claude-apply-scan/1.0',
    },
    body: JSON.stringify({ appliedFacets: {}, limit, offset, searchText }),
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
  const maxOffers = opts.maxOffers ?? DEFAULT_MAX_OFFERS;
  const searchText = opts.searchText ?? '';
  const offers = [];
  let offset = 0;
  while (true) {
    const page = await postJobs(parts, { limit: pageSize, offset, searchText });
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
    if (offers.length >= maxOffers) {
      console.warn(
        `[workday] ${parts.tenant}/${parts.site}: stopped at ${offers.length} offers (maxOffers=${maxOffers})`
      );
      break;
    }
    offset += pageSize;
  }
  return offers;
}
