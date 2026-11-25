# Vérification sur un vrai Supabase local et dans un navigateur — RésaPro `v2` puis `v2.1`

> Complément aux rapports HOCS (qui tournent sur PostgreSQL avec une émulation de Supabase).
> Ici, l'application complète est exécutée sur le **vrai** Supabase (CLI + Docker), en local uniquement,
> avec des comptes fictifs `@example.test`. Aucune mise en ligne, aucun appel à Stripe, aucun débit.

| | |
|---|---|
| Date | 2026-11-24 |
| Environnement | Windows 11, Docker Desktop 29.8, Node 24, Python 3.14, Deno 2.9, gitleaks 8.30 |
| Supabase | CLI 3.3.0 (`npx supabase`) — Postgres, GoTrue, PostgREST, Storage API 1.98, edge-runtime 1.79 |
| Paiement | `scripts/stripe-simule.mjs` (Stripe simulé, webhook signé HMAC-SHA256 comme Stripe) |
| Navigateur | Google Chrome (headless) via `playwright-core` — `npm run test:e2e` |
| Responsable | Zakaria |

## 1. Intégrité du dépôt

| Vérification | Résultat |
|---|---|
| `git fsck --full --strict` | ✅ aucune erreur |
| Tags `v1-initial` → `d1f9669`, `v2-corrigee` → `1ddb2b9` (tags annotés) | ✅ conformes aux rapports |
| Le commit taggé `v2-corrigee` ne modifie que `qa/` par rapport au commit contrôlé `6222c80` | ✅ |

## 2. Contrôles automatisés (rejoués)

| Commande | Résultat |
|---|---|
| `npm test` | ✅ 43/43 (après correctif Windows du test C04, voir §5) |
| `npm run typecheck`, `npm run lint` | ✅ |
| `npm run test:deno` (`deno check` + test de fumée) | ✅ |
| `python scripts/hocs.py --ref v1-initial` | ✅ **NO-GO** attendu — 12 contrôles en échec, 9/43 tests (mêmes contrôles et mêmes tests en échec que le rapport de référence) |
| `python scripts/hocs.py --ref v2-corrigee` | ✅ **GO** — 16/16 contrôles, 43/43 tests (identique au rapport de référence) |
| `python scripts/hocs.py` (HEAD, après les correctifs ci-dessous) | ✅ **GO** — 16/16, 43/43 |
| `npm audit` | ✅ 0 vulnérabilité |

## 3. Vrai Supabase local

| Vérification | Résultat |
|---|---|
| `supabase start` puis `supabase db reset` : les 7 migrations s'appliquent | ✅ |
| Les 3 Edge Functions servies par edge-runtime | ✅ (après correctif §5-a) |
| Inscription demandant le rôle `admin` | ✅ profil créé en `client` |
| Client → `PATCH profiles set role = 'admin'` | ✅ refusé (`42501`) |
| Client B / anonyme lisent les réservations du client A | ✅ 0 ligne |
| Client B signe ou liste la facture du client A ; lecture publique du bucket | ✅ refusé (404 / liste vide / 400) |
| `admin-stats` : sans jeton / client / admin | ✅ 401 / 403 / 200 |
| Webhook à signature fausse | ✅ 400 |
| Réservation avec `amount_cents: 100` envoyé par le client pour un créneau à 90 € | ✅ acompte facturé 27 € (calculé par le serveur) |
| Paiement → confirmation, paiement, notification, facture dans le bucket privé | ✅ |
| Annulation par un autre client / double annulation | ✅ « Réservation introuvable » / « Réservation déjà annulée » |
| Annulation par le client → créneau remis en vente | ✅ |
| Bundle de production : clés `service_role` / `sb_secret_` réelles absentes | ✅ |

## 4. Parcours dans le navigateur (`npm run test:e2e`)

15/15 vérifications, aucune erreur console ni réponse HTTP en erreur, exécuté plusieurs fois (dont après `supabase db reset`) :

1. Un pro s'inscrit, publie un créneau à 80 € ; il apparaît dans « Mes créneaux ».
2. Un client voit le créneau (acompte estimé 24 €), clique « Réserver » → page de paiement simulé : **24,00 €** fixé par le serveur.
3. « Payer » → retour sur l'application, réservation **Confirmée — acompte 24,00 €**.
4. « Facture » → facture affichée (lien signé 60 s, rendu dans une iframe isolée).
5. Le pro voit son créneau « réservé ».
6. Le client annule → « Annulée », le créneau est de nouveau proposé.
7. Paiement abandonné (« Annuler » sur la page de paiement) → message « Paiement annulé », réservation « En attente de paiement ».
8. Un second client ne voit pas le créneau en attente.
9. Un admin (rôle attribué en SQL) voit les statistiques via la fonction serveur ; le client n'a pas d'onglet Administration.

## 5. Problèmes trouvés et corrigés

