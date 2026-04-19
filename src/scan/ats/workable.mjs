// Fetcher for Workable-hosted job boards.
// Endpoint: GET https://apply.workable.com/api/v1/widget/accounts/{slug}
// Widget payload is single-page on all probed boards (2026-04-19); no
// pagination field observed. If a future payload includes one, extend
// fetchWorkable to follow it.
// The public widget payload does not include job descriptions — Offer.body is left empty.

function formatLocation(job) {
  const parts = [job.city, job.country].filter((p) => p && String(p).trim());
  const base = parts.join(', ');
  if (job.telecommuting === true) {
    return base ? `Remote — ${base}` : 'Remote';
  }
  return base;
}

export async function fetchWorkable(slug, companyName) {
  const url = `https://apply.workable.com/api/v1/widget/accounts/${slug}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'claude-apply-scan/1.0' },
  });
  if (!res.ok) {
    throw new Error(`Workable API ${slug}: HTTP ${res.status}`);
  }
  const data = await res.json();
  const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
  return jobs.map((j) => ({
    url: j.url || j.shortlink || '',
    title: j.title || '',
    company: companyName,
    location: formatLocation(j),
    body: '',
    platform: 'workable',
  }));
}

export async function verifySlug(slug) {
  const url = `https://apply.workable.com/api/v1/widget/accounts/${slug}`;
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
