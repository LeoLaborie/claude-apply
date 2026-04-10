import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  parsePipelineMd,
  serializePipelineMd,
  appendOffer,
  writePipelineMd,
} from '../../src/lib/pipeline-md.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const samplePath = path.join(__dirname, '../fixtures', 'pipeline-sample.md');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pmd-'));
afterEach(() => {
  for (const f of fs.readdirSync(tmp)) fs.unlinkSync(path.join(tmp, f));
});

test('parsePipelineMd — parse le fichier réel sans perdre de données', () => {
  const raw = fs.readFileSync(samplePath, 'utf8');
  const doc = parsePipelineMd(raw);
  assert.equal(typeof doc.header, 'string');
  assert.ok(doc.header.length > 0);
  assert.ok(Array.isArray(doc.sections));
  assert.ok(doc.sections.length > 0, 'au moins une section parsée');
  for (const s of doc.sections) {
    assert.equal(typeof s.company, 'string');
    assert.ok(s.company.length > 0);
    assert.ok(Array.isArray(s.lines));
  }
});

test('parsePipelineMd + serializePipelineMd — round-trip sémantique sur fichier réel', () => {
  const raw = fs.readFileSync(samplePath, 'utf8');
  const doc = parsePipelineMd(raw);
  const out = serializePipelineMd(doc);
  const reparsed = parsePipelineMd(out);
  assert.equal(reparsed.sections.length, doc.sections.length);
  for (let i = 0; i < doc.sections.length; i++) {
    assert.equal(reparsed.sections[i].company, doc.sections[i].company);
    assert.equal(reparsed.sections[i].lines.length, doc.sections[i].lines.length);
  }
});

test('appendOffer — ajoute à une section existante (case-insensitive)', () => {
  const doc = {
    header: '# Pipeline\n\n',
    sections: [{ company: 'Acme Corp', location: 'Paris', lines: ['- [ ] https://a.co/1 | Acme Corp | Old job'] }],
  };
  appendOffer(doc, {
    url: 'https://a.co/2',
    company: 'acme corp',   // lowercase — doit matcher
    title: 'New job',
    location: 'Paris',
  });
  assert.equal(doc.sections.length, 1);
  assert.equal(doc.sections[0].lines.length, 2);
  assert.ok(doc.sections[0].lines[1].includes('New job'));
});

test('appendOffer — crée une nouvelle section si company absente', () => {
  const doc = { header: '# Pipeline\n\n', sections: [] };
  appendOffer(doc, {
    url: 'https://a.co/1',
    company: 'Widgets Inc',
    title: 'Engineer',
    location: 'Remote',
  });
  assert.equal(doc.sections.length, 1);
  assert.equal(doc.sections[0].company, 'Widgets Inc');
  assert.equal(doc.sections[0].location, 'Remote');
  assert.equal(doc.sections[0].lines.length, 1);
});

test('appendOffer — skip silencieux si URL déjà présente dans la section', () => {
  const doc = {
    header: '# Pipeline\n\n',
    sections: [{ company: 'Acme Corp', location: '', lines: ['- [ ] https://a.co/1 | Acme Corp | X'] }],
  };
  appendOffer(doc, {
    url: 'https://a.co/1',
    company: 'Acme Corp',
    title: 'X',
    location: '',
  });
  assert.equal(doc.sections[0].lines.length, 1, 'pas de doublon');
});

test('appendOffer — préserve les commentaires HTML trailing dans une section', () => {
  const doc = {
    header: '# Pipeline\n\n',
    sections: [{
      company: 'Éliminés',
      location: '',
      lines: [
        '<!-- US Remote -->',
        '<!-- Widgets Inc US Remote x5 -->',
        '<!-- Acme Corp (SF), Foo Inc (SF) -->',
      ],
    }, {
      company: 'Beta Ltd',
      location: 'Paris',
      lines: [
        '- [ ] https://jobs.example.com/beta/existing | Beta Ltd | Old role',
        '<!-- note: verifier compliance -->',
      ],
    }],
  };
  appendOffer(doc, {
    url: 'https://jobs.example.com/beta/new',
    company: 'Beta Ltd',
    title: 'Software Engineer Internship',
    location: 'Paris',
  });
  // Beta Ltd section: new offer goes AFTER last checkbox, BEFORE the trailing comment
  assert.equal(doc.sections[1].lines.length, 3);
  assert.equal(doc.sections[1].lines[0], '- [ ] https://jobs.example.com/beta/existing | Beta Ltd | Old role');
  assert.ok(doc.sections[1].lines[1].includes('Internship'));
  assert.equal(doc.sections[1].lines[2], '<!-- note: verifier compliance -->');
  // Éliminés section untouched
  assert.equal(doc.sections[0].lines.length, 3);
  assert.ok(doc.sections[0].lines[0].startsWith('<!--'));
});

test('parsePipelineMd — préserve les commentaires HTML dans une section', () => {
  const raw = `# Pipeline\n\n## Éliminés\n\n<!-- US Remote -->\n<!-- Other note -->\n`;
  const doc = parsePipelineMd(raw);
  assert.equal(doc.sections.length, 1);
  assert.equal(doc.sections[0].company, 'Éliminés');
  assert.equal(doc.sections[0].lines.length, 2);
  assert.equal(doc.sections[0].lines[0], '<!-- US Remote -->');
  assert.equal(doc.sections[0].lines[1], '<!-- Other note -->');
  const out = serializePipelineMd(doc);
  const reparsed = parsePipelineMd(out);
  assert.deepEqual(reparsed.sections[0].lines, doc.sections[0].lines);
});

test('writePipelineMd — écriture atomique via .tmp + rename', () => {
  const p = path.join(tmp, 'pipeline.md');
  const doc = {
    header: '# Test\n\n',
    sections: [{ company: 'Acme Corp', location: 'Paris', lines: ['- [ ] https://a.co/1 | Acme Corp | Dev'] }],
  };
  writePipelineMd(p, doc);
  assert.ok(fs.existsSync(p));
  assert.equal(fs.existsSync(p + '.tmp'), false, '.tmp doit avoir été rename');
  const content = fs.readFileSync(p, 'utf8');
  assert.ok(content.includes('## Acme Corp (Paris)'));
  assert.ok(content.includes('- [ ] https://a.co/1'));
});
