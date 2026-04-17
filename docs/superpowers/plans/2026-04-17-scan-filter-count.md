# Scan Per-Company Filter Count Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher les compteurs intermédiaires par entreprise dans `/scan` : `431 raw → 2 after filter → 0 new (2 already seen)`.

**Architecture:** Inverser l'ordre des guards (prefilter avant dédup) dans la boucle interne de `runScan()`, ajouter un compteur `afterFilterCount` par entreprise, enrichir `perCompany` + `onProgress`, mettre à jour `formatSummary()` et le stderr de `main()`. Un seul fichier source modifié.

**Tech Stack:** Node 20, ESM, `node:test` (tests), pas de dépendances nouvelles.

---

## Fichiers

- **Modify:** `src/scan/index.mjs` — boucle interne, perCompany, onProgress, formatSummary, stderr
- **Modify:** `tests/scan/scan.test.mjs` — 3 nouveaux tests + mise à jour des refs `count` → `rawCount`

---

### Task 1 : Tests rouges — nouveaux champs sur perCompany

**Files:**
- Modify: `tests/scan/scan.test.mjs`

- [ ] **Step 1 : Écrire le test `perCompany expose rawCount, afterFilterCount, newCount`**

Ajouter ce test à la fin de `tests/scan/scan.test.mjs` (après la ligne 627) :

