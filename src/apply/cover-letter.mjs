import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildLetterPrompt } from './letter-generator.mjs';

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

export async function renderLatex({
  body,
  company,
  role,
  candidateName,
  email,
  phone,
  date,
  outDir,
  outName,
  _spawnSync,
}) {
  const spawn = _spawnSync || spawnSync;
  fs.mkdirSync(outDir, { recursive: true });

  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const tex = template
    .replace(/<<CANDIDATE_NAME>>/g, escapeLatex(candidateName))
    .replace(/<<EMAIL>>/g, escapeLatex(email))
    .replace(/<<PHONE>>/g, escapeLatex(phone))
    .replace(/<<COMPANY>>/g, escapeLatex(company))
    .replace(/<<ROLE>>/g, escapeLatex(role))
    .replace(/<<DATE>>/g, escapeLatex(date))
    .replace(/<<BODY>>/g, escapeLatex(body));

  const texPath = path.join(outDir, `${outName}.tex`);
  fs.writeFileSync(texPath, tex);

  const proc = spawn(
    'pdflatex',
    ['-interaction=nonstopmode', `-output-directory=${outDir}`, texPath],
    {
      encoding: 'utf8',
      timeout: 30_000,
    }
  );

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

function slugify(str) {
  return (str || 'unknown')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export async function generateCoverLetter({
  company,
  role,
  jdText,
  language,
  cvMd,
  profile,
  outDir,
  _spawnSync,
}) {
  const spawn = _spawnSync || spawnSync;
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10);
  const slug = slugify(role);
  const companySlug = slugify(company);
  const outName = `${dateStr}_${companySlug}_${slug}`;

  const resolvedOutDir = outDir || path.join(process.cwd(), 'data', 'cover-letters');
  fs.mkdirSync(resolvedOutDir, { recursive: true });

  const prompt = buildLetterPrompt({
    company,
    role,
    language: language || 'en',
    jdText: jdText || '',
    candidateSummary: cvMd || '',
  });

  const emptyMcpPath = path.join(os.tmpdir(), 'claude-apply-empty-mcp.json');
  if (!fs.existsSync(emptyMcpPath)) {
    fs.writeFileSync(emptyMcpPath, '{"mcpServers":{}}');
  }

  const proc = spawn(
    'claude',
    [
      '-p',
      '--system-prompt',
      'You are a cover letter writer. Output ONLY the letter body text, no JSON.',
      '--disable-slash-commands',
      '--no-chrome',
      '--strict-mcp-config',
      '--mcp-config',
      emptyMcpPath,
      '--setting-sources',
      '',
      '--output-format',
      'json',
    ],
    {
      input: prompt,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      cwd: os.tmpdir(),
    }
  );

  if (proc.status !== 0) {
    throw new CoverLetterError(
      'LLM_GENERATION_FAILED',
      `claude -p failed (exit ${proc.status}): ${proc.stderr}`
    );
  }

  const parsed = JSON.parse(proc.stdout);
  const textContent = (parsed.result || '').trim();
  const usage = parsed.usage || {};

  const candidateName = `${profile.first_name} ${profile.last_name}`;
  const formattedDate = formatDate(date, language || 'en');

  const { pdfPath } = await renderLatex({
    body: textContent,
    company,
    role,
    candidateName,
    email: profile.email || '',
    phone: profile.phone || '',
    date: formattedDate,
    outDir: resolvedOutDir,
    outName,
    _spawnSync: spawn,
  });

  return { pdfPath, textContent, usage };
}
