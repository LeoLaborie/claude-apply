export function escapeLatex(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\/g, '\x00BACKSLASH\x00')
    .replace(/[&%$#_{}]/g, (ch) => `\\${ch}`)
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/\x00BACKSLASH\x00/g, '\\textbackslash{}');
}

export function formatDate(date, language) {
  const locale = language === 'fr' ? 'fr-FR' : 'en-US';
  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
