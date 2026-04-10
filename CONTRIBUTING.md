# Contributing to claude-apply

Thanks for your interest! This document covers the practical setup and expectations for contributing code, docs, or new ATS support.

## Dev setup

```bash
git clone https://github.com/LeoLaborie/claude-apply.git
cd claude-apply
npm install
npx playwright install chromium
```

The test suite needs a headless Chromium for the upload helper and the integration tests; everything else runs on plain Node 20+.

## Running tests

```bash
npm test                      # full suite
bash scripts/check-no-pii.sh  # PII gate
npm run lint                  # prettier check
npm run format                # prettier write
```

Before committing, run all three. CI will run them on every PR.

## Code style

- ESM only, `.mjs` extensions, `"type": "module"`.
- Prettier defaults (2-space indent, single quotes, trailing commas).
- Prefer Node standard library (`node:fs`, `node:test`, `node:http`, global `fetch`).
- No new runtime dependencies without a strong justification.
- No comments unless the *why* is non-obvious — names should carry the meaning.

## Commit conventions

Conventional Commits: `type(scope): short summary`.

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`, `perf`.

Common scopes: `scan`, `score`, `apply`, `lib`, `dashboard`, `scripts`, `commands`.

Examples:

- `feat(scan): add Teamtailor fetcher`
- `fix(apply): handle WTTJ aggregator redirect`
- `docs: clarify CDP setup on macOS`
- `test(apply): add integration test for Ashby`

## PR process

1. Fork + branch. One logical change per PR.
2. Add or update tests for your change.
3. Make sure `npm test`, the PII gate, and `npm run lint` all pass locally.
4. Open a PR with a clear title and a short summary (what + why).
5. The template will ask you to tick: tests added, PII gate green, docs updated, `CHANGELOG.md` updated if user-visible.
6. CI must be green before merge.

## Adding a new ATS

See [`docs/extending.md`](docs/extending.md). Short version: fetcher in `src/scan/ats/<name>.mjs`, detect rule in `src/scan/ats-detect.mjs`, fixture JSON, unit test.

## Security

Please do not open a public issue for security reports — see [`SECURITY.md`](SECURITY.md).
