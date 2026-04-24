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
const MAX_PAGES_PER_TERM = 50;
const WORKDAY_SEARCH_TERMS = ['Intern', 'Internship', 'Stage', 'Stagiaire', 'Apprenti'];

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
  const postings = Array.isArray(data?.jobPostings) ? data.jobPostings : [];
  const count = typeof data?.total === 'number' ? data.total : postings.length;
  return { ok: true, count };
}

export async function fetchWorkday(url, companyName, opts = {}) {
  const parts = parseWorkdayUrl(url);
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxOffers = opts.maxOffers ?? DEFAULT_MAX_OFFERS;
  const terms =
    Array.isArray(opts.searchTerms) && opts.searchTerms.length > 0
      ? opts.searchTerms
      : WORKDAY_SEARCH_TERMS;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

  const byUrl = new Map();
  const warnings = [];
  let capped = false;

  async function fetchAllPagesForTerm(searchText) {
    onProgress?.({ type: 'term_start', tenant: parts.tenant, term: searchText });
    let offset = 0;
    let pages = 0;
    let lastTotal = null;
    const seenPathsThisTerm = new Set();

    while (true) {
      if (byUrl.size >= maxOffers) break;
      if (lastTotal !== null && lastTotal > 0 && offset >= lastTotal) break;
      if (pages >= MAX_PAGES_PER_TERM) {
        warnings.push(
          `[workday] ${parts.tenant}/${parts.site}: term "${searchText}" hit page cap ` +
            `(${MAX_PAGES_PER_TERM} pages) — likely wrap-around`
        );
        break;
      }

      const page = await postJobs(parts, { limit: pageSize, offset, searchText });
      pages++;
      if (typeof page?.total === 'number' && page.total > 0 && lastTotal === null) {
        lastTotal = page.total;
      }

      const postings = Array.isArray(page?.jobPostings) ? page.jobPostings : [];
      let newInThisPage = 0;
      for (const p of postings) {
        const path = p.externalPath || '';
        if (seenPathsThisTerm.has(path)) continue;
        seenPathsThisTerm.add(path);
        newInThisPage++;

        const offerUrl = buildJobUrl(parts, path);
        if (!byUrl.has(offerUrl)) {
          byUrl.set(offerUrl, {
            url: offerUrl,
            title: p.title || '',
            company: companyName,
            location: p.locationsText || '',
            body: '',
            platform: 'workday',
          });
        }
        if (byUrl.size >= maxOffers) {
          capped = true;
          break;
        }
      }

      if (capped) break;
      if (postings.length < pageSize) break;
      if (newInThisPage === 0) break;
      offset += pageSize;
    }

    onProgress?.({
      type: 'term_done',
      tenant: parts.tenant,
      term: searchText,
      pages,
      total: byUrl.size,
    });
  }

  await Promise.all(terms.map(fetchAllPagesForTerm));

  if (capped) {
    warnings.push(
      `[workday] ${parts.tenant}/${parts.site}: stopped at ${byUrl.size} offers (maxOffers=${maxOffers})`
    );
  }

  return { offers: [...byUrl.values()], warnings };
}
