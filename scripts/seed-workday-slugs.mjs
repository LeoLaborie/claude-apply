const WORKDAY_RE =
  /^https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)(?:\/|$)/i;

export function parseWorkdayUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(WORKDAY_RE);
  if (!m) return null;
  return { tenant: m[1].toLowerCase(), pod: m[2].toLowerCase(), slug: m[3] };
}
