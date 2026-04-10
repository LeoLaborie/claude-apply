// Fetcher for Lever-hosted job boards.
// Endpoint: GET https://api.lever.co/v0/postings/{slug}?mode=json
// Returns Offer[] conforming to the Offer contract.

export async function fetchLever(slug, companyName) {
  const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'claude-apply-scan/1.0' },
  });
  if (!res.ok) {
    throw new Error(`Lever API ${slug}: HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error(`Lever API ${slug}: expected array, got ${typeof data}`);
  }
  return data.map((p) => ({
    url: p.hostedUrl || '',
    title: p.text || '',
    company: companyName,
    location: p.categories?.location || '',
    body: p.descriptionPlain || '',
    platform: 'lever',
  }));
}
