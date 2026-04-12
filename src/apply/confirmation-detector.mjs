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

const ALREADY_RECEIVED_URL = /\/already-received\b/i;

const TAB_TITLE_SUCCESS = [
  /thank you for (applying|your application)/i,
  /application (has been )?(received|submitted)/i,
  /your application is (complete|received)/i,
  /merci (pour|de) votre candidature/i,
  /candidature (bien )?(re[çc]ue|envoy[ée]e|enregistr[ée]e)/i,
];

const ERROR_TEXT = [
  /please (fix|correct|review)/i,
  /(is )?required/i,
  /invalid (email|phone|field)/i,
  /veuillez corriger/i,
  /champ obligatoire/i,
];

export function classifyTabContext({ url, title }) {
  if (url && ALREADY_RECEIVED_URL.test(url))
    return { status: 'Applied', reason: 'tab context: already-received url' };
  if (url && SUCCESS_URL.some((r) => r.test(url)))
    return { status: 'Applied', reason: 'tab context: success url matched' };
  const t = title || '';
  if (TAB_TITLE_SUCCESS.some((r) => r.test(t)))
    return { status: 'Applied', reason: 'tab context: title matched' };
  return {
    status: 'Submitted (unconfirmed)',
    reason: 'tab context: no pattern matched',
  };
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
