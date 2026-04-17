# Design — Issue #64 : champ unique `cv_path`

**Date :** 2026-04-17  
**Issue :** [#64](https://github.com/leo-laborie/claude-apply-dev/issues/64) — `cv_en_path` et `cv_fr_path` requis même quand un seul CV existe  
**Branch :** `fix/issue-64-cv-path-optional`

## Problème

`candidate-profile.schema.mjs` liste `cv_fr_path` et `cv_en_path` dans `REQUIRED_FIELDS`. Le validateur rejette `null` pour l'un ou l'autre, ce qui oblige les candidats avec un seul CV à dupliquer le chemin — comportement trompeur et inutile. Les deux champs contiennent la même information dans la grande majorité des cas.

## Décision

Remplacer `cv_fr_path` et `cv_en_path` par un champ unique obligatoire `cv_path`.

- Breaking change assumé : les profils existants devront renommer leur champ.
- Approche plus simple que la règle "at-least-one" : un seul champ, une seule validation.

## Fichiers à modifier

### 1. `src/lib/candidate-profile.schema.mjs`

- Retirer `cv_fr_path` et `cv_en_path` de `REQUIRED_FIELDS`
- Ajouter `cv_path` à `REQUIRED_FIELDS`
- Retirer les deux anciens champs de `OPTIONAL_FIELDS` s'ils y figurent

### 2. `src/apply/field-classifier.mjs`

Lignes 199-201 utilisent `profile.cv_en_path` comme fallback pour les uploads secondaires. Remplacer par `profile.cv_path` :

```js
const anyCV = profile.cv_path;
transcript_upload: profile.transcript_path ?? anyCV,
portfolio_upload:  profile.portfolio_path  ?? anyCV,
other_upload:      profile.other_document_path ?? anyCV,
```

La sélection de langue (`cv_fr_path` ou `cv_en_path` selon la langue détectée) dans `.claude/commands/apply.md` devient simplement `profile.cv_path`.

### 3. `src/lib/load-profile.mjs`

`PATH_FIELDS` contient les deux anciens champs pour la résolution de chemin. Remplacer par `cv_path`.

### 4. `templates/candidate-profile.example.yml`

```yaml
# Chemin vers votre CV (repo-relative, absolu, ou ~/... acceptés)
cv_path: config/cv.pdf
```

Supprimer les deux lignes `cv_fr_path` / `cv_en_path`.

### 5. `.claude/commands/apply.md`

Mettre à jour la référence :
> `cv_upload` : résoudre le chemin depuis `profile.cv_path`

### 6. Tests (`tests/apply/candidate-profile.test.mjs`)

- Remplacer `cv_fr_path` / `cv_en_path` par `cv_path` dans toutes les fixtures
- Le test "flags missing required fields" vérifie `cv_path` (pas les deux anciens champs)
- Ajouter un test : profil avec `cv_path` valide → `ok: true`
- Ajouter un test : profil sans `cv_path` → erreur `missing required field: cv_path`

## Critères de succès

- `validateProfile` accepte un profil avec seulement `cv_path`
- `validateProfile` rejette un profil sans `cv_path`
- `validateProfile` rejette un profil avec `cv_fr_path` ou `cv_en_path` (champs inconnus)
- Tous les tests existants passent après migration des fixtures
- Le template d'exemple utilise `cv_path`
- `npm run check:pii` passe

## Non-objectifs

- Pas de migration automatique des profils utilisateurs existants (breaking change documenté)
- Pas de support d'alias `cv_fr_path` → `cv_path` pour la rétrocompatibilité
