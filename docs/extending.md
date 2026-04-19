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
  const fixture = JSON.parse(
    readFileSync(new URL('../fixtures/example-acme.json', import.meta.url))
  );
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
  /grazie per la tua candidatura/i, // new
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

## Maintaining the Workday registry

`templates/known-workday-slugs.example.json` ships with ~30 pre-verified FR/EU Workday tenants. `scripts/setup.sh` copies it to `data/known-workday-slugs.json` on first run so `/apply-onboard:companies` step 4 can resolve companies whose Workday tenant name is not guessable from the company name (e.g. Renault → `alliancewd.wd3`, Airbus → `ag.wd3`).

### Adding an entry

Build a one-line TSV with `<company-name>\t<workday-url>` and merge it in:

```bash
printf "Decathlon\thttps://decathlon.wd3.myworkdayjobs.com/Decathlon_Careers\n" \
  | npm run workday:seed -- --merge
```

The script parses the URL, calls `verifyCompany`, and adds the entry to `templates/known-workday-slugs.example.json` if the board is live. Failures land in `/tmp/workday-unresolved.txt`.

### Re-validating the registry

Before a release — or whenever a user reports that a Workday slug returns 404 — re-verify every entry:

```bash
npm run workday:validate          # exit 1 if any entry is dead
npm run workday:validate -- --fix # rewrite the template with live entries only
```

Both subcommands call `verifyCompany` against each entry, with a 100 ms pause between calls and one retry on 5xx/network errors. Validation is intentionally **not** run in CI — it depends on live HTTP calls to third-party tenants and would make the build flaky.