| | Problème | Visible où | Correctif |
|---|---|---|---|
| a | **Réservation impossible sur Supabase réel** (erreur 500) : `SUPABASE_DB_URL` fourni par le CLI vise l'hôte `supabase_db_<projet>`, que la couche Node de Deno refuse (`_` dans un nom d'hôte → `ENOTFOUND`). Toute réservation et tout webhook échouaient. | Uniquement sur le vrai Supabase (l'émulation ne passe pas par Deno) | `supabase/functions/_shared/deno-deps.ts` : alias réseau `db.supabase.internal` si l'hôte contient `_` |
| b | **Facture affichée en code HTML brut** : Supabase Storage sert les fichiers HTML en `text/plain` (protection anti-XSS). | Navigateur | `src/pages/MyBookingsPage.tsx` : facture lue via le lien signé puis affichée dans une iframe `sandbox` (aucun script). Le fichier stocké est inchangé : la batterie HOCS reste comparable entre v1 et v2. |
| c | Paiement impossible à tester sans compte Stripe | Navigateur | `scripts/stripe-simule.mjs` + variable `STRIPE_API_BASE` (limitée à `api.stripe.com` ou un hôte local) |
| d | Test C04 en échec sous Windows (`npx` lancé sans shell) | `npm test` sous Windows | Vite lancé via Node |
| e | `hocs.py` inutilisable sous Windows : `npx` introuvable, `tar` de Git Bash, lien symbolique refusé, console cp1252 | HOCS sous Windows | Résolution via `PATHEXT`, extraction `tarfile`, jonction NTFS (retirée avant nettoyage), UTF-8 forcé |
| f | Conteneur `vector` (analytique) qui redémarre en boucle sous Windows | `supabase start` | `[analytics] enabled = false` dans `supabase/config.toml` |
| g | Erreurs 404 `favicon.ico` en console | Navigateur | Icône vide déclarée |

Les deux défauts de gestion constatés lors de cette première vérification (paiement abandonné qui bloque le
créneau, chiffre d'affaires admin incluant les annulations) sont corrigés en v2.1 : voir §6.

## 6. Vérification v2.1 (2026-11-24)

Correctifs v2.1 appliqués (`fix(v2.1)` ×2, `chore(hocs)` C17 / `--tests` / anonymisation, `scripts/verif-publication.py`),
puis vérifiés dans le même environnement. Le simulateur Stripe sait désormais envoyer un événement
`checkout.session.expired` signé (bouton « Simuler l'expiration » ou `POST /checkout/<id>/expire`) : avec le vrai Stripe,
cet événement arrive au bout de 35 min.

| Vérification | Résultat |
|---|---|
| `npm test` | ✅ 46/46 (10 fichiers, dont `tests/gestion.test.ts`) |
| Typage, lint, build, `npm audit`, `npm run test:deno` | ✅ (0 vulnérabilité) |
| Edge Functions v2.1 prises en compte (`db reset` + redémarrage d'edge-runtime) | ✅ |
| Réservation non payée puis `checkout.session.expired` signé | ✅ réservation `cancelled`, créneau `is_booked = false`, de nouveau listé et re-réservé par un autre client |
| Même événement d'expiration rejoué | ✅ « déjà traité », une seule ligne `stripe_events` |
| `checkout.session.expired` signé sur une réservation **payée** | ✅ « expiration ignorée », réservation toujours confirmée |
| `checkout.session.expired` à signature fausse | ✅ 400, rien modifié |
| `admin-stats` : 1 réservation payée conservée (60 €) + 1 payée puis annulée (15 €) | ✅ `revenue_cents = 6000`, `cancelled_paid_cents = 1500`, `payment_anomalies = 0` |
| Non-régression : inscription `admin`, client → admin, lecture croisée des réservations et factures, bucket public, `admin-stats` 401/403, webhook non signé, montant falsifié, double réservation, annulation d'autrui, double annulation | ✅ tous bloqués comme en v2 |
| `npm run test:e2e` | ✅ 19/19 (4 vérifications ajoutées : expiration → plus de réservation en attente, créneau de nouveau proposé, erreur « Créneau déjà réservé » affichée, acomptes annulés affichés à part dans l'admin) ; aucune erreur navigateur hors les 409 provoquées volontairement |
| HOCS `v1-initial` (batterie v2.1) | ✅ **NO-GO** attendu — 13 contrôles en échec (C01–C12, C17), 10/46 tests — [`rapport-go-no-go-v1.md`](rapport-go-no-go-v1.md) |
| HOCS `v2-corrigee --tests v2-corrigee` (batterie d'origine) | ✅ **GO** historique — 16/16, C17 N/A, 43/43 — exécuté dans un conteneur Linux (test C04 d'origine non portable sous Windows) — [`rapport-go-no-go-v2.md`](rapport-go-no-go-v2.md) |
| HOCS `v2.1-verifiee` | ✅ **GO** — 17/17, 46/46 — [`rapport-go-no-go.md`](rapport-go-no-go.md) |
| `scripts/verif-publication.py --refs main --tags` | ✅ « rien à corriger » (identités, messages, contenu de toutes les versions, fichiers interdits, gitleaks) |

Captures du portfolio (`docs/images/app-*.png`, 1280 px, comptes `@example.test`) : la v1 a été servie **uniquement
sur `127.0.0.1`**, depuis un worktree temporaire, avec une clé `service_role` factice, le temps d'une capture, puis arrêtée.

## 7. Non vérifié / à noter

- **Vrai Stripe en mode test** (compte Stripe + Stripe CLI) : non exécuté ; la procédure est dans le README.
- **Expiration réelle d'une session Stripe** (35 min) : non observée ; l'événement `checkout.session.expired` est simulé et signé. En production, l'endpoint webhook doit être abonné à `checkout.session.completed` et `checkout.session.expired`.
- **Remboursement** des acomptes de réservations annulées : non modélisé (affiché à part dans l'admin, « remboursement à décider »).
- **Ports Supabase** : le CLI publie ses ports sur toutes les interfaces de la machine ; à n'utiliser que sur un réseau de confiance.
- Ce travail n'est ni un audit complet ni un test d'intrusion.
