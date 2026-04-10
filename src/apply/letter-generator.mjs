const MAX_JD_CHARS = 3000;

export function buildLetterPrompt({ company, role, language, jdText, candidateSummary }) {
  const jd = (jdText || '').slice(0, MAX_JD_CHARS);
  const langInstruction = language === 'en'
    ? 'Write the cover letter in English, formal register, 3 paragraphs, ~250 words.'
    : 'Rédige la lettre de motivation en français, registre soutenu, 3 paragraphes, ~250 mots.';

  return [
    `You are writing a cover letter for a job application.`,
    ``,
    `Company: ${company}`,
    `Role: ${role}`,
    ``,
    `Candidate summary:`,
    candidateSummary || '(see candidate profile for full details)',
    ``,
    `Job description excerpt:`,
    jd,
    ``,
    langInstruction,
    `Connect 2-3 specific candidate experiences to the role requirements. Do NOT invent experiences not listed in the candidate summary.`,
    `Output ONLY the letter body (no greeting block, no signature — those are added by the LaTeX template).`,
  ].join('\n');
}
