// Detect ATS platform and slug from a careers URL.
// Returns {platform, slug} or null if URL is not recognized.

const PATTERNS = [
  { platform: 'lever', re: /^https?:\/\/jobs\.lever\.co\/([^\/?#]+)/i },
  { platform: 'greenhouse', re: /^https?:\/\/(?:job-boards|boards)\.greenhouse\.io\/([^\/?#]+)/i },
  { platform: 'ashby', re: /^https?:\/\/jobs\.ashbyhq\.com\/([^\/?#]+)/i },
  { platform: 'workable', re: /^https?:\/\/apply\.workable\.com\/([^\/?#]+)/i },
];

export function detectPlatform(careersUrl) {
  if (!careersUrl || typeof careersUrl !== 'string') return null;
  for (const { platform, re } of PATTERNS) {
    const m = careersUrl.match(re);
    if (m) return { platform, slug: m[1] };
  }
  return null;
}
