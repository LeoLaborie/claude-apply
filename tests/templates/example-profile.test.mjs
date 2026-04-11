import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProfile } from '../../src/lib/candidate-profile.schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..');

test('templates/candidate-profile.example.yml matches the schema', async () => {
  const yaml = await import('js-yaml');
  const raw = readFileSync(
    path.join(REPO_ROOT, 'templates', 'candidate-profile.example.yml'),
    'utf8'
  );
  const profile = yaml.load(raw);
  const { ok, errors } = validateProfile(profile);
  assert.equal(ok, true, `template fails validation: ${JSON.stringify(errors, null, 2)}`);
});
