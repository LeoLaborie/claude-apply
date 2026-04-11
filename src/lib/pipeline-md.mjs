// Parser, mutator, and writer for pipeline.md.
// Structure:
//   header     = everything before the first "## " line
//   sections[] = { company, location, lines[] }
// Insertion via appendOffer preserves manual curation (header + location).

import fs from 'node:fs';
import path from 'node:path';

const SECTION_RE = /^##\s+(?<company>.+?)(?:\s*\((?<location>[^)]+)\))?\s*$/;

export function parsePipelineMd(raw) {
  const lines = (raw || '').split('\n');
  const headerLines = [];
  const sections = [];
  let current = null;
  let sawSection = false;

  for (const line of lines) {
    const m = line.match(SECTION_RE);
    if (m) {
      sawSection = true;
      if (current) sections.push(current);
      current = {
        company: m.groups.company.trim(),
        location: (m.groups.location || '').trim(),
        lines: [],
      };
      continue;
    }
    if (!sawSection) {
      headerLines.push(line);
      continue;
    }
    // Inside a section: preserve ALL non-blank lines verbatim (checkboxes,
    // HTML comments, blockquotes, plain text notes — anything the user
    // manually added). Blank lines are dropped and re-emitted during
    // serialization for consistent spacing.
    if (line.trim() !== '') {
      current.lines.push(line.trimEnd());
    }
  }
  if (current) sections.push(current);

  // Trim trailing blank lines from header but keep \n\n separator
  let header = headerLines.join('\n');
  header = header.replace(/\s+$/, '') + '\n\n';

  return { header, sections };
}

export function serializePipelineMd(doc) {
  const parts = [doc.header];
  for (const s of doc.sections) {
    const loc = s.location ? ` (${s.location})` : '';
    parts.push(`## ${s.company}${loc}\n\n`);
    if (s.lines.length > 0) {
      parts.push(s.lines.join('\n') + '\n\n');
    }
  }
  let out = parts.join('');
  out = out.replace(/\n+$/, '\n');
  return out;
}

const CHECKBOX_RE = /^\s*-\s*\[[ xX]\]/;

export function appendOffer(doc, offer) {
  const line = `- [ ] ${offer.url} | ${offer.company} | ${offer.title}`;
  const existing = doc.sections.find(
    (s) => s.company.toLowerCase() === (offer.company || '').toLowerCase()
  );
  if (existing) {
    if (existing.lines.some((l) => l.includes(offer.url))) return;
    // Insert after the LAST checkbox line so new entries stay grouped with
    // existing checkboxes, and any trailing notes/comments remain at the end
    // of the section.
    let insertAt = existing.lines.length;
    for (let i = existing.lines.length - 1; i >= 0; i--) {
      if (CHECKBOX_RE.test(existing.lines[i])) {
        insertAt = i + 1;
        break;
      }
    }
    existing.lines.splice(insertAt, 0, line);
  } else {
    doc.sections.push({
      company: offer.company,
      location: offer.location || '',
      lines: [line],
    });
  }
}

export function writePipelineMd(filePath, doc) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, serializePipelineMd(doc), 'utf8');
  fs.renameSync(tmp, filePath);
}

export function readPipelineMd(filePath) {
  if (!fs.existsSync(filePath)) {
    const today = new Date().toISOString().slice(0, 10);
    return {
      header: `# Pipeline — Auto-scan ${today}\n\n`,
      sections: [],
    };
  }
  return parsePipelineMd(fs.readFileSync(filePath, 'utf8'));
}

const OFFER_LINE_RE = /^\s*-\s*\[[ xX]\]\s*(.+)$/;

export function parseOfferLine(line) {
  if (typeof line !== 'string') return null;
  const m = line.match(OFFER_LINE_RE);
  if (!m) return null;
  const parts = m[1].split('|').map((s) => s.trim());
  if (parts.length < 3) return null;
  const [url, company, title] = parts;
  if (!url || !company || !title) return null;
  return { url, company, title };
}
