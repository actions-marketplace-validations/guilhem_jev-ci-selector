# Sécurité

Le planificateur manipule le contenu d'une PR comme une donnée non fiable. Il ne doit jamais partager son job avec un checkout, une installation de dépendances ou une exécution de code de cette PR. Les commandes CI appartiennent aux jobs consommateurs.

- Utiliser `pull_request`, jamais `pull_request_target` pour contourner la disponibilité des secrets. Les forks exécutent toutes les tâches et ne contactent pas TypeSafe.
- Épingler l'action à un SHA complet revu, comprenant `dist/index.js`. Limiter le token à `contents: read`. Ne pas transmettre les secrets du planificateur aux tâches testant le code de la PR.
- La politique active est lue au SHA de base de l'événement. Les modifications du catalogue et des workflows imposent toutes les tâches. Une proposition de nouvelle configuration peut être validée séparément comme donnée, jamais exécutée ou utilisée comme politique active.
- Ne pas autoriser `allow-external-context` sans avoir approuvé l'envoi du diff, des chemins, SHA et questions à TypeSafe. Le mode `shadow` envoie aussi ce contexte quand il est autorisé. Il conserve toutes les tâches ; il ne supprime pas l'envoi.
- Les questions viennent de la base fiable ; le diff reste adversarial. Cette séparation ne garantit pas la résistance aux injections. Jev peut se tromper ou être influencé : garder les vérifications indispensables sous `always: true`.
- Le SDK a ses logs désactivés et ne reçoit aucun endpoint configurable depuis l'environnement. Ne pas ajouter de logs des corps, du diff, des credentials ou des erreurs brutes. Les messages publics sont fixes et le rapport contient seulement les métadonnées validées, empreintes, probabilités et codes de motifs.
- Garder `ci-required` obligatoire : un job sélectionné puis ignoré, annulé ou en échec doit refuser la validation. Maintenir ensemble catalogue, jobs, `needs` et tests de cohérence des exemples. Les jobs exécutant la PR conservent leur propre modèle de confiance.
- Pour un incident de sélection, régler immédiatement `force-all: 'true'` ou rétablir le mode `shadow`, puis comparer rapports et résultats au même SHA.

Les rapports révèlent des noms de tâches, des SHA et des probabilités : choisir leur visibilité et rétention selon les règles du dépôt. Ne pas inclure de secrets dans les identifiants du catalogue.

Le contrôle de cohérence des parents garantit le rattachement du diff à l'événement ; il ne vérifie pas la qualité sémantique d'une réponse Jev. Le MVP n'offre aucune garantie de détection de toutes les régressions. La mesure et la décision explicite d'activation restent à la charge du mainteneur.

Ce projet n'a pas encore de canal de signalement publié. Pour une instance distribuée, signaler une vulnérabilité en privé à ses mainteneurs, sans publier credentials ni code confidentiel dans un ticket public.
