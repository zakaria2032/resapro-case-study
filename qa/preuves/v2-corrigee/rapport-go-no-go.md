# Rapport Go/No-Go — RésaPro `v2-corrigee`

**VERDICT : GO** — tous les contrôles évalués sont PASS (non évalués : C17)

| | |
|---|---|
| Version contrôlée | `v2-corrigee` — commit `1ddb2b90c800165f00488fcf4cdd10e2ed2c2a09` |
| Batterie de tests | `v2-corrigee` — commit `1ddb2b90c8` (la même batterie s'applique à toutes les versions comparées) |
| Tests automatisés | 43/43 réussis |
| Date | 2026-11-24 14:38 UTC |
| Responsable | Zakaria |
| Preuves brutes | `qa/preuves/v2-corrigee/` (logs, JSON vitest, rapports gitleaks) |

## Couche 1 — contrôles déterministes (bloquants)

| ID | Contrôle | Problème | Résultat | Preuve |
|---|---|---|---|---|
| C01 | Un client ne voit que ses propres réservations (test multi-comptes) | #1 | ✅ PASS | 4/4 tests réussis <br>_Source : tests/rls.test.ts_ |
| C02 | RLS active sur toutes les tables, aucune règle « using (true) » sur les tables sensibles | #1 | ✅ PASS | 2/2 tests réussis <br>_Source : tests/rls.test.ts_ |
| C03 | Impossible de devenir admin soi-même (modification du rôle, inscription) | #2 | ✅ PASS | 6/6 tests réussis <br>_Source : tests/roles.test.ts_ |
| C04 | Aucune clé service_role dans le code ou le bundle front | #3 | ✅ PASS | 2/2 tests réussis <br>_Source : tests/frontend-secrets.test.ts_ |
| C05 | Webhook Stripe : signature absente, fausse, altérée ou expirée refusée ; montant ou statut incohérent non confirmé et tracé | #4 | ✅ PASS | 7/7 tests réussis <br>_Source : tests/webhook.test.ts_ |
| C06 | Webhook Stripe : un événement rejoué est traité une seule fois | #4 | ✅ PASS | 2/2 tests réussis <br>_Source : tests/webhook.test.ts_ |
| C07 | Montant de l'acompte calculé côté serveur | #5 | ✅ PASS | 3/3 tests réussis <br>_Source : tests/checkout.test.ts_ |
| C08 | Factures privées (bucket non public, lecture réservée au propriétaire) | #6 | ✅ PASS | 4/4 tests réussis <br>_Source : tests/storage.test.ts_ |
| C09 | Fonction admin : 401 sans compte, 403 si non admin | #7 | ✅ PASS | 4/4 tests réussis <br>_Source : tests/admin.test.ts_ |
| C10 | L'annulation libère le créneau | #8 | ✅ PASS | 2/2 tests réussis <br>_Source : tests/cancel.test.ts_ |
| C11 | Erreurs gérées (réponses 400/404/409 explicites, aucun plantage) | #8 | ✅ PASS | 6/6 tests réussis <br>_Source : tests/checkout.test.ts, tests/cancel.test.ts_ |
| C12 | Tests automatisés présents dans la version et README complet | #9 | ✅ PASS | 9 fichier(s) de test dans la version ; README : 9546 caractères, sections installation ✓, tests ✓, avertissement v1 ✓, limites ✓ <br>_Source : arborescence git de la version_ |
| C13 | Build OK (typage TypeScript + build Vite) | — | ✅ PASS | tsc : code 0 ; vite build : code 0 <br>_Source : build.log_ |
| C14 | Lint OK (ESLint) | — | ✅ PASS | eslint : code 0 <br>_Source : lint.log_ |
| C15 | Scan de secrets : 0 fuite (fichiers + historique git) | — | ✅ PASS | gitleaks : 0 fuite(s) dans les fichiers, 0 dans l'historique git <br>_Source : gitleaks-*.json_ |
| C16 | Parcours complet inscription → réservation → paiement → confirmation (non-régression) | — | ✅ PASS | 1/1 tests réussis <br>_Source : tests/parcours.test.ts_ |
| C17 | Gestion : paiement abandonné → créneau remis en vente ; chiffre d'affaires admin hors annulations (ajout v2.1) | v2.1 | ➖ N/A | absent de la batterie de tests `v2-corrigee` <br>_Source : tests/gestion.test.ts_ |

Détail test par test : `tests-detail.md`.

## Couches 2 et 3 (non automatisées)

- Couche 2 — conformité critère par critère : relecture par une session neuve ou un autre modèle, qui doit citer l'endroit précis du livrable (voir `qa/criteres.md`).
- Couche 3 — qualité rédactionnelle : consultative.

## Réserves

- Aucune.

## Non testé (hors périmètre)

- Vrai Supabase : HOCS tourne sur PostgreSQL 16 avec une émulation des schémas auth et storage. L'exécution sur un vrai Supabase local (CLI + Docker : migrations, Auth, Storage, Edge Functions) est vérifiée séparément : `qa/verification-supabase-local.md`.
- Edge Functions : logique testée sous Node ; sous Deno, `deno check` et un test de fumée (tests/deno/smoke.ts, hors HOCS).
- Appels réels à l'API Stripe (mode test) : non exécutés ; faux client dans les tests, Stripe simulé (webhooks signés) pour la vérification manuelle.
- Interface web : hors HOCS (build, typage et lint uniquement) ; parcours vérifié dans un navigateur séparément (`npm run test:e2e`).
- HOCS est notre contrôle qualité interne : ni une certification indépendante, ni un audit complet, ni un test d'intrusion.
