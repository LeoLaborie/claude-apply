export const STEP_SIGNATURES = [
  {
    step: 'my-information',
    urlPattern: /\/myInformation\b/i,
    domMarkers: ['myInformation-SectionTitle'],
  },
  {
    step: 'my-experience',
    urlPattern: /\/myExperience\b/i,
    domMarkers: ['myExperience-SectionTitle'],
  },
  {
    step: 'voluntary-disclosures',
    urlPattern: /\/voluntaryDisclosures\b/i,
    domMarkers: ['voluntaryDisclosures-SectionTitle'],
  },
  {
    step: 'self-identify',
    urlPattern: /\/selfIdentify\b/i,
    domMarkers: ['selfIdentify-SectionTitle'],
  },
  {
    step: 'review',
    urlPattern: /\/review\b/i,
    domMarkers: ['review-SectionTitle'],
  },
];

export function detectStep({ url, domMarkers }) {
  for (const sig of STEP_SIGNATURES) {
    if (url && sig.urlPattern.test(url)) return sig.step;
  }
  for (const sig of STEP_SIGNATURES) {
    if (sig.domMarkers.some((m) => domMarkers.includes(m))) return sig.step;
  }
  return 'generic';
}
