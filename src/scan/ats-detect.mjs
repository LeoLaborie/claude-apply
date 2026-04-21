// Detect ATS platform and slug from a careers URL.
// Returns {platform, slug} or null if URL is not recognized.
// For Workday, also returns {canonicalUrl, hasLocale}.

const LOCALE_SEGMENT_RE = /\/[a-z]{2}-[A-Z]{2}(?=\/)/;

const PATTERNS = [
  { platform: 'lever', re: /^https?:\/\/jobs\.lever\.co\/([^\/?#]+)/i },
  { platform: 'greenhouse', re: /^https?:\/\/(?:job-boards|boards)\.greenhouse\.io\/([^\/?#]+)/i },
  { platform: 'ashby', re: /^https?:\/\/jobs\.ashbyhq\.com\/([^\/?#]+)/i },
  { platform: 'workable', re: /^https?:\/\/apply\.workable\.com\/([^\/?#]+)/i },
  {
    platform: 'workday',
    re: /^(https?:\/\/[^.]+\.wd\d+\.myworkdayjobs\.com(?:\/[a-z]{2}-[A-Z]{2})?\/[^\/?#]+)/i,
  },
];

export function detectPlatform(careersUrl) {
  if (!careersUrl || typeof careersUrl !== 'string') return null;
  for (const { platform, re } of PATTERNS) {
    const m = careersUrl.match(re);
    if (!m) continue;
    if (platform === 'workday') {
      const full = m[1];
      const hasLocale = LOCALE_SEGMENT_RE.test(full);
      const canonicalUrl = hasLocale ? full.replace(LOCALE_SEGMENT_RE, '') : full;
      return { platform, slug: full, canonicalUrl, hasLocale };
    }
    return { platform, slug: m[1] };
  }
  return null;
}

const VERIFIABLE_PLATFORMS = new Set(['lever', 'greenhouse', 'ashby', 'workable', 'workday']);

const SUPPORTED_HOSTS = [
  'https://jobs.lever.co/*',
  'https://boards.greenhouse.io/*',
  'https://job-boards.greenhouse.io/*',
  'https://jobs.ashbyhq.com/*',
  'https://apply.workable.com/*',
  'https://*.myworkdayjobs.com/*',
];

export function getSupportedHosts() {
  return [...SUPPORTED_HOSTS];
}

export async function verifyCompany(careersUrl) {
  const det = detectPlatform(careersUrl);
  if (!det) return { ok: false, reason: 'unknown platform' };
  const { platform, slug } = det;
  if (!VERIFIABLE_PLATFORMS.has(platform)) {
    return { ok: false, reason: `platform ${platform} not supported by verifySlug` };
  }
  const mod = await import(`./ats/${platform}.mjs`);
  const result = await mod.verifySlug(slug);
  const extras = {};
  if (det.hasLocale) {
    extras.warning = 'locale filter detected in URL; API scan returns all locales';
  } else if (result.ok && result.count === 0) {
    extras.warning = 'board live but empty — possibly wrong slug';
  }
  return { ...result, ...extras };
}
