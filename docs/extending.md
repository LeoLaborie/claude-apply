# Extending claude-apply

Two common extension points: **adding a new ATS scanner** and **extending the field classifier**.

## Adding a new ATS scanner

The canonical worked example is Workable (added in issue #83). Follow this pattern exactly.

### 1. Find the public API

Probe the ATS manually to find an unauthenticated JSON endpoint. For Workable, a curl against a known board reveals the widget API:

```bash
curl -s "https://apply.workable.com/api/v1/widget/accounts/huggingface" | python3 -m json.tool
# → { "name": "Hugging Face", "description": "...", "jobs": [...] }
```

Key questions to answer before writing code:

- What is the exact endpoint URL? (do **not** trust issue descriptions without verifying)
- Does the response include job descriptions? (Workable's does not — `body` is left empty)
- Is there pagination? (probe large boards; Workable has none as of 2026-04-19)

### 2. Write the fetcher

Create `src/scan/ats/<name>.mjs` exporting exactly two functions:

```js
export async function fetchWorkable(slug, companyName)  // → Offer[]
export async function verifySlug(slug)                  // → { ok, count } | { ok, status, reason }
```

The `Offer` shape: `{ url, title, company, location, body, platform }`. `body` may be empty. See `src/scan/ats/workable.mjs` for the complete reference implementation.

Use `User-Agent: 'claude-apply-scan/1.0'` in `fetchX` and `'claude-apply-verify/1.0'` in `verifySlug`. Throw a typed error on non-2xx: `new Error(\`Workable API ${slug}: HTTP ${res.status}\`)`.

### 3. Wire into three files

**`src/scan/ats-detect.mjs`** — two additions:

```js
const VERIFIABLE_PLATFORMS = new Set(['lever', 'greenhouse', 'ashby', 'workable', 'workday']);

const SUPPORTED_HOSTS = [
  // existing entries...
  'https://apply.workable.com/*',
  // ...
];
```

The regex in `PATTERNS` may already exist (Workable was pre-wired). Check before adding.

**`src/scan/discover-company.mjs`** — four additions:

```js
import { verifySlug as verifyWorkable } from './ats/workable.mjs';

const VERIFIERS = { ..., workable: verifyWorkable };
const CAREERS_URL = { ..., workable: (slug) => `https://apply.workable.com/${slug}` };

// Inside slugCandidates, add a branch:
} else if (platform === 'workable') {
  extras.add(`${b}-careers`);
  extras.add(`${b}hq`);
  extras.add(`${b}-hq`);
}

// In discoverCompany default platforms:
platforms = ['lever', 'greenhouse', 'ashby', 'workable'],
```

**`src/scan/index.mjs`** — two additions (import + `DISPATCH` entry):

```js
import { fetchWorkable } from './ats/workable.mjs';

const DISPATCH = {
  lever: fetchLever,
  greenhouse: fetchGreenhouse,
  ashby: fetchAshby,
  workable: fetchWorkable,
  workday: fetchWorkday,
};
```

Without this, `detectPlatform` recognizes the platform but `fetchCompanyOffers` returns `error: 'no fetcher'`.

### 4. Add a fixture and tests

Download and trim a real payload to 3 representative jobs (telecommuting false + city/country, telecommuting true + city/country, telecommuting true + empty location):

```bash
curl -s "https://apply.workable.com/api/v1/widget/accounts/huggingface" \
  | python3 -m json.tool > tests/fixtures/workable-huggingface.json
```

Create `tests/scan/ats-<name>.test.mjs` using `installMockFetch` (see `tests/helpers.mjs`). Cover:

1. Full fixture maps to correct `Offer[]` with `platform='workable'` and `body=''`
2. `telecommuting: true` produces `'Remote — City, Country'` prefix
3. `verifySlug` returns `{ ok: true, count: N }` on success and `{ ok: false, status: 404, reason: 'HTTP 404' }` on 404
4. `fetchX` throws on non-2xx

Update any existing tests that assume the new platform is unsupported (search for the platform name in `tests/scan/verify-company.test.mjs`).

### 5. Document and validate

Add a row to [`docs/ats-support.md`](ats-support.md) with: platform, host pattern, API endpoint, slug convention, notes.

Run the smoke test to confirm end-to-end wiring:

```bash
node -e "import('./src/scan/ats-detect.mjs').then(async m => {
  console.log(await m.verifyCompany('https://apply.workable.com/huggingface'));
})"
# → { ok: true, count: N }
```

### 6. Commit

```
feat(scan): add <name> ATS fetcher (#<issue>)
test(scan): cover <name> remote prefix and verifySlug (#<issue>)
feat(scan): mark <name> as verifiable and add to supported hosts (#<issue>)
feat(scan): include <name> in slug discovery (#<issue>)
docs: document <name> ATS support (#<issue>)
```

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
