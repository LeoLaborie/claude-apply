# Testing

## Running the suite

```bash
npm test
```

Runs `node --test tests/**/*.test.mjs`. All tests are ESM and use Node's built-in runner — no Jest, no Mocha, no Vitest.

Under the hood, some tests launch a headless Chromium via Playwright (upload helper, integration flow). Those tests need Playwright browsers installed:

```bash
npx playwright install chromium
```

(On CI this is done by the `Install Playwright browsers` step in `.github/workflows/test.yml`.)

## Test layout

```
tests/
├── check-no-pii.test.mjs           # asserts the PII script catches known patterns
├── helpers.mjs
├── apply/
│   ├── apply-log.test.mjs
│   ├── candidate-profile.test.mjs
│   ├── confirmation-detector.test.mjs
│   ├── field-classifier.test.mjs
│   ├── field-classifier-integration.test.mjs
│   ├── language-detect.test.mjs
│   ├── letter-generator.test.mjs
│   ├── upload-file.test.mjs        # Playwright CDP, happy path + errors
│   └── integration.test.mjs        # end-to-end per-ATS
├── dashboard/
├── lib/
├── scan/
├── score/
├── scripts/
│   └── setup.test.mjs              # runs setup.sh in a tmpdir
└── fixtures/
    ├── apply/
    │   ├── lever-form.html
    │   ├── greenhouse-form.html
    │   ├── ashby-form.html
    │   └── wttj-form.html
    ├── fake-cv.pdf
    ├── lever-mistral.json
    ├── greenhouse-anthropic.json
    └── ashby-photoroom.json
```

## What to test

- **Pure functions.** One test file per module, covering happy path + edge cases. Cheap to run, easy to iterate on.
- **Fetchers.** Mock `fetch` with a recorded fixture response. Never hit live APIs in tests.
- **Browser-dependent code.** Use the fixture HTML files + headless Chromium. See `tests/apply/integration.test.mjs` for the pattern.
- **Scripts.** `setup.sh` runs in a tmpdir with a fake `$HOME`. Never touch the real filesystem outside the tmpdir.

## Writing a new test

```js
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { yourFunction } from '../../src/path/to/module.mjs';

test('yourFunction: describes what it checks', () => {
  assert.equal(yourFunction(input), expected);
});
```

For async code, `test('name', async () => { ... })`. For setup/teardown, use `before` / `after` / `beforeEach` from `node:test`.

## Pre-commit checklist

Before committing anything:

```bash
npm test                      # all tests pass
bash scripts/check-no-pii.sh  # PII gate green
npm run lint                  # prettier happy
```

Or as one command: `npm test && bash scripts/check-no-pii.sh && npm run lint`.

## Manual E2E checklist (before a release)

1. `rm -rf /tmp/claude-apply-dryrun && git clone . /tmp/claude-apply-dryrun`.
2. `cd /tmp/claude-apply-dryrun && HOME=/tmp/claude-apply-home bash scripts/setup.sh` — follow the prompts.
3. `node src/scan/index.mjs --dry-run` with a minimal `config/portals.yml` — confirm no crash and reasonable output.
4. Launch `chrome-apply`, open one of the fixtures at `file:///tmp/.../tests/fixtures/apply/lever-form.html`, and run the upload helper manually:
   ```bash
   node src/apply/upload-file.mjs --url lever-form --selector '#resume' --file tests/fixtures/fake-cv.pdf
   ```
5. Review `git log` on the release branch — confirm no accidental PII in any file.
