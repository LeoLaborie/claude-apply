# Per-Company `target_locations` Override — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `portals.yml` to declare a per-company `target_locations` array that overrides the global `profile.target_locations` for that company's offers during `/scan`.

**Architecture:** Extend the existing `effectiveConfig` spread block in `src/scan/index.mjs` (which already handles `skip_required_any`) with a second conditional spread driven by `Array.isArray(companyConfig?.target_locations)`. The override is purely a scan-time concern — `prefilter-rules.mjs`, score, and apply are untouched. Semantics: key absent → global fallback; array present (including `[]`) → strict override.

**Tech Stack:** Node 20 ESM, `node:test`, existing `installMockFetch` helper, Lever/Ashby mock patterns already in `tests/scan/scan.test.mjs`.

**Spec:** `docs/superpowers/specs/2026-04-18-per-company-target-locations-design.md`

---

## File Structure

- **Modify:** `src/scan/index.mjs` — extend `effectiveConfig` builder (currently lines 179–181) with the new conditional spread.
- **Modify:** `tests/scan/scan.test.mjs` — add one integration test covering four assertion groups (override applied, fallback, empty-array strict reject, isolation between companies).
- **Modify:** `templates/portals.example.yml` — add a commented example demonstrating the new field.
- **Modify:** `docs/scan-workflow.md` — add a new sub-section "Per-company override: `target_locations`" after the existing `skip_required_any` sub-section.

No new files, no new modules, no new dependencies.

---

## Task 1: Red — add failing test for per-company override

**Files:**
- Modify: `tests/scan/scan.test.mjs` (append new test at end of file, before the closing of the last test block)

- [ ] **Step 1: Write the failing test**

Append this test to `tests/scan/scan.test.mjs` (place after the existing `skip_required_any` test, matching its style):

```javascript
test('runScan — per-company target_locations overrides global', async () => {
  const portalsConfig = {
    title_filter: { positive: ['Intern'], negative: [] },
    tracked_companies: [
      {
        name: 'DeepMind',
        careers_url: 'https://boards.greenhouse.io/deepmind',
        enabled: true,
        target_locations: ['London', 'Remote'],
      },
      {
        name: 'Mistral AI',
        careers_url: 'https://jobs.lever.co/mistral',
        enabled: true,
        target_locations: [],
      },
      {
        name: 'Photoroom',
        careers_url: 'https://jobs.ashbyhq.com/photoroom',
        enabled: true,
      },
    ],
  };
  const profile = {
    min_start_date: '2026-08-24',
    blacklist_companies: [],
    target_locations: ['Paris', 'France', 'Remote'],
  };

  const greenhouseJson = {
    jobs: [
      {
        id: 1,
        absolute_url: 'https://boards.greenhouse.io/deepmind/jobs/1',
        title: 'Research Intern',
        location: { name: 'London, UK' },
        content: 'Internship in London starting September 2026.',
        updated_at: '2026-04-01T00:00:00Z',
      },
    ],
  };
  const leverJson = [
    {
      hostedUrl: 'https://jobs.lever.co/mistral/job-x',
      text: 'Research Intern',
      categories: { location: 'Paris' },
      descriptionPlain: 'Paris, France, September 2026.',
    },
  ];
  const ashbyJson = {
    jobs: [
      {
        jobUrl: 'https://jobs.ashbyhq.com/photoroom/job-y',
        title: 'ML Intern',
        location: 'London, UK',
        descriptionPlain: 'London September 2026.',
      },
    ],
  };

  const restore = installMockFetch({
    'https://boards.greenhouse.io/embed/job_board/json?for=deepmind': greenhouseJson,
    'https://api.lever.co/v0/postings/mistral?mode=json': leverJson,
    'https://api.ashbyhq.com/posting-api/job-board/photoroom?includeCompensation=false': ashbyJson,
  });

  const pipelinePath = path.join(tmp, 'pipeline.md');
  const historyPath = path.join(tmp, 'scan-history.tsv');
  const filteredPath = path.join(tmp, 'filtered-out.tsv');
  const applicationsPath = path.join(tmp, 'applications.md');
  fs.writeFileSync(applicationsPath, '# Apps\n');

  const result = await runScan({
    portalsConfig,
    profile,
    pipelinePath,
    historyPath,
    filteredPath,
    applicationsPath,
    dryRun: false,
  });

  restore();

  const addedCompanies = result.added.map((o) => o.company).sort();
  assert.deepEqual(
    addedCompanies,
    ['DeepMind'],
    `expected only DeepMind offer to pass, got ${JSON.stringify(addedCompanies)}`
  );
  assert.ok(
    result.filtered.skipped_location >= 2,
    `expected Mistral (empty override) + Photoroom (no override, London not in global) to be rejected on location, got skipped_location=${result.filtered.skipped_location}`
  );
});
```

