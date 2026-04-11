// Fetcher for Greenhouse-hosted job boards.
// Endpoint: GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
// Returns Offer[] conforming to the Offer contract.

const HTML_ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

export function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  // Decode HTML entities first so we can strip the resulting tags
  let out = html.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => HTML_ENTITIES[m] || m);
  out = out.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
  // Then strip real HTML tags
  out = out.replace(/<[^>]+>/g, '');
  return out;
}

export async function fetchGreenhouse(slug, companyName) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'claude-apply-scan/1.0' },
  });
  if (!res.ok) {
    throw new Error(`Greenhouse API ${slug}: HTTP ${res.status}`);
  }
  const data = await res.json();
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  return jobs.map((j) => ({
    url: j.absolute_url || '',
    title: j.title || '',
    company: companyName,
    location: j.location?.name || '',
    body: stripHtml(j.content || ''),
    platform: 'greenhouse',
  }));
}

export async function verifySlug(slug) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'claude-apply-verify/1.0' },
  });
  if (res.ok) {
    const data = await res.json();
    const count = Array.isArray(data?.jobs) ? data.jobs.length : 0;
    return { ok: true, count };
  }
  return { ok: false, status: res.status, reason: `HTTP ${res.status}` };
}
