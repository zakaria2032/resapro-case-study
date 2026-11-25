# Résultats détaillés des tests

Version : `v2.1-verifiee` (62a51d0243)

## admin.test.ts
- ✓ [C09] sans authentification → 401 et aucune donnée
- ✓ [C09] jeton falsifié → 401
- ✓ [C09] client connecté (non admin) → 403 et aucune donnée
- ✓ [C09] non-régression : un administrateur obtient les statistiques

## cancel.test.ts
- ✓ [C10] annuler une réservation confirmée libère le créneau
- ✓ [C10] le créneau libéré peut être réservé par un autre client
- ✓ [C11] annuler une réservation inexistante → erreur explicite
- ✓ [C11] annuler la réservation d'un autre client → erreur, réservation inchangée
- ✓ [C11] annuler deux fois → erreur explicite « déjà annulée »

## checkout.test.ts
- ✓ [C07] un navigateur qui envoie 1 € pour un créneau à 100 € paie quand même 30 € d'acompte
- ✓ [C07] un créneau déjà réservé ne peut pas être réservé une seconde fois
- ✓ [C07] non-régression : sans connexion → 401
- ✓ [C11] identifiant de créneau manquant → 400 avec message
- ✓ [C11] créneau inexistant → 404 avec message
- ✓ [C11] corps de requête illisible → 400

## frontend-secrets.test.ts
- ✓ [C04] aucune variable VITE_* sensible dans le code front ni dans .env.example
- ✓ [C04] le bundle de production ne contient pas la clé, même si elle est présente dans l'environnement

## gestion.test.ts
- ✓ [C17] session Stripe expirée → réservation annulée, créneau libre et à nouveau réservable
- ✓ [C17] une expiration reçue après paiement ne touche pas à la réservation confirmée
- ✓ [C17] l'acompte d'une réservation annulée est compté à part, pas dans le chiffre d'affaires

## parcours.test.ts
- ✓ [C16] un pro publie, un client réserve et paie, la réservation est confirmée avec facture

## rls.test.ts
- ✓ [C01] le client B ne peut pas lire la réservation du client A
- ✓ [C01] la liste complète vue par B ne contient que les réservations de B
- ✓ [C01] un visiteur non connecté ne voit aucune réservation
- ✓ [C01] un pro voit les réservations de ses créneaux, pas celles des autres pros
- ✓ [C02] la RLS est activée sur toutes les tables du schéma public
- ✓ [C02] aucune politique « using (true) » sur profils, réservations, paiements, notifications

## roles.test.ts
- ✓ [C03] un client ne peut pas passer son propre rôle à « admin »
- ✓ [C03] un pro ne peut pas passer son propre rôle à « admin »
- ✓ [C03] une inscription qui demande le rôle « admin » crée un simple client
- ✓ [C03] non-régression : inscription en tant que pro toujours possible
- ✓ [C03] le trigger de défense en profondeur bloque un changement de rôle même avec le droit de colonne
- ✓ [C03] non-régression : un utilisateur peut toujours modifier son nom

## storage.test.ts
- ✓ [C08] le bucket « invoices » n'est pas public
- ✓ [C08] le client B ne peut pas lire la facture du client A
- ✓ [C08] un visiteur non connecté ne peut lire aucune facture
- ✓ [C08] non-régression : le client A lit bien sa facture

## webhook.test.ts
- ✓ [C05] sans en-tête Stripe-Signature → 400 et réservation non confirmée
- ✓ [C05] signature calculée avec un mauvais secret → 400
- ✓ [C05] corps modifié après signature → 400
- ✓ [C05] signature valide mais trop ancienne (> 5 min) → 400
- ✓ [C05] montant signé différent de l'acompte → non confirmée, anomalie tracée
- ✓ [C05] paiement reçu après annulation → non confirmé, anomalie tracée
- ✓ [C05] non-régression : un événement correctement signé confirme la réservation
- ✓ [C06] le même événement reçu deux fois → 1 paiement, 1 notification
- ✓ [C06] rejeu isolé : même si la réservation repasse « en attente », l'événement n'est pas retraité
