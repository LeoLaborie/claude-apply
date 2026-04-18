# Design : compteurs intermédiaires par entreprise dans /scan

**Issue** : #67  
**Date** : 2026-04-17  
**Branche** : fix/issue-67-scan-filter-count

## Problème

La ligne de progression par entreprise n'affiche que le compte brut et les nouvelles offres :

```
[7/29] ✓ Anthropic — 431 raw, 0 new
```

Quand `new = 0`, il est impossible de distinguer :
- toutes les offres déjà vues (dédup), ou
- toutes les offres rejetées par `title_filter`, ou
- toutes les offres filtrées par localisation/date.

## Solution retenue : two-pass dans la boucle interne

### Changement dans la boucle interne de `runScan()`

Inverser l'ordre des deux guards (prefilter avant dédup) :

**Avant :**
```
1. Check dup → continue (sans passer par prefilter)
2. runPrefilter() → skip si titre/lieu/date/blacklist
3. Ajout pipeline
```

**Après :**
```
1. runPrefilter() → si fail : écrire history/filteredOut une seule fois, continue
2. Check dup → filtered.skipped_dup++, continue
3. companyAfterFilter++
4. Ajout pipeline
```

Cette inversion est sémantiquement plus propre (filtrer d'abord, dédupliquer ensuite) et préserve exactement les mêmes writes disque. La seule différence comportementale : un dup qui aurait aussi échoué au prefilter est maintenant comptabilisé dans `skipped_title` (etc.) plutôt que `skipped_dup`. En pratique cette collision est rare et le total reste cohérent.

### Nouveaux champs dans `perCompany`

```js
{
  company,
  platform,
  rawCount,         // anciennement count — offres retournées par l'ATS
  afterFilterCount, // offres passant runPrefilter(), avant dédup
  newCount,         // offres ajoutées au pipeline
  error,
  warning,
}
```

`count` est renommé `rawCount` pour la cohérence avec le nouveau nommage.

### Nouveaux champs dans `onProgress`

```js
onProgress({ index, total, company, platform,
  rawCount, afterFilterCount, newCount, error });
```

### Format de sortie

**Cas général (filtre actif) :**
```
[7/29] ✓ Anthropic — 431 raw → 2 after filter → 0 new (2 already seen)
```

**Cas simplifié (afterFilterCount === rawCount, aucune offre filtrée) :**
```
[7/29] ✓ Anthropic — 431 raw, 0 new
```

La forme courte évite le bruit quand le filtre titre est absent ou permissif.

**Dans `formatSummary()` par entreprise :**
```
  ✓ Anthropic           431 raw → 2 after filter → 0 new
  ✓ Mistral              12 raw, 0 new
```

## Fichiers impactés

| Fichier | Changement |
|---------|------------|
| `src/scan/index.mjs` | Inversion guard, nouveaux compteurs, formatSummary, onProgress |
| `tests/scan/scan.test.mjs` | Assertions sur les nouveaux champs |

## Ce qui ne change pas

- Logique de `runPrefilter()` — aucun changement
- Format de `pipeline.md`, `scan-history.tsv`, `filtered-out.tsv`
- API de `runScan()` (paramètres d'entrée)
- Comportement `--json` (expose déjà `perCompany`)

## Tests

- Scénario "tout filtré par titre" → `afterFilterCount = 0`, `newCount = 0`
- Scénario "tout vu" → `afterFilterCount = raw`, `newCount = 0`
- Scénario "mix" → comptes corrects sur chaque étape
- Format stderr `onProgress` validé par snapshots de chaîne
- Format `formatSummary` validé sur cas général et cas simplifié
