# jev-ci-selector

Une GitHub Action qui **produit un plan de sélection CI**, sans lancer de tâches ni modifier les workflows. Le moteur TypeScript est utilisable et testable sans GitHub, Git, réseau ou clé TypeSafe. Le mode par défaut est `shadow` : toutes les tâches restent exécutées.

Ce dépôt contient le MVP et son bundle `dist/index.js`, à conserver dans le même commit que les sources. Aucune version n'est publiée et aucun dépôt consommateur n'est configuré automatiquement.

## Utilisation

1. Installer le catalogue dans la branche de base, avant la première PR à analyser.
2. Adapter l'[intégration avec jobs statiques](examples/static-jobs/README.md), recommandée, ou l'[intégration matricielle](examples/matrix/README.md) pour des tâches indépendantes. Copier le catalogue, le workflow et `dist/validate.cjs` sous `.github/ci-selector-validate.cjs` dans le consommateur. Ce vérificateur autonome est exécuté obligatoirement par les exemples, hors du job de planification.
3. Remplacer `OWNER/jev-ci-selector@0000000000000000000000000000000000000000` par le dépôt de distribution et **un vrai SHA complet, revu, contenant le bundle**. Ce marqueur n'est pas une version publiée.
4. Conserver `mode: shadow`. Fournir la clé TypeSafe et `allow-external-context: 'true'` uniquement après avoir autorisé l'envoi du code concerné. Sans l'un des deux, l'action produit un plan complet sans appel externe.
5. Dans les règles de protection/rulesets de la branche, rendre le job stable **`ci-required` obligatoire**. Tester d'abord une PR qui fait échouer une tâche sélectionnée et une autre qui fait échouer le planificateur. L'action ne modifie pas ces protections.

Les exemples exécutent toute la CI sur `push`, `schedule` et `merge_group`, sans appeler le sélecteur. Sur `pull_request`, chaque consommateur doit tester exactement `tested-sha`, le commit de fusion `GITHUB_SHA`. Une matrice ne remplace pas les dépendances `needs`.

## Catalogue

Le [schéma strict](schemas/config.schema.json) documente le format. Exemple minimal :

```yaml
version: 1
model: jev-1.13.0
skip_below: 0.05
force_all_paths: [".github/**", "ci/**", "go.mod", "go.sum"]
tasks:
  unit:
    always: true
  build:
    always: true
  helm:
    run_if_paths: ["charts/**"]
    question: Does this change affect Helm rendering, values or manifests?
  e2e_network:
    requires: [build]
    run_if_paths: ["pkg/network/**"]
    question: Does this change affect networking, routing, ingress, DNS or network policies?
```

`always` et une correspondance `run_if_paths` imposent la tâche. Une absence de correspondance laisse la tâche éligible à Jev. Une question est requise pour toute tâche sans `always: true` ; elle doit porter sur le périmètre affecté, jamais prédire un échec de test. `requires` ferme transitivement la sélection ; le workflow fixe l'ordre réel avec `needs`. Les dépendances déjà imposées ne consomment pas de question Jev.

Une probabilité **strictement inférieure** à `skip_below` permet de retirer une tâche facultative ; à égalité elle est conservée. `0.05` est un point de départ expérimental, sans garantie de taux d'erreur. Les modèles doivent être versionnés (`jev-X.Y.Z`), sans alias.

Les globs positifs sont évalués par `minimatch`, avec les fichiers cachés inclus, sans négation ni commentaires ; chemins relatifs sensibles à la casse et séparateurs `/`. Anciens et nouveaux chemins des renommages sont pris en compte. Le chemin exact du catalogue configuré et `.github/workflows/**` imposent toujours le plan complet, même avec `force_all_paths` vide.

Les doublons YAML, alias, propriétés inconnues, dépendances absentes ou cycliques et tâches sans règle exploitable sont rejetés. Les identifiants suivent `[A-Za-z_][A-Za-z0-9_-]{0,63}`. `plan`, `ci-required`, `ci-contract`, `tasks`, `prototype` et les noms hérités d'`Object.prototype` sont réservés (liste exhaustive dans le schéma). Un catalogue vide est valide et donne `has-tasks: 'false'` ; un catalogue absent ou illisible est une erreur bloquante.

