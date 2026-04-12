# Design: Classifier les champs transcript, portfolio et other uploads

**Issue:** #17 — `feat(apply): Classifier le champ transcript_upload`
**Date:** 2026-04-12
**Scope:** `transcript_upload`, `portfolio_upload`, `other_upload` + fallback CV

## Problem

Le champ "Transcripts" (requis chez QuantCo) n'est pas reconnu par `field-classifier.mjs`. Il tombe dans le fallback générique `cv_upload`. L'agent s'arrête sur un champ `unknown` si le label ne matche aucune règle file-specific, ou uploade silencieusement le CV sans le signaler.

Même problème potentiel pour les champs portfolio et "additional documents" rencontrés sur d'autres ATS.

## Approach

Approche A retenue : 3 règles distinctes dans `RULES`, chacune avec son propre key, ses regex, et un mapping profil optionnel avec fallback CV.

## Design

### 1. Classifier rules

3 nouvelles règles dans `RULES` de `src/apply/field-classifier.mjs`, insérées **après** `cover_letter_upload` et **avant** le fallback générique `cv_upload` (qui matche tout `type === 'file'`).

Ordre final des règles file :

```
cover_letter_upload  (existant)
transcript_upload    (nouveau)
portfolio_upload     (nouveau)
other_upload         (nouveau)
cv_upload            (spécifique — regex resume/cv)
cv_upload            (fallback générique — tout file)
```

Patterns regex :

- `transcript_upload` : `transcript|releve de notes|academic record|grade report|bulletin`
- `portfolio_upload` : `portfolio|work sample|travaux|book|writing sample|echantillon`
- `other_upload` : `additional.*doc|other.*doc|autre.*doc|supplement|piece jointe`

### 2. Profile mapping & fallback

Dans `mapProfileValue`, 3 nouvelles entrées avec fallback sur le chemin CV existant :

```js
transcript_upload: profile.transcript_path ?? cvPath,
portfolio_upload: profile.portfolio_path ?? cvPath,
other_upload: profile.other_document_path ?? cvPath,
```

Si le candidat n'a pas configuré le chemin spécifique, le CV est uploadé comme placeholder. Un warning est loggé pour que l'utilisateur sache qu'un substitut a été utilisé.

### 3. Template profil

3 champs optionnels ajoutés dans `templates/candidate-profile.example.yml` sous les `cv_*_path` :

```yaml
# --- Optional document paths (absolute) ---
transcript_path: null       # releve de notes / academic transcript
portfolio_path: null        # portfolio / work samples
other_document_path: null   # any additional document
```

### 4. Tests

Tests unitaires dans `tests/apply/field-classifier.test.mjs` :

6 cas de classification :

| Field | Expected |
|-------|----------|
| `{ name: 'transcript', type: 'file', label: 'Transcripts' }` | `transcript_upload` |
| `{ name: 'releve', type: 'file', label: 'Relevé de notes' }` | `transcript_upload` |
| `{ name: 'portfolio', type: 'file', label: 'Portfolio' }` | `portfolio_upload` |
| `{ name: 'samples', type: 'file', label: 'Writing Sample' }` | `portfolio_upload` |
| `{ name: 'additional', type: 'file', label: 'Additional Documents' }` | `other_upload` |
| `{ name: 'other', type: 'file', label: 'Other Document' }` | `other_upload` |

Tests de mapping avec fallback :

- Profil avec `transcript_path` set -> retourne le chemin transcript
- Profil sans `transcript_path` -> retourne le chemin CV (fallback)
- Idem pour `portfolio_upload` et `other_upload`

### 5. Docs

Mettre a jour `docs/apply-workflow.md` section "Supported classes" pour ajouter `transcript_upload`, `portfolio_upload`, `other_upload` dans la ligne "Uploads".

## Files modified

1. `src/apply/field-classifier.mjs` — 3 regles + 3 mappings
2. `templates/candidate-profile.example.yml` — 3 champs optionnels
3. `tests/apply/field-classifier.test.mjs` — ~9 nouveaux tests
4. `docs/apply-workflow.md` — liste des classes supportees

## Out of scope

- Dictionnaire de termes courants pour le playbook `/apply` (issue separee)
- Modification du playbook `.claude/commands/apply.md`

## No breaking changes

Les nouveaux champs profil sont optionnels avec fallback CV. Les formulaires existants ne changent pas de comportement.
