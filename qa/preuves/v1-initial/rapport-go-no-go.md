# Rapport Go/No-Go — RésaPro `v1-initial`

**VERDICT : NO-GO** — 13 contrôle(s) bloquant(s) en échec : C01, C02, C03, C04, C05, C06, C07, C08, C09, C10, C11, C12, C17

| | |
|---|---|
| Version contrôlée | `v1-initial` — commit `d1f966914a9d7b63014fecbbd39c6d0c94bd5c91` |
| Batterie de tests | `HEAD` — commit `62a51d0243` (la même batterie s'applique à toutes les versions comparées) |
| Tests automatisés | 10/46 réussis |
| Date | 2026-11-24 14:37 UTC |
| Responsable | Zakaria |
| Preuves brutes | `qa/preuves/v1-initial/` (logs, JSON vitest, rapports gitleaks) |

## Couche 1 — contrôles déterministes (bloquants)

| ID | Contrôle | Problème | Résultat | Preuve |
|---|---|---|---|---|
| C01 | Un client ne voit que ses propres réservations (test multi-comptes) | #1 | ❌ FAIL | 0/4 tests réussis<br>✗ le client B ne peut pas lire la réservation du client A — `AssertionError: expected [ Array(1) ] to have a length of +0 but got 1`<br>✗ la liste complète vue par B ne contient que les réservations de B — `AssertionError: expected [ …(21) ] to deeply equal [ Array(1) ]`<br>✗ un visiteur non connecté ne voit aucune réservation — `AssertionError: expected [ …(21) ] to have a length of +0 but got 21`<br>✗ un pro voit les réservations de ses créneaux, pas celles des autres pros — `AssertionError: expected [ …(21) ] to deeply equal [ …(2) ]` <br>_Source : tests/rls.test.ts_ |
| C02 | RLS active sur toutes les tables, aucune règle « using (true) » sur les tables sensibles | #1 | ❌ FAIL | 1/2 tests réussis<br>✗ aucune politique « using (true) » sur profils, réservations, paiements, notifications — `AssertionError: expected [ Array(1) ] to deeply equal []` <br>_Source : tests/rls.test.ts_ |
| C03 | Impossible de devenir admin soi-même (modification du rôle, inscription) | #2 | ❌ FAIL | 2/6 tests réussis<br>✗ un client ne peut pas passer son propre rôle à « admin » — `AssertionError: expected undefined to be '42501' // Object.is equality`<br>✗ un pro ne peut pas passer son propre rôle à « admin » — `AssertionError: expected undefined to be '42501' // Object.is equality`<br>✗ une inscription qui demande le rôle « admin » crée un simple client — `AssertionError: expected 'admin' to be 'client' // Object.is equality`<br>✗ le trigger de défense en profondeur bloque un changement de rôle même avec le droit de colonne — `TypeError: .toMatch() expects to receive a string, but got undefined` <br>_Source : tests/roles.test.ts_ |
| C04 | Aucune clé service_role dans le code ou le bundle front | #3 | ❌ FAIL | 0/2 tests réussis<br>✗ aucune variable VITE_* sensible dans le code front ni dans .env.example — `AssertionError: expected [ …(3) ] to deeply equal []`<br>✗ le bundle de production ne contient pas la clé, même si elle est présente dans l'environnement — `AssertionError: expected [ 'dist/assets/index-BVHn9iZ9.js' ] to deeply equal []` <br>_Source : tests/frontend-secrets.test.ts_ |
| C05 | Webhook Stripe : signature absente, fausse, altérée ou expirée refusée ; montant ou statut incohérent non confirmé et tracé | #4 | ❌ FAIL | 1/7 tests réussis<br>✗ sans en-tête Stripe-Signature → 400 et réservation non confirmée — `AssertionError: expected 200 to be 400 // Object.is equality`<br>✗ signature calculée avec un mauvais secret → 400 — `AssertionError: expected 200 to be 400 // Object.is equality`<br>✗ corps modifié après signature → 400 — `AssertionError: expected 200 to be 400 // Object.is equality`<br>✗ signature valide mais trop ancienne (> 5 min) → 400 — `AssertionError: expected 200 to be 400 // Object.is equality`<br>✗ montant signé différent de l'acompte → non confirmée, anomalie tracée — `AssertionError: expected 'confirmed' to be 'pending_payment' // Object.is equality`<br>✗ paiement reçu après annulation → non confirmé, anomalie tracée — `AssertionError: expected 'confirmed' to be 'cancelled' // Object.is equality` <br>_Source : tests/webhook.test.ts_ |
| C06 | Webhook Stripe : un événement rejoué est traité une seule fois | #4 | ❌ FAIL | 0/2 tests réussis<br>✗ le même événement reçu deux fois → 1 paiement, 1 notification — `AssertionError: expected 2 to be 1 // Object.is equality`<br>✗ rejeu isolé : même si la réservation repasse « en attente », l'événement n'est pas retraité — `AssertionError: expected 2 to be 1 // Object.is equality` <br>_Source : tests/webhook.test.ts_ |
| C07 | Montant de l'acompte calculé côté serveur | #5 | ❌ FAIL | 2/3 tests réussis<br>✗ un navigateur qui envoie 1 € pour un créneau à 100 € paie quand même 30 € d'acompte — `AssertionError: expected 100 to be 3000 // Object.is equality` <br>_Source : tests/checkout.test.ts_ |
| C08 | Factures privées (bucket non public, lecture réservée au propriétaire) | #6 | ❌ FAIL | 1/4 tests réussis<br>✗ le bucket « invoices » n'est pas public — `AssertionError: expected true to be false // Object.is equality`<br>✗ le client B ne peut pas lire la facture du client A — `AssertionError: expected [ Array(1) ] to have a length of +0 but got 1`<br>✗ un visiteur non connecté ne peut lire aucune facture — `AssertionError: expected [ …(18) ] to have a length of +0 but got 18` <br>_Source : tests/storage.test.ts_ |
| C09 | Fonction admin : 401 sans compte, 403 si non admin | #7 | ❌ FAIL | 1/4 tests réussis<br>✗ sans authentification → 401 et aucune donnée — `AssertionError: expected 200 to be 401 // Object.is equality`<br>✗ jeton falsifié → 401 — `AssertionError: expected 200 to be 401 // Object.is equality`<br>✗ client connecté (non admin) → 403 et aucune donnée — `AssertionError: expected 200 to be 403 // Object.is equality` <br>_Source : tests/admin.test.ts_ |
| C10 | L'annulation libère le créneau | #8 | ❌ FAIL | 0/2 tests réussis<br>✗ annuler une réservation confirmée libère le créneau — `AssertionError: expected true to be false // Object.is equality`<br>✗ le créneau libéré peut être réservé par un autre client — `AssertionError: expected 409 to be 200 // Object.is equality` <br>_Source : tests/cancel.test.ts_ |
| C11 | Erreurs gérées (réponses 400/404/409 explicites, aucun plantage) | #8 | ❌ FAIL | 0/6 tests réussis<br>✗ annuler une réservation inexistante → erreur explicite — `TypeError: .toMatch() expects to receive a string, but got undefined`<br>✗ annuler la réservation d'un autre client → erreur, réservation inchangée — `AssertionError: expected undefined to be defined`<br>✗ annuler deux fois → erreur explicite « déjà annulée » — `TypeError: .toMatch() expects to receive a string, but got undefined`<br>✗ identifiant de créneau manquant → 400 avec message — `AssertionError: expected true to be false // Object.is equality`<br>✗ créneau inexistant → 404 avec message — `AssertionError: expected true to be false // Object.is equality`<br>✗ corps de requête illisible → 400 — `AssertionError: expected true to be false // Object.is equality` <br>_Source : tests/checkout.test.ts, tests/cancel.test.ts_ |
| C12 | Tests automatisés présents dans la version et README complet | #9 | ❌ FAIL | 0 fichier(s) de test dans la version ; README : 81 caractères, sections installation ✗, tests ✗, avertissement v1 ✗, limites ✗ <br>_Source : arborescence git de la version_ |
| C13 | Build OK (typage TypeScript + build Vite) | — | ✅ PASS | tsc : code 0 ; vite build : code 0 <br>_Source : build.log_ |
| C14 | Lint OK (ESLint) | — | ✅ PASS | eslint : code 0 <br>_Source : lint.log_ |
| C15 | Scan de secrets : 0 fuite (fichiers + historique git) | — | ✅ PASS | gitleaks : 0 fuite(s) dans les fichiers, 0 dans l'historique git <br>_Source : gitleaks-*.json_ |
| C16 | Parcours complet inscription → réservation → paiement → confirmation (non-régression) | — | ✅ PASS | 1/1 tests réussis <br>_Source : tests/parcours.test.ts_ |
| C17 | Gestion : paiement abandonné → créneau remis en vente ; chiffre d'affaires admin hors annulations (ajout v2.1) | v2.1 | ❌ FAIL | 1/3 tests réussis<br>✗ session Stripe expirée → réservation annulée, créneau libre et à nouveau réservable — `AssertionError: expected { status: 'pending_payment', …(1) } to deeply equal { status: 'cancelled', …(1) }`<br>✗ l'acompte d'une réservation annulée est compté à part, pas dans le chiffre d'affaires — `AssertionError: expected 4500 to be 3000 // Object.is equality` <br>_Source : tests/gestion.test.ts_ |

Détail test par test : `tests-detail.md`.

## Couches 2 et 3 (non automatisées)

- Couche 2 — conformité critère par critère : relecture par une session neuve ou un autre modèle, qui doit citer l'endroit précis du livrable (voir `qa/criteres.md`).
- Couche 3 — qualité rédactionnelle : consultative.

## Réserves

- Version non livrable en l'état : corriger les contrôles en échec.

## Non testé (hors périmètre)

- Vrai Supabase : HOCS tourne sur PostgreSQL 16 avec une émulation des schémas auth et storage. L'exécution sur un vrai Supabase local (CLI + Docker : migrations, Auth, Storage, Edge Functions) est vérifiée séparément : `qa/verification-supabase-local.md`.
- Edge Functions : logique testée sous Node ; sous Deno, `deno check` et un test de fumée (tests/deno/smoke.ts, hors HOCS).
- Appels réels à l'API Stripe (mode test) : non exécutés ; faux client dans les tests, Stripe simulé (webhooks signés) pour la vérification manuelle.
- Interface web : hors HOCS (build, typage et lint uniquement) ; parcours vérifié dans un navigateur séparément (`npm run test:e2e`).
- HOCS est notre contrôle qualité interne : ni une certification indépendante, ni un audit complet, ni un test d'intrusion.
