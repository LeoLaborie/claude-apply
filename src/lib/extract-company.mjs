const PATTERNS = [
  { re: /^https?:\/\/(?:job-boards|boards)\.greenhouse\.io\/([^/?#]+)/i },
  { re: /^https?:\/\/jobs\.lever\.co\/([^/?#]+)/i },
  { re: /^https?:\/\/jobs\.ashbyhq\.com\/([^/?#]+)/i },
  { re: /^https?:\/\/([^.]+)\.wd\d+\.myworkdayjobs\.com\//i },
];

function formatSlug(slug) {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function extractCompanyFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  for (const { re } of PATTERNS) {
    const m = url.match(re);
    if (m && m[1]) return formatSlug(m[1]);
  }
  return null;
}
