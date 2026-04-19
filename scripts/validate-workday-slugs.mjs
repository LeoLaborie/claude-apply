export function buildWorkdayUrl({ tenant, pod, slug } = {}) {
  if (!tenant) throw new Error('buildWorkdayUrl: missing tenant');
  if (!pod) throw new Error('buildWorkdayUrl: missing pod');
  if (!slug) throw new Error('buildWorkdayUrl: missing slug');
  return `https://${tenant}.${pod}.myworkdayjobs.com/${slug}`;
}
