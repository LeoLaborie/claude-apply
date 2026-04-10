const FR_MARKERS =
  /\b(stage|stagiaire|développeur|ingénieur|équipe|nous|vous|recherchons|rejoindre|française?|candidature)\b/gi;
const EN_MARKERS =
  /\b(internship|intern|engineer|developer|team|we|you|looking for|join|candidate|english)\b/gi;

export function detectLanguage({ title = '', description = '' } = {}) {
  const text = `${title} ${description}`;
  if (text.trim().length < 10) return 'fr';
  const fr = (text.match(FR_MARKERS) || []).length;
  const en = (text.match(EN_MARKERS) || []).length;
  const accents = (text.match(/[àâçéèêëîïôûùüÿœ]/gi) || []).length;
  const frScore = fr * 2 + accents;
  const enScore = en * 2;
  if (frScore > enScore) return 'fr';
  if (enScore > frScore) return 'en';
  return 'fr';
}
