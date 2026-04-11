// Fetcher for Workday-hosted job boards.
// Endpoint: POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
// Returns Offer[] conforming to the Offer contract.

const WORKDAY_URL_RE =
  /^https?:\/\/([^.]+)\.(wd\d+)\.myworkdayjobs\.com\/([^\/?#]+)(?:\/|\?|#|$)/i;

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
