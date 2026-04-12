# Fix Workday pagination timeout (#11)

## Problème

`fetchWorkday` pagine sans limite (`while(true)`, blocs de 20). Sur les gros boards (Sanofi : 1204 offres = 60 requêtes séquentielles), ça cause des timeouts (>4 min, seuil à 240s).

## Solution : deux mécanismes complémentaires

### 1. `searchText` côté API

Avant de paginer, construire une chaîne à partir de `title_filter.positive` (ex: `"Intern Internship Stage Stagiaire"`) et l'envoyer dans le body POST Workday. L'API fait un OR implicite sur les termes, ce qui réduit drastiquement le volume retourné (de ~1200 à ~20-50 offres typiquement).

Construction du `searchText` :
- Joindre les entrées de `title_filter.positive` qui sont des mots simples (pas des regex `/…/`) avec des espaces.
- Les entrées regex sont ignorées pour le `searchText` — elles continuent à être appliquées côté client via `runPrefilter`.
- Si `positive` est vide ou absent, `searchText` reste `''` (comportement actuel, pas de filtre API).

### 2. `maxOffers` cap

Constante `MAX_OFFERS = 200` dans `workday.mjs`. La boucle de pagination s'arrête dès que `offers.length >= MAX_OFFERS`. Filet de sécurité si `searchText` ne filtre pas assez.

## Changements fichier par fichier

### `src/scan/ats/workday.mjs`

- Ajouter `const MAX_OFFERS = 200`.
- `postJobs` : accepter un paramètre `searchText` au lieu du `''` codé en dur.
- `fetchWorkday` : accepter `opts.searchText`, le passer à `postJobs`. Ajouter la condition `offers.length >= MAX_OFFERS` comme condition de sortie de la boucle `while`.
- Signature inchangée : `fetchWorkday(url, companyName, opts)`.

### `src/scan/index.mjs`

- Dans `fetchCompanyOffers`, quand `det.platform === 'workday'`, construire le `searchText` en joignant les mots simples de `whitelist.positive` avec des espaces.
- Passer `{ searchText }` en 3e argument de `fetchWorkday`.
- Les autres fetchers continuent à recevoir `(slug, companyName)` sans changement.

## Cas limites

| Cas | Comportement |
|-----|-------------|
| `title_filter.positive` vide ou absent | `searchText` = `''`, pas de filtre API. `maxOffers` protège. |
| Entrées regex dans `positive` (ex: `"/^stage\\b/i"`) | Ignorées pour `searchText`, appliquées côté client par `runPrefilter`. |
| Board avec < 200 offres | `maxOffers` n'intervient jamais, comportement identique à l'actuel. |
| `maxOffers` atteint | Log un avertissement (console) pour signaler la troncature. |

## Tests à ajouter/modifier

- `fetchWorkday` avec `searchText` : vérifier que le body POST contient le bon `searchText`.
- `fetchWorkday` avec `maxOffers` atteint : mock de pages pleines, vérifier l'arrêt à 200.
- Construction du `searchText` dans le scanner : mots simples inclus, regex exclus, vide si pas de `positive`.

## Hors scope

- Config `maxOffers` par entreprise dans `portals.yml`.
- Champ `search_text` custom par portail.
- Modification des autres fetchers (Lever, Greenhouse, Ashby).
