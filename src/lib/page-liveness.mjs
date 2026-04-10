// Detection of closed, expired, or broken job offer pages.
// Used by src/score/index.mjs (before calling Claude) to avoid burning tokens.

// Textual markers (FR/EN) appearing on closed job offer pages.
const CLOSED_BODY_MARKERS = [
  /this (job|position|role|opportunity|opening|posting) (is )?(no longer|has been) (available|accepting|filled|open)/i,
  /we are no longer accepting applications/i,
  /this position has been filled/i,
  /this job is closed/i,
  /position closed/i,
  /role has been filled/i,
  /job posting (has )?expired/i,
  /no longer recruiting/i,
  /not currently hiring/i,
  /no longer (taking|accepting) applications/i,
  /applications (are )?closed/i,
  /cette offre n['']est plus (disponible|d['']actualité|active)/i,
  /cette offre (a été )?(pourvue|clôturée|fermée|expirée)/i,
  /offre (pourvue|clôturée|fermée|expirée|cloturee)/i,
  /poste\s+(?:est\s+)?(?:déjà\s+)?pourvu/i,
  /recrutement (terminé|clôturé)/i,
  /l['']offre (n['']est plus disponible|a été retirée)/i,
  /candidatures closes/i,
  /n['']accepte plus de candidatures/i,
];

// Error / anti-bot page markers (HTML title + short body).
const ERROR_TITLE_MARKERS =
  /(404|page not found|not found|attention required|cloudflare|access denied|forbidden|sorry,? you have been blocked|error\s*4\d\d|error\s*5\d\d|just a moment)/i;

// Index/listing page markers (scraper landed on a list, not a specific offer).
const LISTING_TITLE_MARKERS =
  /^(jobs at |careers at |current openings|all jobs|job board|open positions|nos offres|toutes nos offres)/i;

// Generic corporate homepage markers (SPA didn't load the specific offer).
const GENERIC_HOMEPAGE_MARKERS = [
  /be the next game changer/i,
  /^careers?\s*[-|–]\s*\w+/i,
  /welcome to (our )?careers?/i,
  /join (our )?team/i,
  /we['']re hiring/i,
  /^(home|accueil)\s*[-|–]/i,
];

// Detects if the final URL (after redirects) suggests a fallback to homepage.
function isRedirectedToHome(originalUrl, finalUrl) {
  if (!originalUrl || !finalUrl || originalUrl === finalUrl) return false;
  try {
    const o = new URL(originalUrl);
    const f = new URL(finalUrl);
    if (o.host !== f.host) return true;
    const oDepth = o.pathname.split('/').filter(Boolean).length;
    const fDepth = f.pathname.split('/').filter(Boolean).length;
    if (oDepth >= 2 && fDepth <= oDepth - 2) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Detects if a scraped offer corresponds to a closed, broken, or non-relevant page.
 *
 * @param {object} offer - {url, finalUrl?, title, body, status?}
 * @returns {{closed: boolean, reason: string|null}}
 */
export function detectClosedPage(offer) {
  const { url = '', finalUrl = '', title = '', body = '', status } = offer;

  // 1. HTTP status code (if provided by fetchOffer)
  if (typeof status === 'number') {
    if (status === 404 || status === 410) {
      return { closed: true, reason: `HTTP ${status}` };
    }
    if (status >= 400 && status < 600) {
      return { closed: true, reason: `HTTP ${status}` };
    }
  }

  // 2. Title = error / anti-bot page
  if (ERROR_TITLE_MARKERS.test(title)) {
    return { closed: true, reason: `error page: "${title.slice(0, 60)}"` };
  }

  // 3. Title = listing page (not an individual offer)
  if (LISTING_TITLE_MARKERS.test(title.trim())) {
    return { closed: true, reason: `listing page: "${title.slice(0, 60)}"` };
  }

  // 4. Title = generic corporate homepage (SPA not hydrated or home redirect)
  for (const re of GENERIC_HOMEPAGE_MARKERS) {
    if (re.test(title)) {
      return { closed: true, reason: `generic homepage: "${title.slice(0, 60)}"` };
    }
  }

  // 5. Server redirect to parent page: the requested URL was a deep offer slug,
  //    the final URL is shorter → the offer no longer exists.
  if (finalUrl && isRedirectedToHome(url, finalUrl)) {
    return { closed: true, reason: `redirected to home: ${finalUrl.slice(0, 80)}` };
  }

  // 6. Very short body → empty page or JS-only unrendered content
  const bodyTrimmed = body.trim();
  if (bodyTrimmed.length < 400) {
    return { closed: true, reason: `body too short (${bodyTrimmed.length} chars)` };
  }

  // 7. Textual closure markers in body
  for (const re of CLOSED_BODY_MARKERS) {
    if (re.test(body)) {
      const match = body.match(re);
      return { closed: true, reason: `closed marker: "${match[0].slice(0, 60)}"` };
    }
  }

  return { closed: false, reason: null };
}