This single test covers all four spec assertions:
- **Override applied:** DeepMind's "London, UK" offer passes because company-level `target_locations` includes `London`, even though global excludes it.
- **Empty-array strict reject:** Mistral has `target_locations: []` — its Paris offer is rejected despite matching the global list.
- **Fallback when absent:** Photoroom has no override — its London offer is rejected because global list doesn't include London.
- **Isolation:** DeepMind's override does not affect Mistral or Photoroom.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test --test-name-pattern="per-company target_locations overrides global" tests/scan/scan.test.mjs`

Expected: FAIL. Currently DeepMind's "London" offer is rejected because global `target_locations` has no "London", so `addedCompanies` will be `[]` instead of `['DeepMind']`. The assertion message will show the mismatch.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/scan/scan.test.mjs
git commit -m "test(scan): red — per-company target_locations override"
```

---

## Task 2: Green — implement the override

**Files:**
- Modify: `src/scan/index.mjs:178-181`

- [ ] **Step 1: Replace the `effectiveConfig` assignment**

Open `src/scan/index.mjs`. Find the block at lines 178–181:

```javascript
    const companyConfig = companyByName.get(result.company);
    const effectiveConfig = companyConfig?.skip_required_any
      ? { ...prefilterConfig, whitelist: { ...whitelist, required_any: [] } }
      : prefilterConfig;
```

Replace with:

```javascript
    const companyConfig = companyByName.get(result.company);
    const effectiveConfig = {
      ...prefilterConfig,
      ...(companyConfig?.skip_required_any && {
        whitelist: { ...whitelist, required_any: [] },
      }),
      ...(Array.isArray(companyConfig?.target_locations) && {
        targetLocations: companyConfig.target_locations,
      }),
    };
```

Two critical details:
- `Array.isArray(...)` — not truthiness. An empty array (`[]`) must still trigger the override (strict reject semantics from the spec).
- Spread order doesn't matter here since `skip_required_any` sets `whitelist` and `target_locations` sets `targetLocations`; they never collide.

- [ ] **Step 2: Run the new test to verify it passes**

Run: `node --test --test-name-pattern="per-company target_locations overrides global" tests/scan/scan.test.mjs`

Expected: PASS.

- [ ] **Step 3: Run the entire scan test file to verify no regressions**

Run: `node --test tests/scan/scan.test.mjs`

Expected: all tests pass. Key regression guards:
- "e2e avec 2 companies mockées" still passes (no per-company override used → identical behavior).
- "skip_required_any bypasses required_any" still passes (override composes correctly with the new spread).

- [ ] **Step 4: Run the full test suite**

Run: `npm test`

Expected: all tests pass. No other module uses `effectiveConfig`, so regressions should be confined to `tests/scan/`.

- [ ] **Step 5: Commit**

```bash
git add src/scan/index.mjs
git commit -m "feat(scan): per-company target_locations override (#77)"
```

---

## Task 3: Update templates and docs

**Files:**
- Modify: `templates/portals.example.yml`
- Modify: `docs/scan-workflow.md`

- [ ] **Step 1: Add an example in `templates/portals.example.yml`**

Open `templates/portals.example.yml`. Find the Anthropic entry (lines 15–17):

```yaml
  - name: Anthropic
    careers_url: https://jobs.lever.co/Anthropic
    enabled: true
