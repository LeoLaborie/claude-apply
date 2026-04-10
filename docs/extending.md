# Extending claude-apply

Two common extension points: **adding a new ATS scanner** and **extending the field classifier**.

## Adding a new ATS scanner

Say you want to scan `jobs.example.com/<slug>`.

### 1. Create a fetcher

`src/scan/ats/example.mjs`:

```js
export async function fetchExampleJobs(slug, { fetch = globalThis.fetch } = {}) {
  const res = await fetch(`https://jobs.example.com/api/v1/companies/${slug}/jobs`);
  if (!res.ok) throw new Error(`example: ${res.status}`);
  const data = await res.json();
  return data.jobs.map((job) => ({
    url: job.applyUrl,
    title: job.title,
    company: job.companyName,
    location: job.location,
    posted_at: job.postedAt,
  }));
}
```

The contract: return an array of `{ url, title, company, location, posted_at }`. Any extra fields are ignored.

### 2. Extend `ats-detect.mjs`

```js
import { fetchExampleJobs } from './ats/example.mjs';

const PATTERNS = [
  // ... existing entries
  { re: /^https?:\/\/jobs\.example\.com\/([\w-]+)/, platform: 'example' },
];

const FETCHERS = {
  lever: fetchLeverJobs,
  greenhouse: fetchGreenhouseJobs,
  ashby: fetchAshbyJobs,
  example: fetchExampleJobs,
};
```

### 3. Add a fixture and test

`tests/fixtures/example-acme.json` — a realistic sample response from the public API (strip PII if any).

`tests/scan/example.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchExampleJobs } from '../../src/scan/ats/example.mjs';

test('example: parses fixture', async () => {
  const fixture = JSON.parse(readFileSync(new URL('../fixtures/example-acme.json', import.meta.url)));
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => fixture });
  const jobs = await fetchExampleJobs('acme', { fetch: fakeFetch });
  assert.ok(jobs.length > 0);
  assert.ok(jobs.every((j) => j.url && j.title));
});
```

### 4. Document it

Add a row to [`docs/ats-support.md`](ats-support.md).

### 5. PR

Commit message: `feat(scan): add example ATS fetcher`.

## Extending the field classifier

`src/apply/field-classifier.mjs` is rule-based. Each rule is `{ key, when }` and the first matching rule wins.

To add a new class:

1. Pick a canonical key (e.g. `portfolio_pdf`).
2. Add a rule at the right priority:
   ```js
   { key: 'portfolio_pdf', when: (f) => f.type === 'file' && test_norm(/portfolio|work sample/, f.label, f.name) },
   ```
   Put it **before** the generic `cv_upload` fallback, otherwise a portfolio upload gets classified as a CV.
3. Add a unit test in `tests/apply/field-classifier.test.mjs` with a synthetic field.
4. Add an integration case if a real ATS form has this field — update `tests/fixtures/apply/<ats>-form.html` and `tests/apply/field-classifier-integration.test.mjs`.
5. Extend `mapProfileValue` if the new class maps to profile data.

## Extending the confirmation detector

`src/apply/confirmation-detector.mjs` uses regex lists. Adding a new success pattern is a one-liner:

```js
const SUCCESS_TEXT = [
  // ... existing
  /grazie per la tua candidatura/i,  // new
];
```

Always add a test case to `tests/apply/confirmation-detector.test.mjs` alongside the new pattern.

## Testing your changes

```bash
npm test                    # full suite
bash scripts/check-no-pii.sh  # PII gate
npm run lint                # prettier
```

If you add a dependency, prefer pure Node standard library. The only runtime deps currently shipped are `js-yaml` and `playwright` — new ones need a strong justification.
