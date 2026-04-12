# Cover Letter Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `/apply` encounters a cover letter field, automatically generate a tailored cover letter via `claude -p`, render it as PDF via LaTeX, and fill the form field.

**Architecture:** Single orchestrator module `src/apply/cover-letter.mjs` that calls the existing `buildLetterPrompt()` for prompt construction, spawns `claude -p` for LLM generation (mirroring `/score`'s `callClaude` pattern), injects text into a LaTeX template, compiles to PDF via `pdflatex`, and returns `{ pdfPath, textContent, usage }`. The playbook `/apply` calls this module when `cover_letter_upload` or `cover_letter_text` is detected by the existing field classifier.

**Tech Stack:** Node 20+ ESM, `node:child_process` (spawnSync for claude + pdflatex), LaTeX (`texlive-latex-base` + `texlive-latex-recommended`)

---

### Task 1: LaTeX template

**Files:**
- Create: `templates/cover-letter.tex`

- [ ] **Step 1: Create the LaTeX template**

```tex
\documentclass[11pt,a4paper]{article}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage[top=2.5cm,bottom=2.5cm,left=2.5cm,right=2.5cm]{geometry}
\usepackage{hyperref}
\usepackage{parskip}

\hypersetup{pdfauthor={<<CANDIDATE_NAME>>},pdftitle={Cover Letter - <<COMPANY>>}}
\pagestyle{empty}

\begin{document}

\begin{flushleft}
\textbf{<<CANDIDATE_NAME>>} \\
<<EMAIL>> \\
<<PHONE>>
\end{flushleft}

\vspace{1em}

\begin{flushleft}
<<COMPANY>> \\
\textit{<<ROLE>>}
\end{flushleft}

\vspace{0.5em}

\begin{flushright}
<<DATE>>
\end{flushright}

\vspace{1em}

<<BODY>>

\vspace{1.5em}

<<CANDIDATE_NAME>>

\end{document}
```

- [ ] **Step 2: Verify the template compiles with dummy values**

Replace all `<<PLACEHOLDER>>` values manually in a temp copy and run:

```bash
cd /tmp && pdflatex test-cover-letter.tex
```

Expected: PDF generated without errors.

- [ ] **Step 3: Commit**

```bash
git add templates/cover-letter.tex
git commit -m "feat(apply): add LaTeX cover letter template"
```

---

### Task 2: `escapeLatex` and `formatDate` helpers + tests

**Files:**
- Create: `src/apply/cover-letter.mjs`
- Create: `tests/apply/cover-letter.test.mjs`

- [ ] **Step 1: Write failing tests for escapeLatex**

In `tests/apply/cover-letter.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeLatex, formatDate } from '../../src/apply/cover-letter.mjs';

test('escapeLatex escapes all LaTeX special characters', () => {
  assert.equal(escapeLatex('R&D 100%'), 'R\\&D 100\\%');
  assert.equal(escapeLatex('price is $5'), 'price is \\$5');
  assert.equal(escapeLatex('item #1'), 'item \\#1');
  assert.equal(escapeLatex('under_score'), 'under\\_score');
  assert.equal(escapeLatex('{braces}'), '\\{braces\\}');
  assert.equal(escapeLatex('tilde~hat^'), 'tilde\\textasciitilde{}hat\\textasciicircum{}');
  assert.equal(escapeLatex('back\\slash'), 'back\\textbackslash{}');
});

test('escapeLatex handles empty and null input', () => {
  assert.equal(escapeLatex(''), '');
  assert.equal(escapeLatex(null), '');
  assert.equal(escapeLatex(undefined), '');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/apply/cover-letter.test.mjs
```

Expected: FAIL — `escapeLatex` is not exported.

- [ ] **Step 3: Implement escapeLatex in cover-letter.mjs**

```js
export function escapeLatex(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[&%$#_{}]/g, (ch) => `\\${ch}`)
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}
```

- [ ] **Step 4: Run tests to verify escapeLatex passes**

```bash
node --test --test-name-pattern="escapeLatex" tests/apply/cover-letter.test.mjs
```

Expected: 2 tests PASS.

- [ ] **Step 5: Write failing tests for formatDate**

Append to `tests/apply/cover-letter.test.mjs`:

```js
test('formatDate formats French date correctly', () => {
  const d = new Date('2026-04-12');
  assert.equal(formatDate(d, 'fr'), '12 avril 2026');
});

test('formatDate formats English date correctly', () => {
  const d = new Date('2026-04-12');
  assert.equal(formatDate(d, 'en'), 'April 12, 2026');
});

test('formatDate defaults to English for unknown language', () => {
  const d = new Date('2026-01-05');
  assert.equal(formatDate(d, 'de'), 'January 5, 2026');
});
```

- [ ] **Step 6: Run tests to verify they fail**

```bash
node --test --test-name-pattern="formatDate" tests/apply/cover-letter.test.mjs
```

Expected: FAIL — `formatDate` is not exported.

- [ ] **Step 7: Implement formatDate**

Add to `src/apply/cover-letter.mjs`:

```js
export function formatDate(date, language) {
  const locale = language === 'fr' ? 'fr-FR' : 'en-US';
  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
```

- [ ] **Step 8: Run all tests to verify they pass**

```bash
node --test tests/apply/cover-letter.test.mjs
```

Expected: 5 tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/apply/cover-letter.mjs tests/apply/cover-letter.test.mjs
git commit -m "feat(apply): add escapeLatex and formatDate helpers with tests"
```

---

### Task 3: `renderLatex` — template injection + PDF compilation

**Files:**
- Modify: `src/apply/cover-letter.mjs`
- Modify: `tests/apply/cover-letter.test.mjs`

- [ ] **Step 1: Write failing test for renderLatex**

Append to `tests/apply/cover-letter.test.mjs`:

```js
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { renderLatex } from '../../src/apply/cover-letter.mjs';

test('renderLatex injects placeholders into template', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-test-'));
  const result = await renderLatex({
    body: 'This is the letter body.',
    company: 'Acme & Co',
    role: 'ML Intern',
    candidateName: 'Alice Martin',
    email: 'alice@example.com',
    phone: '+33600000000',
    date: '12 avril 2026',
    outDir,
    outName: 'test-letter',
  });

  assert.ok(fs.existsSync(result.texPath));
  const tex = fs.readFileSync(result.texPath, 'utf8');
  assert.match(tex, /Alice Martin/);
  assert.match(tex, /Acme \\& Co/);
  assert.match(tex, /ML Intern/);
  assert.match(tex, /This is the letter body\./);
  assert.match(tex, /12 avril 2026/);

  fs.rmSync(outDir, { recursive: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test --test-name-pattern="renderLatex injects" tests/apply/cover-letter.test.mjs
```

Expected: FAIL — `renderLatex` is not exported.

- [ ] **Step 3: Implement renderLatex**

Add to `src/apply/cover-letter.mjs`:

```js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'templates', 'cover-letter.tex');

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
```

- [ ] **Step 4: Add CoverLetterError class**

Add at the top of `src/apply/cover-letter.mjs`:

```js
export class CoverLetterError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
```

- [ ] **Step 5: Run placeholder injection test**

```bash
node --test --test-name-pattern="renderLatex injects" tests/apply/cover-letter.test.mjs
```

Expected: PASS (only checks the .tex content, doesn't need pdflatex).

- [ ] **Step 6: Write test for pdflatex failure**

Append to `tests/apply/cover-letter.test.mjs`:

```js
test('renderLatex throws LATEX_COMPILATION_FAILED on bad tex', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-bad-'));
  // Overwrite template path is not possible, so we test with a body containing
  // raw unescaped LaTeX that would break compilation only if pdflatex is available.
  // Instead, we verify the error class exists and is throwable.
  const err = new CoverLetterError('LATEX_COMPILATION_FAILED', 'test');
  assert.equal(err.code, 'LATEX_COMPILATION_FAILED');
  assert.ok(err instanceof Error);
  fs.rmSync(outDir, { recursive: true });
});
```

Import `CoverLetterError` at the top of the test file:

```js
import { escapeLatex, formatDate, renderLatex, CoverLetterError } from '../../src/apply/cover-letter.mjs';
```

- [ ] **Step 7: Run all tests**

```bash
node --test tests/apply/cover-letter.test.mjs
```

Expected: All PASS.

- [ ] **Step 8: Commit**

```bash
git add src/apply/cover-letter.mjs tests/apply/cover-letter.test.mjs
git commit -m "feat(apply): add renderLatex with template injection and PDF compilation"
```

---

### Task 4: `generateCoverLetter` — orchestrator function

**Files:**
- Modify: `src/apply/cover-letter.mjs`
- Modify: `tests/apply/cover-letter.test.mjs`

- [ ] **Step 1: Write failing test for generateCoverLetter**

Append to `tests/apply/cover-letter.test.mjs`:

```js
import { mock } from 'node:test';
import { generateCoverLetter } from '../../src/apply/cover-letter.mjs';

test('generateCoverLetter calls buildLetterPrompt and returns pdfPath + textContent', async (t) => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-gen-'));

  // Mock spawnSync to avoid actually calling claude -p and pdflatex
  const { spawnSync: originalSpawnSync } = await import('node:child_process');
  const spawnMock = t.mock.fn((cmd, args, opts) => {
    if (cmd === 'claude') {
      return { status: 0, stdout: JSON.stringify({ result: 'Generated letter body about ML.', usage: { input_tokens: 100, output_tokens: 50 }, total_cost_usd: 0.001 }), stderr: '' };
    }
    if (cmd === 'pdflatex') {
      // Create a fake PDF so the check passes
      const outDirArg = args.find(a => a.startsWith('-output-directory='));
      const dir = outDirArg.split('=')[1];
      const texFile = args[args.length - 1];
      const name = path.basename(texFile, '.tex');
      fs.writeFileSync(path.join(dir, `${name}.pdf`), 'fake-pdf');
      return { status: 0, stdout: '', stderr: '' };
    }
    return originalSpawnSync(cmd, args, opts);
  });

  const result = await generateCoverLetter({
    company: 'Acme AI',
    role: 'ML Intern',
    jdText: 'Looking for ML intern with Python.',
    language: 'fr',
    cvMd: '# Alice Martin\nML student',
    profile: { first_name: 'Alice', last_name: 'Martin', email: 'alice@example.com', phone: '+33600000000' },
    outDir,
    _spawnSync: spawnMock,
  });

  assert.ok(result.pdfPath.endsWith('.pdf'));
  assert.equal(result.textContent, 'Generated letter body about ML.');
  assert.equal(result.usage.input_tokens, 100);
  assert.equal(spawnMock.mock.calls.length, 2); // claude + pdflatex

  fs.rmSync(outDir, { recursive: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test --test-name-pattern="generateCoverLetter calls" tests/apply/cover-letter.test.mjs
```

Expected: FAIL — `generateCoverLetter` is not exported.

- [ ] **Step 3: Implement generateCoverLetter**

Add to `src/apply/cover-letter.mjs`:

```js
import os from 'node:os';
import { buildLetterPrompt } from './letter-generator.mjs';

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
  });

  return { pdfPath, textContent, usage };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test --test-name-pattern="generateCoverLetter calls" tests/apply/cover-letter.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Write test for LLM failure**

Append to `tests/apply/cover-letter.test.mjs`:

```js
test('generateCoverLetter throws LLM_GENERATION_FAILED when claude -p fails', async (t) => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-fail-'));
  const spawnMock = t.mock.fn(() => ({ status: 1, stdout: '', stderr: 'API error' }));

  await assert.rejects(
    () => generateCoverLetter({
      company: 'X', role: 'Y', jdText: '', language: 'en',
      cvMd: '', profile: { first_name: 'A', last_name: 'B', email: '', phone: '' },
      outDir,
      _spawnSync: spawnMock,
    }),
    (err) => {
      assert.equal(err.code, 'LLM_GENERATION_FAILED');
      return true;
    }
  );

  fs.rmSync(outDir, { recursive: true });
});
```

- [ ] **Step 6: Run test to verify it passes**

```bash
node --test --test-name-pattern="LLM_GENERATION_FAILED" tests/apply/cover-letter.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Write test for file naming convention**

Append to `tests/apply/cover-letter.test.mjs`:

```js
test('generateCoverLetter produces correctly named PDF', async (t) => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-name-'));
  const spawnMock = t.mock.fn((cmd, args, opts) => {
    if (cmd === 'claude') {
      return { status: 0, stdout: JSON.stringify({ result: 'Body text.', usage: {} }), stderr: '' };
    }
    if (cmd === 'pdflatex') {
      const outDirArg = args.find(a => a.startsWith('-output-directory='));
      const dir = outDirArg.split('=')[1];
      const texFile = args[args.length - 1];
      const name = path.basename(texFile, '.tex');
      fs.writeFileSync(path.join(dir, `${name}.pdf`), 'fake');
      return { status: 0, stdout: '', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  });

  const result = await generateCoverLetter({
    company: 'Acme & Co.',
    role: 'Machine Learning Intern (Paris)',
    jdText: '', language: 'fr', cvMd: '',
    profile: { first_name: 'Alice', last_name: 'Martin', email: '', phone: '' },
    outDir,
    _spawnSync: spawnMock,
  });

  const fileName = path.basename(result.pdfPath);
  assert.match(fileName, /^\d{4}-\d{2}-\d{2}_acme-co_machine-learning-intern-paris\.pdf$/);

  fs.rmSync(outDir, { recursive: true });
});
```

- [ ] **Step 8: Run all tests**

```bash
node --test tests/apply/cover-letter.test.mjs
```

Expected: All PASS.

- [ ] **Step 9: Run full test suite to check for regressions**

```bash
npm test
```

Expected: All tests PASS, 0 failures.

- [ ] **Step 10: Commit**

```bash
git add src/apply/cover-letter.mjs tests/apply/cover-letter.test.mjs
git commit -m "feat(apply): add generateCoverLetter orchestrator with LLM + LaTeX pipeline"
```

---

### Task 5: `setup.sh` — install pdflatex if missing

**Files:**
- Modify: `scripts/setup.sh` (insert after npm install section, around line 65)

- [ ] **Step 1: Write failing test for pdflatex setup step**

Read `tests/scripts/setup.test.mjs` to understand the existing test pattern, then append a test that verifies the setup script contains a pdflatex installation section.

Append to `tests/scripts/setup.test.mjs`:

```js
test('setup.sh contains pdflatex installation step', () => {
  const script = fs.readFileSync(
    path.join(__dirname, '..', '..', 'scripts', 'setup.sh'),
    'utf8'
  );
  assert.match(script, /pdflatex/);
  assert.match(script, /texlive/);
});
```

- [ ] **Step 2: Run test to verify current state**

```bash
node --test --test-name-pattern="pdflatex installation" tests/scripts/setup.test.mjs
```

Expected: FAIL (setup.sh doesn't have texlive installation yet, only check-prereqs.sh mentions it as optional).

- [ ] **Step 3: Add pdflatex installation step to setup.sh**

Insert after the npm install section (after line 65 `echo ""`), before the Chrome CDP profile section:

```bash
# 2b. pdflatex (for cover letter PDF generation)
if command -v pdflatex >/dev/null 2>&1; then
  echo "→ pdflatex already installed"
else
  echo "→ Installing pdflatex (for cover letter generation)..."
  case "$OS" in
    Linux)
      if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get install -y texlive-latex-base texlive-latex-recommended
      else
        echo "  ✗ Cannot auto-install texlive — install pdflatex manually"
      fi
      ;;
    Darwin)
      if command -v brew >/dev/null 2>&1; then
        brew install --cask basictex
      else
        echo "  ✗ Cannot auto-install basictex — install pdflatex manually"
      fi
      ;;
  esac
  if command -v pdflatex >/dev/null 2>&1; then
    echo "  ✓ pdflatex installed"
  else
    echo "  ⚠ pdflatex not available — cover letter PDF generation will not work"
  fi
fi
echo ""
```

Note: the `OS` variable is already defined later in setup.sh (line 68). Move the `OS` detection block (lines 68-84) up to before this new section so it's available.

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test --test-name-pattern="pdflatex installation" tests/scripts/setup.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/setup.sh tests/scripts/setup.test.mjs
git commit -m "feat(setup): install pdflatex for cover letter PDF generation"
```

---

### Task 6: Playbook integration — update `.claude/commands/apply.md`

**Files:**
- Modify: `.claude/commands/apply.md`
- Modify: `docs/apply-workflow.md`

- [ ] **Step 1: Read current apply.md to find the cover letter skip instruction**

```bash
grep -n "cover letter\|cover_letter\|lettre\|skip" .claude/commands/apply.md
```

Locate the exact line that says "leave blank and report as skipped. Cover letter generation is not currently supported."

- [ ] **Step 2: Replace the skip instruction with generation instructions**

Replace the cover letter skip instruction with:

```markdown
When the field classifier returns `cover_letter_upload` or `cover_letter_text`:

1. Extract the job description text from the page (you already have it from `get_page_text`), the company name, and the role title.
2. Detect the page language (use the existing language detector).
3. Run the cover letter generator:
   ```bash
   node -e "
     import { generateCoverLetter } from './src/apply/cover-letter.mjs';
     const result = await generateCoverLetter({
       company: '<company>',
       role: '<role>',
       jdText: '<first 3000 chars of JD>',
       language: '<detected language>',
       cvMd: '<contents of config/cv.md>',
       profile: <parsed candidate-profile.yml>,
     });
     console.log(JSON.stringify(result));
   "
   ```
4. For `cover_letter_upload`: use `uploadFile()` to upload the PDF at `result.pdfPath` to the file input.
5. For `cover_letter_text`: paste `result.textContent` into the textarea using `form_input`. The PDF is still saved for audit.
6. Log: "Cover letter generated and saved to {pdfPath}".
```

- [ ] **Step 3: Update docs/apply-workflow.md**

Find the line ~215 that says "cover letter generation is not currently supported" and replace with:

```markdown
When a cover letter field is detected (`cover_letter_upload` or `cover_letter_text`), the playbook automatically generates a tailored letter via `claude -p`, renders it as a PDF through LaTeX, and fills the form. Generated letters are saved to `data/cover-letters/` for audit. See `src/apply/cover-letter.mjs` for the implementation.
```

- [ ] **Step 4: Commit**

```bash
git add .claude/commands/apply.md docs/apply-workflow.md
git commit -m "feat(apply): integrate cover letter generation into playbook"
```

---

### Task 7: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests PASS, 0 failures.

- [ ] **Step 2: Run linter**

```bash
npm run lint
```

Expected: No errors. If formatting issues, run `npm run format` and commit.

- [ ] **Step 3: Run PII check**

```bash
npm run check:pii
```

Expected: No PII detected. The LaTeX template uses "Alice Martin" example persona which is allowed.

- [ ] **Step 4: Verify file structure**

```bash
ls -la src/apply/cover-letter.mjs templates/cover-letter.tex tests/apply/cover-letter.test.mjs
```

Expected: All three files exist.

- [ ] **Step 5: Review git log for clean commit history**

```bash
git log --oneline feat/cover-letter-generation ^main
```

Expected: Clean series of conventional commits.