## Contrat de l'action

| Input | Défaut | Rôle |
| --- | --- | --- |
| `config` | `.github/ci-selector.yml` | Chemin relatif du catalogue fiable |
| `mode` | `shadow` | `shadow` ou `enforce` |
| `github-token` | `${{ github.token }}` | Lecture Git, `contents: read` |
| `api-key` | vide | Clé TypeSafe ; absence → plan complet |
| `allow-external-context` | `false` | Consentement explicite à l'envoi du contexte |
| `force-all` | `false` | Retour immédiat à toutes les tâches |
| `timeout-ms` | `10000` | Budget d'un appel Jev, sans reprise |
| `max-diff-bytes` | `65536` | Taille maximale du diff UTF-8 complet |

Les booléens d'entrée acceptent seulement `true` et `false`. Les budgets doivent être des entiers positifs ; le timeout est limité à la capacité des timers Node (`2147483647` ms).

| Output | Valeur |
| --- | --- |
| `run` | Objet JSON, un booléen effectif pour chaque tâche |
| `selected` | Tableau JSON des identifiants effectifs |
| `matrix` | `{"include":[{"task":"…"}]}` |
| `has-tasks` | Chaîne `true` ou `false` |
| `status` | `planned`, `bypassed` ou `fallback` |
| `tested-sha` | SHA immuable à tester |
| `report-path` | Rapport JSON local, sur le runner de planification |

Les clés et tableaux de tâches sont triés par identifiant. En `shadow`, **tous les outputs de sélection restent complets**, même si la proposition est vide. La proposition apparaît uniquement dans `tasks.*.proposed_run` du rapport. Le mode `enforce` applique la proposition et ses dépendances ; son activation est une décision explicite du consommateur.