```js
test('runScan — perCompany expose rawCount, afterFilterCount, newCount', async () => {
  const portalsConfig = {
    title_filter: {
      positive: ['Intern', 'Stage'],
      negative: ['Senior'],
    },
    tracked_companies: [
      { name: 'Mistral AI', careers_url: 'https://jobs.lever.co/mistral', enabled: true },
    ],
  };
  const profile = {
    min_start_date: '2026-08-24',
    blacklist_companies: [],
    target_locations: ['France', 'Paris', 'Remote'],
  };

  const leverJson = [
    {
      hostedUrl: 'https://jobs.lever.co/mistral/job1',
      text: 'Research Intern',
      categories: { location: 'Paris' },
      descriptionPlain: 'Stage 6 mois Paris France September 2026.',
    },
    {
      hostedUrl: 'https://jobs.lever.co/mistral/job2',
      text: 'Senior Engineer',
      categories: { location: 'Paris' },
      descriptionPlain: 'Senior Paris France.',
    },
    {
      hostedUrl: 'https://jobs.lever.co/mistral/job3',
      text: 'Data Intern',
      categories: { location: 'Paris' },
      descriptionPlain: 'Stage Paris France September 2026.',
    },
  ];

  const restore = installMockFetch({
    'https://api.lever.co/v0/postings/mistral?mode=json': leverJson,
  });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-counts-'));
  const pipelinePath = path.join(tmpDir, 'pipeline.md');
  const historyPath = path.join(tmpDir, 'scan-history.tsv');
  const filteredPath = path.join(tmpDir, 'filtered-out.tsv');
  const applicationsPath = path.join(tmpDir, 'applications.md');
  fs.writeFileSync(applicationsPath, '# Apps\n');

  try {
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

    assert.equal(result.perCompany.length, 1);
    const [entry] = result.perCompany;
    assert.equal(entry.rawCount, 3, 'rawCount should be total ATS offers');
    assert.equal(entry.afterFilterCount, 2, 'afterFilterCount: 2 pass prefilter (Senior rejected)');
    assert.equal(entry.newCount, 2, 'newCount: both passed, none are dups');
  } finally {
    restore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2 : Vérifier que le test échoue**

```bash
cd .worktrees/issue-67-scan-filter-count && node --test --test-name-pattern="perCompany expose rawCount" tests/scan/scan.test.mjs
```

Attendu : FAIL avec `entry.rawCount is not 3` ou `rawCount` undefined.

---

### Task 2 : Tests rouges — formatSummary avec compteurs intermédiaires

**Files:**
- Modify: `tests/scan/scan.test.mjs`

- [ ] **Step 1 : Écrire le test `formatSummary — cas filtre actif`**

Ajouter après le test de Task 1 :

```js
test('formatSummary — cas filtre actif affiche raw → after filter → new', () => {
  const result = {
    scanned: 1,
    raw: 10,
    perCompany: [
      {
        company: 'Anthropic',
        platform: 'lever',
        rawCount: 10,
        afterFilterCount: 3,
        newCount: 1,
        error: null,
        warning: null,
      },
    ],
    filtered: {
      skipped_dup: 2,
      skipped_title: 7,
      skipped_blacklist: 0,
      skipped_location: 0,
      skipped_date: 0,
    },
    added: [{ company: 'Anthropic', title: 'ML Intern', url: 'https://jobs.lever.co/a/1' }],
    errors: [],
    historyWrites: 3,
  };
  const out = formatSummary(result, false);
  assert.match(out, /10 raw → 3 after filter → 1 new/);
});
```

- [ ] **Step 2 : Écrire le test `formatSummary — cas simplifié`**

Ajouter juste après :

```js
test('formatSummary — cas simplifié quand afterFilterCount === rawCount', () => {
  const result = {
    scanned: 1,
    raw: 5,
    perCompany: [
      {
        company: 'Mistral AI',
        platform: 'lever',
        rawCount: 5,
        afterFilterCount: 5,
        newCount: 0,
        error: null,
        warning: null,
      },
    ],
    filtered: {
      skipped_dup: 5,
      skipped_title: 0,
      skipped_blacklist: 0,
      skipped_location: 0,
      skipped_date: 0,
    },
    added: [],
    errors: [],
    historyWrites: 0,
  };
  const out = formatSummary(result, false);
  assert.match(out, /5 raw, 0 new/);
  assert.doesNotMatch(out, /after filter/);
});
```

- [ ] **Step 3 : Vérifier que les 2 nouveaux tests échouent**

```bash
cd .worktrees/issue-67-scan-filter-count && node --test --test-name-pattern="formatSummary — cas" tests/scan/scan.test.mjs
```

Attendu : 2 FAIL (rawCount/afterFilterCount/newCount undefined dans le mock perCompany).

---

### Task 3 : Mise à jour des tests existants qui référencent `count`

**Files:**
- Modify: `tests/scan/scan.test.mjs`

- [ ] **Step 1 : Remplacer `entry.count` → `entry.rawCount` (ligne 448)**

Dans le test `runScan — perCompany.warning set when raw=0 without error` (ligne ~446-453) :

```js
// Avant
assert.equal(entry.count, 0);
// Après
assert.equal(entry.rawCount, 0);
```

- [ ] **Step 2 : Mettre à jour les objets `perCompany` dans `formatSummary — renders ⚠` (ligne ~537-566)**

Remplacer les deux entrées du mock `perCompany` :

```js
// Avant
perCompany: [
  { company: 'Anthropic', platform: 'lever', count: 5, error: null, warning: null },
  {
    company: 'Vercel',
    platform: 'ashby',
    count: 0,
    error: null,
    warning: 'board live but empty — possibly wrong slug',
  },
],
// Après
perCompany: [
  { company: 'Anthropic', platform: 'lever', rawCount: 5, afterFilterCount: 5, newCount: 5, error: null, warning: null },
  {
    company: 'Vercel',
    platform: 'ashby',
    rawCount: 0,
    afterFilterCount: 0,
    newCount: 0,
    error: null,
    warning: 'board live but empty — possibly wrong slug',
  },
],
```

- [ ] **Step 3 : Vérifier que les tests modifiés passent encore (suite complète actuelle)**

```bash
cd .worktrees/issue-67-scan-filter-count && node --test tests/scan/scan.test.mjs 2>&1 | tail -15
```

Attendu : les 3 nouveaux tests FAIL, les tests existants restent verts.

---

### Task 4 : Implémentation — boucle interne + compteurs

**Files:**
- Modify: `src/scan/index.mjs:188-270`

- [ ] **Step 1 : Initialiser `companyAfterFilter` avant la boucle d'offres**

Dans `runScan()`, juste avant `let companyNew = 0;` (ligne ~189), ajouter :

```js
let companyAfterFilter = 0;
let companyNew = 0;
```

- [ ] **Step 2 : Inverser l'ordre des guards dans la boucle interne**

Remplacer entièrement la boucle `for (const offer of result.offers)` (lignes 190-256) par :

```js
for (const offer of result.offers) {
  let check;
  try {
    check = runPrefilter(offer, effectiveConfig);
  } catch (err) {
    filtered.skipped_other = (filtered.skipped_other || 0) + 1;
    errors.push({ company: offer.company, error: `prefilter: ${err.message}` });
    if (!dryRun && !seen.has(offer.url)) {
      seen.add(offer.url);
      appendHistoryRow(historyPath, {
        url: offer.url,
        first_seen: today,
        portal: result.platform,
        title: offer.title,
        company: offer.company,
        status: 'skipped_other',
      });
      historyWrites++;
    }
    continue;
  }

  if (!check.pass) {
    const status = reasonToStatus(check.reason);
    filtered[status] = (filtered[status] || 0) + 1;
    if (!dryRun && !seen.has(offer.url)) {
      seen.add(offer.url);
      appendHistoryRow(historyPath, {
        url: offer.url,
        first_seen: today,
        portal: result.platform,
        title: offer.title,
        company: offer.company,
        status,
      });
      historyWrites++;
      appendFilteredOut(filteredPath, {
        date: today,
        url: offer.url,
        company: offer.company,
        title: offer.title,
        reason: check.reason,
      });
    }
    continue;
  }

  // Offer passed prefilter — count it before dedup check
  companyAfterFilter++;

  if (seen.has(offer.url)) {
    filtered.skipped_dup++;
    continue;
  }
  seen.add(offer.url);

  added.push(offer);
  companyNew++;
  appendOffer(doc, offer);
  if (!dryRun) {
    appendHistoryRow(historyPath, {
      url: offer.url,
      first_seen: today,
      portal: result.platform,
      title: offer.title,
      company: offer.company,
      status: 'added',
    });
    historyWrites++;
  }
}
```

- [ ] **Step 3 : Réinitialiser `companyAfterFilter` et `companyNew` au début de chaque itération**

Les deux variables sont déclarées dans la boucle `for (const result of fetchResults)`. S'assurer qu'elles sont bien initialisées à `0` à chaque itération d'entreprise (juste avant la boucle `for (const offer of result.offers)`).

Vérifier que le code ressemble bien à :

```js
let companyAfterFilter = 0;
let companyNew = 0;
for (const offer of result.offers) {
  // ...
}
```

- [ ] **Step 4 : Vérifier que le premier test rouge passe**

```bash
cd .worktrees/issue-67-scan-filter-count && node --test --test-name-pattern="perCompany expose rawCount" tests/scan/scan.test.mjs
```

Attendu : toujours FAIL (perCompany ne retourne pas encore rawCount — Task 5 le fait).

---

### Task 5 : Implémentation — enrichir perCompany et onProgress

**Files:**
- Modify: `src/scan/index.mjs`

- [ ] **Step 1 : Renommer `count` → `rawCount` et ajouter les nouveaux champs dans `perCompany` (cas normal)**

Trouver le bloc `perCompany.push` pour le cas sans erreur (lignes ~175-181) et le remplacer par :

```js
const warning =
  result.offers.length === 0 ? 'board live but empty — possibly wrong slug' : null;
