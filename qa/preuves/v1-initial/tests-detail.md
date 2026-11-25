# Résultats détaillés des tests

Version : `v1-initial` (d1f966914a)

## admin.test.ts
- ✗ [C09] sans authentification → 401 et aucune donnée — `AssertionError: expected 200 to be 401 // Object.is equality`
- ✗ [C09] jeton falsifié → 401 — `AssertionError: expected 200 to be 401 // Object.is equality`
- ✗ [C09] client connecté (non admin) → 403 et aucune donnée — `AssertionError: expected 200 to be 403 // Object.is equality`
- ✓ [C09] non-régression : un administrateur obtient les statistiques

## cancel.test.ts
- ✗ [C10] annuler une réservation confirmée libère le créneau — `AssertionError: expected true to be false // Object.is equality`
- ✗ [C10] le créneau libéré peut être réservé par un autre client — `AssertionError: expected 409 to be 200 // Object.is equality`
- ✗ [C11] annuler une réservation inexistante → erreur explicite — `TypeError: .toMatch() expects to receive a string, but got undefined`
- ✗ [C11] annuler la réservation d'un autre client → erreur, réservation inchangée — `AssertionError: expected undefined to be defined`
- ✗ [C11] annuler deux fois → erreur explicite « déjà annulée » — `TypeError: .toMatch() expects to receive a string, but got undefined`

## checkout.test.ts
- ✗ [C07] un navigateur qui envoie 1 € pour un créneau à 100 € paie quand même 30 € d'acompte — `AssertionError: expected 100 to be 3000 // Object.is equality`
- ✓ [C07] un créneau déjà réservé ne peut pas être réservé une seconde fois
- ✓ [C07] non-régression : sans connexion → 401
- ✗ [C11] identifiant de créneau manquant → 400 avec message — `AssertionError: expected true to be false // Object.is equality`
- ✗ [C11] créneau inexistant → 404 avec message — `AssertionError: expected true to be false // Object.is equality`
- ✗ [C11] corps de requête illisible → 400 — `AssertionError: expected true to be false // Object.is equality`

## frontend-secrets.test.ts
- ✗ [C04] aucune variable VITE_* sensible dans le code front ni dans .env.example — `AssertionError: expected [ …(3) ] to deeply equal []`
- ✗ [C04] le bundle de production ne contient pas la clé, même si elle est présente dans l'environnement — `AssertionError: expected [ 'dist/assets/index-BVHn9iZ9.js' ] to deeply equal []`

## gestion.test.ts
- ✗ [C17] session Stripe expirée → réservation annulée, créneau libre et à nouveau réservable — `AssertionError: expected { status: 'pending_payment', …(1) } to deeply equal { status: 'cancelled', …(1) }`
- ✓ [C17] une expiration reçue après paiement ne touche pas à la réservation confirmée
- ✗ [C17] l'acompte d'une réservation annulée est compté à part, pas dans le chiffre d'affaires — `AssertionError: expected 4500 to be 3000 // Object.is equality`

## parcours.test.ts
- ✓ [C16] un pro publie, un client réserve et paie, la réservation est confirmée avec facture

## rls.test.ts
- ✗ [C01] le client B ne peut pas lire la réservation du client A — `AssertionError: expected [ Array(1) ] to have a length of +0 but got 1`
- ✗ [C01] la liste complète vue par B ne contient que les réservations de B — `AssertionError: expected [ …(21) ] to deeply equal [ Array(1) ]`
- ✗ [C01] un visiteur non connecté ne voit aucune réservation — `AssertionError: expected [ …(21) ] to have a length of +0 but got 21`
- ✗ [C01] un pro voit les réservations de ses créneaux, pas celles des autres pros — `AssertionError: expected [ …(21) ] to deeply equal [ …(2) ]`
- ✓ [C02] la RLS est activée sur toutes les tables du schéma public
- ✗ [C02] aucune politique « using (true) » sur profils, réservations, paiements, notifications — `AssertionError: expected [ Array(1) ] to deeply equal []`

## roles.test.ts
- ✗ [C03] un client ne peut pas passer son propre rôle à « admin » — `AssertionError: expected undefined to be '42501' // Object.is equality`
- ✗ [C03] un pro ne peut pas passer son propre rôle à « admin » — `AssertionError: expected undefined to be '42501' // Object.is equality`
- ✗ [C03] une inscription qui demande le rôle « admin » crée un simple client — `AssertionError: expected 'admin' to be 'client' // Object.is equality`
- ✓ [C03] non-régression : inscription en tant que pro toujours possible
- ✗ [C03] le trigger de défense en profondeur bloque un changement de rôle même avec le droit de colonne — `TypeError: .toMatch() expects to receive a string, but got undefined`
- ✓ [C03] non-régression : un utilisateur peut toujours modifier son nom

## storage.test.ts
- ✗ [C08] le bucket « invoices » n'est pas public — `AssertionError: expected true to be false // Object.is equality`
- ✗ [C08] le client B ne peut pas lire la facture du client A — `AssertionError: expected [ Array(1) ] to have a length of +0 but got 1`
- ✗ [C08] un visiteur non connecté ne peut lire aucune facture — `AssertionError: expected [ …(18) ] to have a length of +0 but got 18`
- ✓ [C08] non-régression : le client A lit bien sa facture

## webhook.test.ts
- ✗ [C05] sans en-tête Stripe-Signature → 400 et réservation non confirmée — `AssertionError: expected 200 to be 400 // Object.is equality`
- ✗ [C05] signature calculée avec un mauvais secret → 400 — `AssertionError: expected 200 to be 400 // Object.is equality`
- ✗ [C05] corps modifié après signature → 400 — `AssertionError: expected 200 to be 400 // Object.is equality`
- ✗ [C05] signature valide mais trop ancienne (> 5 min) → 400 — `AssertionError: expected 200 to be 400 // Object.is equality`
- ✗ [C05] montant signé différent de l'acompte → non confirmée, anomalie tracée — `AssertionError: expected 'confirmed' to be 'pending_payment' // Object.is equality`
- ✗ [C05] paiement reçu après annulation → non confirmé, anomalie tracée — `AssertionError: expected 'confirmed' to be 'cancelled' // Object.is equality`
- ✓ [C05] non-régression : un événement correctement signé confirme la réservation
- ✗ [C06] le même événement reçu deux fois → 1 paiement, 1 notification — `AssertionError: expected 2 to be 1 // Object.is equality`
- ✗ [C06] rejeu isolé : même si la réservation repasse « en attente », l'événement n'est pas retraité — `AssertionError: expected 2 to be 1 // Object.is equality`
