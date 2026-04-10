import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyField } from '../../src/apply/field-classifier.mjs';

function parseFormFields(html) {
  const fields = [];
  const labelMap = new Map();
  for (const m of html.matchAll(/<label[^>]*for="([^"]+)"[^>]*>([^<]+)<\/label>/gi)) {
    labelMap.set(m[1], m[2].trim());
  }
  const tagRe = /<(input|textarea|select)\b([^>]*?)(?:\/?>|>)/gi;
  for (const m of html.matchAll(tagRe)) {
    const tag = m[1].toLowerCase();
    const raw = m[2];
    const attrs = Object.fromEntries(
      [...raw.matchAll(/([\w-\[\]]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])
    );
    const id = attrs.id || '';
    fields.push({
      name: attrs.name || '',
      id,
      label: labelMap.get(id) || '',
      type: attrs.type || (tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : 'text'),
      required: 'required' in attrs || raw.includes('required'),
    });
  }
  return fields;
}

for (const ats of ['greenhouse', 'lever', 'ashby']) {
  test(`${ats} form: critical fields classified`, () => {
    const html = readFileSync(new URL(`../fixtures/apply/${ats}-form.html`, import.meta.url), 'utf8');
    const fields = parseFormFields(html);
    const classes = new Set(fields.map(classifyField));
    assert.ok(classes.has('email'), `missing email in ${[...classes].join(',')}`);
    assert.ok(classes.has('cv_upload'), `missing cv_upload in ${[...classes].join(',')}`);
    // Name handling: greenhouse splits first/last, lever/ashby use full name
    const hasName = classes.has('first_name') || classes.has('last_name') || classes.has('full_name');
    assert.ok(hasName, `missing any name field in ${[...classes].join(',')}`);
  });
}