perCompany.push({
  company: result.company,
  platform: result.platform,
  rawCount: result.offers.length,
  afterFilterCount: companyAfterFilter,
  newCount: companyNew,
  error: null,
  warning,
});
```

Note : ce push a lieu **après** la boucle d'offres, donc `companyAfterFilter` et `companyNew` sont déjà calculés.

Attention : le push `perCompany.push` pour le cas sans erreur se trouve actuellement avant la boucle d'offres (lignes 173-181). Il faut le déplacer **après** la boucle `for (const offer of result.offers)` puisque `companyAfterFilter` et `companyNew` n'existent qu'après.

Le bloc final pour une entreprise sans erreur doit ressembler à :

```js
let companyAfterFilter = 0;
let companyNew = 0;
for (const offer of result.offers) {
  // ... (boucle Task 4)
}

const warning =
  result.offers.length === 0 ? 'board live but empty — possibly wrong slug' : null;
perCompany.push({
  company: result.company,
  platform: result.platform,
  rawCount: result.offers.length,
  afterFilterCount: companyAfterFilter,
  newCount: companyNew,
  error: null,
  warning,
});

progressIndex++;
if (onProgress) {
  onProgress({
    index: progressIndex,
    total: fetchResults.length,
    company: result.company,
    platform: result.platform,
    rawCount: result.offers.length,
    afterFilterCount: companyAfterFilter,
    newCount: companyNew,
    error: null,
  });
}
```

- [ ] **Step 2 : Mettre à jour le `perCompany.push` du cas d'erreur pour ajouter rawCount/afterFilterCount/newCount**

Trouver le bloc `perCompany.push` dans le `if (result.error)` (lignes ~151-157) et le remplacer par :

```js
perCompany.push({
  company: result.company,
  platform: result.platform,
  rawCount: 0,
  afterFilterCount: 0,
  newCount: 0,
  error: result.error,
  warning: null,
});
```

- [ ] **Step 3 : Mettre à jour le `onProgress` du cas d'erreur (lignes ~160-168)**

```js
if (onProgress) {
  onProgress({
    index: progressIndex,
    total: fetchResults.length,
    company: result.company,
    platform: result.platform,
    rawCount: 0,
    afterFilterCount: 0,
    newCount: 0,
    error: result.error,
  });
}
```

- [ ] **Step 4 : Vérifier que les 3 tests rouges de Task 1-2 passent maintenant**

```bash
cd .worktrees/issue-67-scan-filter-count && node --test --test-name-pattern="perCompany expose rawCount|formatSummary — cas" tests/scan/scan.test.mjs
```

Attendu : 3 FAIL restants (formatSummary n'est pas encore mis à jour).

---

### Task 6 : Implémentation — formatSummary et stderr

**Files:**
- Modify: `src/scan/index.mjs:279-323`

- [ ] **Step 1 : Mettre à jour la boucle `perCompany` dans `formatSummary()`**

Remplacer les lignes ~286-294 :

```js
// Avant
for (const c of result.perCompany) {
  const mark = c.error ? '✗' : c.warning ? '⚠' : '✓';
  const note = c.error
    ? `(${c.error})`
    : c.warning
      ? `(${c.platform} — ${c.warning})`
      : `(${c.platform})`;
  lines.push(`  ${mark} ${c.company.padEnd(18)} ${String(c.count).padStart(3)} offres ${note}`);
}
```

Par :

```js
for (const c of result.perCompany) {
  const mark = c.error ? '✗' : c.warning ? '⚠' : '✓';
  const note = c.error
    ? `(${c.error})`
    : c.warning
      ? `(${c.platform} — ${c.warning})`
      : `(${c.platform})`;
  const counts =
    c.error || c.rawCount === c.afterFilterCount
      ? `${c.rawCount} raw, ${c.newCount} new`
      : `${c.rawCount} raw → ${c.afterFilterCount} after filter → ${c.newCount} new`;
  lines.push(`  ${mark} ${c.company.padEnd(18)} ${counts} ${note}`);
}
```

- [ ] **Step 2 : Mettre à jour la ligne de progress dans `main()` (lignes ~360-368)**

Remplacer le callback `onProgress` :

```js
// Avant
onProgress: ({ index, total, company, count, newCount, error }) => {
  if (error) {
    process.stderr.write(`[${index}/${total}] \u2717 ${company} \u2014 ${error}\n`);
  } else {
    process.stderr.write(
      `[${index}/${total}] \u2713 ${company} \u2014 ${count} raw, ${newCount} new\n`
    );
  }
},
```

Par :

```js
onProgress: ({ index, total, company, rawCount, afterFilterCount, newCount, error }) => {
  if (error) {
    process.stderr.write(`[${index}/${total}] \u2717 ${company} \u2014 ${error}\n`);
  } else {
    const alreadySeen = afterFilterCount - newCount;
    const line =
      afterFilterCount === rawCount
        ? `${rawCount} raw, ${newCount} new`
        : `${rawCount} raw \u2192 ${afterFilterCount} after filter \u2192 ${newCount} new (${alreadySeen} already seen)`;
    process.stderr.write(`[${index}/${total}] \u2713 ${company} \u2014 ${line}\n`);
  }
},
```

- [ ] **Step 3 : Vérifier que tous les tests rouges passent maintenant**

```bash
cd .worktrees/issue-67-scan-filter-count && node --test --test-name-pattern="perCompany expose rawCount|formatSummary — cas" tests/scan/scan.test.mjs
```

Attendu : 3 PASS.

---

### Task 7 : Suite complète, lint, commit, PR

**Files:**
- `src/scan/index.mjs`
- `tests/scan/scan.test.mjs`
- `docs/superpowers/specs/2026-04-17-scan-filter-count-design.md`

- [ ] **Step 1 : Exécuter la suite complète**

```bash
cd .worktrees/issue-67-scan-filter-count && npm test 2>&1 | tail -20
```

Attendu :
```
# tests 437
# pass 437
# fail 0
```

Si des tests échouent à cause de `entry.count` : vérifier que Task 3 a bien été appliquée.

- [ ] **Step 2 : Lint et format**

```bash
cd .worktrees/issue-67-scan-filter-count && npm run lint && npm run format
```

Attendu : aucune erreur, fichiers reformatés si besoin.

- [ ] **Step 3 : Re-run des tests après format**

```bash
cd .worktrees/issue-67-scan-filter-count && npm test 2>&1 | tail -10
```

Attendu : toujours 437 pass.

- [ ] **Step 4 : Committer la spec (force-add car gitignored)**

```bash
cd .worktrees/issue-67-scan-filter-count && git add -f docs/superpowers/specs/2026-04-17-scan-filter-count-design.md && git add -f docs/superpowers/plans/2026-04-17-scan-filter-count.md && git commit -m "docs(scan): design spec and implementation plan for per-company filter count (#67)"
```

- [ ] **Step 5 : Committer l'implémentation**

```bash
cd .worktrees/issue-67-scan-filter-count && git add src/scan/index.mjs tests/scan/scan.test.mjs && git commit -m "fix(scan): per-company after-filter count in progress output (#67)"
```

- [ ] **Step 6 : Pousser et créer le PR**

```bash
cd .worktrees/issue-67-scan-filter-count && git push && gh pr create --draft --title "fix(scan): per-company after-filter count in progress output" --body "$(cat <<'EOF'
Fixes #67

## Summary
- Adds intermediate `afterFilterCount` per company in `runScan()` output
- Inverts guard order (prefilter before dedup) so filtered count is accurate
- Progress line now shows: `431 raw → 2 after filter → 0 new (2 already seen)`
- Short form used when no filtering occurs: `5 raw, 0 new`

## Test plan
- [ ] 3 new tests: perCompany fields, formatSummary active filter, formatSummary short form
- [ ] Existing warning/error tests updated to use `rawCount` instead of `count`
- [ ] Full test suite passes (437 tests)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Attendu : URL du PR affiché dans le terminal.
