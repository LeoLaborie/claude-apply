// Platform-aware dispatcher returning the offer description when available.
// Lever / Greenhouse / Ashby already populate offer.body in the listing.
// Workday's listing returns titles only; detail-fetch via a second POST per
// offer is out of scope for v1 — returns null with a one-shot warning.

const PLATFORMS_WITH_BODY = new Set(['lever', 'greenhouse', 'ashby']);

let warnedWorkday = false;

export function _resetWarnings() {
  warnedWorkday = false;
}

export async function fetchOfferBody(offer) {
  if (!offer || typeof offer !== 'object') return null;
  const platform = offer.platform;
  if (PLATFORMS_WITH_BODY.has(platform)) {
    const body = typeof offer.body === 'string' ? offer.body.trim() : '';
    return body.length > 0 ? body : null;
  }
  if (platform === 'workday') {
    if (!warnedWorkday) {
      process.stderr.write(
        '[fetchOfferBody] Workday detail-fetch not implemented; soft-match disabled for Workday offers\n',
      );
      warnedWorkday = true;
    }
    return null;
  }
  return null;
}
