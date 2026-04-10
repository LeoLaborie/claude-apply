import fs from 'node:fs';
import path from 'node:path';

// 9-column TSV format for tracker additions.
// Column order:
// num, date, company, role, status, score, pdf, report, notes

export function writeTrackerTsv(dir, { num, date, company, role, score, notes }) {
  fs.mkdirSync(dir, { recursive: true });
  const slug = company
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const filePath = path.join(dir, `${num}-${slug}.tsv`);
  const reportLink = `[${num}](reports/${num}-${slug}-${date}.md)`;
  const line = [
    num,
    date,
    company,
    role,
    'Evaluated',
    `${score.toFixed(1)}/5`,
    '❌',
    reportLink,
    notes,
  ]
    .map((v) =>
      String(v ?? '')
        .replace(/[\t\r\n]+/g, ' ')
        // Replace pipe chars that would break markdown table formatting
        .replace(/\s*\|\s*/g, ' — ')
    )
    .join('\t');
  fs.writeFileSync(filePath, line + '\n', 'utf8');
  return filePath;
}
