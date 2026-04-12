const SUCCESS_TEXT = [
  /thank you for (applying|your application)/i,
  /application (has been )?received/i,
  /application (has been )?submitted/i,
  /we'll be in touch/i,
  /we will (be )?(in touch|contact you)/i,
  /your application is (complete|received)/i,
  /merci (pour|de) votre candidature/i,
  /candidature (bien )?(re[çc]ue|envoy[ée]e|enregistr[ée]e)/i,
  /nous reviendrons vers vous/i,
  /nous vous recontacterons/i,
];

const SUCCESS_URL = [
  /\/(thank[-_]?you|thanks|confirmation|success|submitted|complete)\b/i,
  /\/merci\b/i,
  /application[-_]?received/i,
];

const ERROR_TEXT = [
  /please (fix|correct|review)/i,
  /(is )?required/i,
  /invalid (email|phone|field)/i,
  /veuillez corriger/i,
  /champ obligatoire/i,
];

export function classifyTabContext(_tabContext) {
  return { status: 'Submitted (unconfirmed)', reason: 'not implemented' };
}

const PROBE_SUFFIXES = [
  '/thanks',
  '/thank-you',
  '/confirmation',
  '/submitted',
  '/merci',
  '/already-received',
];

export function suggestProbeUrls(baseUrl) {
  const stripped = baseUrl.replace(/[?#].*$/, '').replace(/\/+$/, '');
  return PROBE_SUFFIXES.map((suffix) => stripped + suffix);
}

export function classifyConfirmation({ beforeUrl, afterUrl, pageText }) {
  const text = pageText || '';
  if (SUCCESS_TEXT.some((r) => r.test(text)))
    return { status: 'Applied', reason: 'success text matched' };
  if (afterUrl && afterUrl !== beforeUrl && SUCCESS_URL.some((r) => r.test(afterUrl))) {
    return { status: 'Applied', reason: 'success url matched' };
  }
  if (ERROR_TEXT.some((r) => r.test(text)))
    return { status: 'Failed', reason: 'error text matched' };
  return { status: 'Submitted (unconfirmed)', reason: 'no pattern matched' };
}