```

Replace with:

```yaml
  - name: Anthropic
    careers_url: https://jobs.lever.co/Anthropic
    enabled: true
    # Optional per-company override: accept roles located in London or Remote
    # for this company only, regardless of the global target_locations.
    # Omit the key entirely to fall back to the global list.
    # target_locations:
    #   - London
    #   - Remote
```

Keep it commented out so the template remains a working config by default.

- [ ] **Step 2: Add a new sub-section to `docs/scan-workflow.md`**

Open `docs/scan-workflow.md`. Find the `### Per-company override: skip_required_any` section (around line 51–62). After the line `When set, `positive` and `negative` filters still apply — only `required_any` is skipped.` (line 62), add:

```markdown

### Per-company override: `target_locations`

For companies where the acceptable locations differ from your global preference (e.g. a remote-first employer where "Berlin" is de-facto Remote, or a dream company where you'd accept a specific foreign city), declare a per-company `target_locations` array:

```yaml
tracked_companies:
  - name: DeepMind
    careers_url: https://boards.greenhouse.io/deepmind
    target_locations:
      - London
      - Remote
      - France
```

Semantics:

- **Key absent** → the global `target_locations` from `candidate-profile.yml` applies (default, unchanged behavior).
- **Array present** → strict override; the global list is ignored for this company.
- **Empty array `[]`** → treated as a deliberate strict override with zero accepted locations — every offer is rejected on the location check. Omit the key instead if you want the global fallback.
```

(Note: the fenced code block above contains a nested triple-backtick block. When you paste, ensure the inner `yaml` fence and the outer closing fence are both preserved.)

- [ ] **Step 3: Verify no tests broke**

Run: `npm test`

Expected: PASS (docs/template changes don't touch test inputs, but confirm nothing accidentally slipped).

- [ ] **Step 4: Run Prettier to catch formatting drift**

Run: `npm run lint`

Expected: PASS. If Prettier complains about the YAML or Markdown, run `npm run format` and re-run `npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add templates/portals.example.yml docs/scan-workflow.md
git commit -m "docs(scan): document per-company target_locations override (#77)"
```

---

## Task 4: Open the pull request

- [ ] **Step 1: Push the branch**

Run: `git push -u origin worktree-issue-77`

- [ ] **Step 2: Open the PR**

Run:

```bash
gh pr create --title "feat(scan): per-company target_locations override (#77)" --body "$(cat <<'EOF'
## Summary
- Adds optional `target_locations` array on `tracked_companies` entries in `portals.yml`, mirroring the existing `skip_required_any` per-company override pattern.
- Key absent → global fallback; array present (including `[]`) → strict override.
- No changes to `prefilter-rules.mjs`, score, or apply.

Closes #77.

## Test plan
- [ ] `npm test` green locally
- [ ] New test `per-company target_locations overrides global` covers: override applied, empty-array strict reject, global fallback, isolation between companies
- [ ] Manual sanity: `node src/scan/index.mjs --dry-run` with a local `config/portals.yml` carrying the new field behaves as documented
EOF
)"
```

- [ ] **Step 3: Report the PR URL to the user**

Copy the URL printed by `gh pr create` and return it. Done.

---

## Self-Review Checklist (already applied)

- **Spec coverage:** All four spec test cases (override applied, fallback, empty-array, isolation) collapsed into one integration test with four assertions. Code change matches spec code sketch exactly. Template + doc updates present.
- **Placeholders:** None — every step has exact file paths, exact code, and exact commands.
- **Type consistency:** `Array.isArray(companyConfig?.target_locations)` used in both the prose and the code. Internal key name `targetLocations` (camelCase, matches existing `prefilterConfig.targetLocations` at `src/scan/index.mjs:96`). YAML key `target_locations` (snake_case, matches existing `skip_required_any`, `careers_url`, `min_start_date` conventions).
