Les commandes citant des tags (v1-initial, v2-corrigee) s'exécutent dans le dépôt complet, disponible sur demande ; ici, leurs résultats sont figés dans qa/.

# Critères d'acceptation — reprise RésaPro (v1 → v2)

Écrits **avant** les corrections, à partir du diagnostic (`docs/diagnostic.md`).
Chaque critère est vérifiable par une commande : `python3 scripts/hocs.py --ref <version>`.
Résultat attendu : **NO-GO sur `v1-initial`**, **GO sur `v2-corrigee`** (avec sa propre batterie, `--tests v2-corrigee`) et **GO sur `v2.1-verifiee`** (batterie complète, C01 à C17).

## Couche 1 — contrôles déterministes (tous bloquants)

| ID | Critère d'acceptation | Problème | Vérification |
|---|---|---|---|
| C01 | Un client ne lit que ses réservations ; un pro ne lit que celles de ses créneaux ; un visiteur anonyme n'en lit aucune | #1 | `tests/rls.test.ts` (3 comptes + anonyme) |
| C02 | RLS activée sur 100 % des tables `public` ; aucune politique `using (true)` / `with check (true)` sur `profiles`, `bookings`, `payments`, `notifications`, `stripe_events` | #1 | `tests/rls.test.ts` (requête sur `pg_class` / `pg_policies`) |
| C03 | Ni un client ni un pro ne peut modifier son rôle ; une inscription demandant `admin` donne `client` ; modifier son nom reste possible | #2 | `tests/roles.test.ts` |
| C04 | Aucune variable `VITE_*SERVICE_ROLE*` / `*SECRET*` dans `src/` ni `.env.example` ; le bundle de production ne contient pas la clé même si elle est définie dans l'environnement | #3 | `tests/frontend-secrets.test.ts` (build avec valeur canari) |
| C05 | Le webhook répond 400 et ne modifie rien si la signature est absente, fausse, si le corps a été modifié ou si l'horodatage a plus de 5 min ; un événement correctement signé confirme la réservation ; _(ajout après relecture couche 2)_ un paiement d'un montant différent de l'acompte ou reçu après annulation n'est pas confirmé et est tracé comme anomalie | #4 | `tests/webhook.test.ts` |
| C06 | Un même événement Stripe reçu 2 fois produit 1 paiement et 1 notification, y compris si la réservation est repassée « en attente » entre-temps | #4 | `tests/webhook.test.ts` |
| C07 | Le montant transmis à Stripe et enregistré est 30 % du prix en base, quel que soit le montant envoyé par le navigateur ; un créneau réservé ne peut pas l'être deux fois (409) | #5 | `tests/checkout.test.ts` |
| C08 | Bucket `invoices` non public ; un autre client et un anonyme ne peuvent ni lire ni lister une facture ; le propriétaire la lit | #6 | `tests/storage.test.ts` |
| C09 | Fonction `admin-stats` : 401 sans jeton ou jeton invalide, 403 pour un non-admin (sans aucune donnée), 200 pour un admin | #7 | `tests/admin.test.ts` |
| C10 | Annuler une réservation remet le créneau en vente ; un autre client peut ensuite le réserver | #8 | `tests/cancel.test.ts` |
| C11 | Erreurs explicites et sans plantage : corps illisible ou champ manquant → 400, créneau inexistant → 404 ; annulation inexistante → « introuvable », d'autrui → refus, double → « déjà annulée » | #8 | `tests/checkout.test.ts`, `tests/cancel.test.ts` |
| C12 | La version contient ≥ 5 fichiers de tests et un README avec sections Installation, Tests, Limites et l'avertissement « NE PAS DÉPLOYER » pour la v1 | #9 | `git ls-tree` + contenu du README |
| C13 | `tsc --noEmit` et `vite build` sans erreur | — | `build.log` |
| C14 | `eslint .` sans erreur | — | `lint.log` |
| C15 | `gitleaks` : 0 fuite dans les fichiers de la version et dans l'historique Git | — | `gitleaks-*.json` |
| C16 | Parcours complet : un pro publie un créneau, un client le réserve, Stripe confirme, le client voit sa réservation confirmée, sa notification et sa facture | — | `tests/parcours.test.ts` |
| C17 | _(ajout v2.1, après vérification sur un vrai Supabase)_ Une session de paiement expirée annule la réservation en attente et remet le créneau en vente, sans toucher une réservation déjà payée ; le chiffre d'affaires admin exclut les acomptes des réservations annulées, comptés à part | v2.1 | `tests/gestion.test.ts` |

## Couche 2 — conformité aux livrables du cahier des charges (relecture, doit citer l'endroit)

| Livrable attendu | Où le trouver |
|---|---|
| Diagnostic priorisé (gravité, preuve, impact simple, correctif) | `docs/diagnostic.md` |
| Un commit par correctif, tags `v1-initial` et `v2-corrigee` | `git log --oneline v1-initial..v2-corrigee` |
| Tests : RLS 2 comptes, escalade de rôle, webhook (signature + rejeu), montant serveur, annulation | `tests/` |
| Critères + rapport Go/No-Go avec preuves | `qa/criteres.md`, `qa/rapport-go-no-go.md`, `qa/preuves/` |
| Script de contrôle | `scripts/hocs.py` |
| README (présentation, installation, tests, avertissement v1) | `README.md` |
| Étude de cas avant/après lisible par un non-technicien | `docs/etude-de-cas.md` |
| Aucun vrai secret, `.env.example` seulement, données fictives | C15 + `.env.example` + `tests/helpers/db.ts` |

## Couche 3 — qualité rédactionnelle (consultative)

- Le diagnostic et l'étude de cas sont compréhensibles par un non-technicien (phrases courtes, impact métier avant le détail technique).
- Aucune promesse d'« audit complet », de « test d'intrusion » ou de « 100 % sécurisé ».
