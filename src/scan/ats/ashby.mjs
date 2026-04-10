// Fetcher for Ashby-hosted job boards.
// Endpoint: GET https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=false

export async function fetchAshby(slug, companyName) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=false`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'claude-apply-scan/1.0' },
  });
  if (!res.ok) {
    throw new Error(`Ashby API ${slug}: HTTP ${res.status}`);
  }
  const data = await res.json();
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  return jobs.map((j) => ({
    url: j.jobUrl || '',
    title: j.title || '',
    company: companyName,
    location: j.location || '',
    body: j.descriptionPlain || '',
    platform: 'ashby',
  }));
}
