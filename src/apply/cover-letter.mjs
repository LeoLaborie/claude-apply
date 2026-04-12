import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'templates', 'cover-letter.tex');

export class CoverLetterError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

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

export async function renderLatex({ body, company, role, candidateName, email, phone, date, outDir, outName }) {
  fs.mkdirSync(outDir, { recursive: true });

  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const tex = template
    .replace(/<<CANDIDATE_NAME>>/g, escapeLatex(candidateName))
    .replace(/<<EMAIL>>/g, escapeLatex(email))
    .replace(/<<PHONE>>/g, escapeLatex(phone))
    .replace(/<<COMPANY>>/g, escapeLatex(company))
    .replace(/<<ROLE>>/g, escapeLatex(role))
    .replace(/<<DATE>>/g, escapeLatex(date))
    .replace(/<<BODY>>/g, body);

  const texPath = path.join(outDir, `${outName}.tex`);
  fs.writeFileSync(texPath, tex);

  const proc = spawnSync('pdflatex', ['-interaction=nonstopmode', `-output-directory=${outDir}`, texPath], {
    encoding: 'utf8',
    timeout: 30_000,
  });

  const pdfPath = path.join(outDir, `${outName}.pdf`);
  if (proc.status !== 0 || !fs.existsSync(pdfPath)) {
    const log = proc.stdout || proc.stderr || 'no output';
    throw new CoverLetterError('LATEX_COMPILATION_FAILED', `pdflatex failed:\n${log}`);
  }

  for (const ext of ['.aux', '.log', '.out']) {
    const f = path.join(outDir, `${outName}${ext}`);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  return { pdfPath, texPath };
}