`planned` : calcul achevé, éventuellement entièrement déterministe. `bypassed` : exécution complète volontaire (fork, clé absente, refus d'envoi, `force-all`, chemins protégés ou événement hors PR). `fallback` : exécution complète après problème de collecte, timeout, réseau/API ou réponse invalide. Les fallbacks sont publiés comme plans complets valides. Une configuration invalide ou une erreur interne bloque le planificateur ; aucun plan valide ne doit alors être accepté par `ci-required`.

## Collecte et appel Jev

Pour une PR, `config_sha = base_sha = event.pull_request.base.sha`, `head_sha = event.pull_request.head.sha`, `tested_sha = GITHUB_SHA`. Le catalogue est lu dans **l'objet Git de base**, jamais dans la copie modifiée par la PR. Le diff est `base_sha → tested_sha` et les deux parents du commit testé doivent être exactement `[base_sha, head_sha]`. Aucun nom de branche n'est résolu vers son état actuel ; une ancienne exécution reste attachée à ses SHA. Si ces objets ne sont plus récupérables, la sélection revient à toutes les tâches, ou échoue si le catalogue fiable lui-même manque.

La collecte utilise un dépôt temporaire nu, des arguments Git séparés, aucun checkout, aucun sous-module initialisé et aucun script du projet. Les diff/conversions externes, hooks et configurations Git externes sont neutralisés. Ajouts, suppressions, renommages et modes sont inclus. Contenu binaire, gitlink modifié, UTF-8 invalide, sortie incomplète ou trop grande entraînent une exécution complète. Le diff n'est jamais tronqué pour autoriser une suppression de tests. En cas de bypass connu avant la collecte, aucune empreinte de diff n'est inventée.

Les objets sont récupérés par SHA avec une profondeur de 1. Les garde-fous internes limitent aussi le catalogue à 1 Mio (erreur bloquante), les métadonnées Git à 4 Mio et chaque blob inspecté à 16 Mio (exécution complète si la collecte ne peut aboutir).

Le SDK officiel `@typesafe-ai/sdk` appelle `TypeSafeClient.systemOne()` avec un état commun et un `noul()` indépendant par tâche restante. Une seule requête, `maxRetries: 0`, logs désactivés, endpoint explicite. Le type `noul`, les identifiants exacts, les probabilités finies dans `[0,1]`, le modèle retourné et l'usage sont validés. Toute réponse partielle ou invalide déclenche un fallback global.

La limite en octets n'est pas un budget de tokens : les limites TypeSafe s'appliquent à l'état et à la requête complète, questions comprises. Un rejet du fournisseur conserve toutes les tâches. Le rapport conserve les versions demandée/retournée, l'usage validé, les durées, les SHA, les empreintes SHA-256 et les motifs déterministes. Probabilité et proposition indisponibles valent `null`. Aucun code source, chemin de fichier changé, question ou corps brut d'erreur n'y figure.

## Expérimentation shadow

Conserver le rapport du job de planification comme artefact, puis recueillir les résultats et durées des jobs **au même `tested_sha` et pour la même exécution**. Ne pas joindre un ancien rapport avec le dernier état de la PR. Le rapport est local au runner ; son chemin seul n'en transfère pas le contenu vers un autre job.

Fournir un JSON de résultats avec exactement les identifiants du catalogue :

```json
{
  "tested_sha": "<SHA complet identique au rapport>",
  "tasks": {
    "unit": { "result": "success", "duration_ms": 15000 },
    "helm": { "result": "failure", "duration_ms": 8000, "classification": "regression" }
  },
  "relevant_tasks": ["helm"]
}
```

```sh
node scripts/analyze-shadow.mjs report.json results.json
```

L'outil refuse les SHA ou identifiants divergents. Il rapporte les tâches et durées qui auraient été évitées, le statut/fallback, les échecs qui auraient été manqués (`regression`, `flaky`, `infrastructure`, `unknown`) et les suites manuellement identifiées comme pertinentes mais proposées à l'exclusion. `skipped`/`cancelled` restent explicitement non observés. Les durées sont du temps de tâches, pas nécessairement du temps mur économisé si elles s'exécutent en parallèle.

Agréger ces résultats par catalogue, modèle et suite. Examiner les fallbacks et les faux négatifs ; classer manuellement les échecs, sans attribuer automatiquement chaque incident à une régression. Un test réussi ne prouve pas son inutilité : compléter les mesures par des changements annotés manuellement. Décider explicitement du passage à `enforce`, en laissant `always: true` aux suites encore en observation. Conserver des exécutions complètes de contrôle (notamment les autres événements), les contrôles indispensables obligatoires et le bouton `force-all`.

## Développement et validation

Node.js 24 et Git sont requis. Les dépendances sont verrouillées dans `package-lock.json`.

```sh
npm ci
npm run build
npm run check
```

`npm test` fonctionne sans clé TypeSafe ni accès au service : moteur pur, SDK avec HTTP simulé, dépôts Git temporaires réels, exécution du bundle et contrôles finaux extraits des workflows exemples. `check:dist` reconstruit en mémoire et compare les octets du bundle livré. Les sorties Git et HTTP simulées ne constituent pas une validation sur GitHub Actions ou sur le service TypeSafe réel.

Modules : `config.ts` valide ; `changes.ts` collecte ; `policy.ts` décide sans I/O ; `jev.ts` adapte le SDK ; `planner.ts` orchestre ; `report.ts` sérialise ; `action.ts` publie les outputs. L'analyse shadow est un outil local séparé. Le MVP ne découvre pas les tests, ne génère pas de commandes et ne construit pas de graphe GitHub dynamique.

Un test réel TypeSafe peut être lancé séparément, après autorisation explicite d'envoi et avec un diff non sensible. Il n'est ni requis ni exécuté par la suite normale. Aucune activation d'`enforce` ne découle de ce seul test.

## Références

- [TypeSafe : SDK JavaScript](https://docs.typesafe.ai/sdk/javascript), [Noul](https://docs.typesafe.ai/primitives/noul), [modèles et limites](https://docs.typesafe.ai/models), [limites face aux entrées adversariales](https://docs.typesafe.ai/model-jaggedness/jev-1.13).
- [GitHub : événements et commit de fusion](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request), [matrices](https://docs.github.com/en/actions/using-jobs/using-a-matrix-for-your-jobs), [conditions des jobs](https://docs.github.com/en/actions/using-jobs/using-conditions-to-control-job-execution), [sécurité](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions), [runtime et métadonnées](https://docs.github.com/en/actions/reference/workflows-and-actions/metadata-syntax).
- [Git : options de diff](https://git-scm.com/docs/git-diff).
