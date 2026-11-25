# RésaPro — démo de reprise d'une application créée avec l'IA

**Étude de cas n°1 de « Reprise Apps IA »** : une application générée par IA qui fonctionne en apparence, son diagnostic, ses corrections une par une, et les tests qui montrent l'avant et l'après.

> ⚠️ **Démonstration.** RésaPro est une application fictive, construite pour cet exercice. La version héritée (v1) contient des défauts **introduits volontairement** : NE PAS DÉPLOYER. Ce dépôt présente le code de la version corrigée et vérifiée (v2.1). Données fictives, Stripe en mode test, aucun système réel touché.

## En bref (lecture : 2 minutes)

**Le problème de départ.** Une indépendante fait générer par une IA (type Lovable, Bolt, Replit ou Cursor) une application de réservation avec paiement d'un acompte. On s'inscrit, on réserve, on paie, on reçoit sa facture : tout semble marcher.

**Pourquoi « ça marche » ne veut pas dire « c'est prêt ».** Une IA construit d'abord ce qui se voit : les écrans et le parcours normal. Les règles invisibles (qui a le droit de voir quoi, qui fixe le prix, comment vérifier qu'un paiement vient vraiment de Stripe) ne se testent pas en cliquant. Ici, le parcours normal passait ; les problèmes graves étaient ailleurs.

**Ce que le diagnostic a trouvé.** 9 problèmes, dont 6 critiques : n'importe quel visiteur pouvait lire toute la base de données, se nommer administrateur, réserver sans payer ou payer 1 € au lieu de 30 €, et voir les réservations et factures des autres clients. La vérification sur un vrai Supabase a ensuite révélé 2 défauts de gestion (créneau bloqué après un paiement abandonné, chiffre d'affaires mal calculé), eux aussi corrigés. Détail : [`docs/diagnostic.md`](docs/diagnostic.md).

**Ce qui a été corrigé.** Chaque problème a reçu une correction ciblée, sans réécrire l'application, dans un changement séparé et expliqué. L'interface et le parcours existants sont conservés.

**Les preuves avant / après.** Les mêmes tests automatiques sont appliqués à chaque version par notre script de contrôle qualité (HOCS) :

| Version | Verdict | Contrôles réussis | Tests réussis |
|---|---|---|---|
| v1 — héritée (générée par IA) | **NO-GO** | 4 / 17 | 10 / 46 |
| v2 — corrigée (9 problèmes) | **GO** avec sa batterie d'origine | 16 / 16 | 43 / 43 |
| v2.1 — vérifiée (+ 2 défauts de gestion) | **GO** | 17 / 17 | 46 / 46 |

**À propos de ces preuves.** Les rapports v1 et v2 (et leurs preuves brutes dans `qa/preuves/`) sont des **preuves figées**, produites dans le dépôt de travail complet : ils ne peuvent pas être rejoués depuis ce dépôt, qui ne contient que la v2.1. Les versions, commits et commandes qu'ils citent, comme ceux cités ailleurs dans `docs/`, `qa/` et `scripts/`, renvoient à ce dépôt complet. **L'historique complet, commit par commit, est disponible sur demande.**

S'y ajoutent une vérification sur un vrai Supabase local (Docker), les attaques du diagnostic rejouées dessus, et un parcours complet dans un navigateur : voir [`qa/verification-supabase-local.md`](qa/verification-supabase-local.md).

**Les limites, honnêtement.** HOCS est **notre propre contrôle qualité**, pas une certification indépendante, et un verdict GO n'est **pas une garantie absolue de sécurité** : il signifie que les critères écrits à l'avance ([`qa/criteres.md`](qa/criteres.md)) sont tous vérifiés, avec preuves. Ce travail n'est ni un audit complet ni un test d'intrusion. Le paiement avec un vrai compte Stripe (mode test) n'a pas été exécuté. Détail dans la section [Limites](#limites).

Pour aller plus loin : [étude de cas](docs/etude-de-cas.md) · [rapport Go/No-Go v2.1](qa/rapport-go-no-go.md) · [rapport v2](qa/rapport-go-no-go-v2.md) · [rapport v1](qa/rapport-go-no-go-v1.md)

---

# Pour les développeurs

## L'application

Mini-SaaS de réservation pour indépendants (coach, salon, consultant) :

- **Stack** : React 19 + Vite + TypeScript ; Supabase (Postgres, Auth, RLS, Storage, Edge Functions) ; Stripe Checkout **en mode test uniquement** pour l'acompte (30 % du prix).
- **Rôles** : client, pro, admin.
- **Parcours** : inscription / connexion → le pro publie des créneaux → le client réserve et paie l'acompte → webhook Stripe → confirmation + facture → annulation → espace admin.

## Les 9 problèmes de la v1 et leur correction

| # | Problème (v1) | Correction (v2) | Contrôle |
|---|---|---|---|
| 1 | RLS `using (true)` : un client voit les réservations des autres | Lecture limitée au client, au pro du créneau, à l'admin | C01, C02 |
| 2 | Un utilisateur peut se donner le rôle `admin` | Droit de mise à jour limité à `full_name` ; rôle `admin` refusé à l'inscription | C03 |
| 3 | Clé `service_role` dans une variable `VITE_` (livrée au navigateur) | Client admin supprimé du front ; données admin via fonction serveur | C04 |
| 4 | Webhook Stripe sans signature, non idempotent | Signature HMAC + tolérance 5 min ; table `stripe_events` ; montant contrôlé, anomalies tracées | C05, C06 |
| 5 | Acompte calculé par le navigateur | Acompte calculé par le serveur depuis le prix en base | C07 |
| 6 | Factures dans un bucket public | Bucket privé, lecture par dossier propriétaire, liens signés 60 s | C08 |
| 7 | Fonction admin sans contrôle d'accès | 401 / 403, rôle vérifié en base, `verify_jwt = true` | C09 |
| 8 | Annulation ne libère pas le créneau ; erreurs ignorées | Annulation transactionnelle ; erreurs 400/404/409 explicites, affichées dans l'interface | C10, C11 |
| 9 | Aucun test, README minimal | Tests automatisés, script HOCS, ce README | C12 |

Ajouts v2.1, après vérification sur un vrai Supabase :

| Défaut | Correction | Contrôle |
|---|---|---|
| Paiement abandonné : créneau bloqué jusqu'à annulation manuelle | Session Stripe de 35 min ; l'événement `checkout.session.expired` annule la réservation en attente et libère le créneau | C17 |
| Chiffre d'affaires admin incluant les réservations annulées | Acomptes des annulations et paiements non rattachés comptés à part | C17 |

## Structure

```
src/                        Front React (pages, client Supabase)
supabase/
  migrations/               Schéma, RLS, fonctions SQL, stockage (une migration par correctif)
  functions/
    _shared/                Types, HTTP, signature Stripe, dépendances Deno
    create-checkout/        Création de la réservation + session Stripe (handler.ts + index.ts Deno)
    stripe-webhook/         Confirmation du paiement
    admin-stats/            Statistiques d'administration
tests/                      Tests automatisés (Vitest) + émulation Supabase pour Postgres
  e2e/                      Parcours dans un vrai navigateur (application complète, optionnel)
scripts/hocs.py             Contrôle qualité HOCS : verdict Go/No-Go + preuves
scripts/stripe-simule.mjs   Stripe simulé pour la démo locale (aucun compte, aucun débit)
qa/                         Critères d'acceptation, rapports Go/No-Go, preuves brutes
docs/                       Diagnostic et étude de cas
```

## Installation locale

Prérequis :

- Node.js 20 ou plus récent, npm ;
- PostgreSQL 14+ local pour les tests (par exemple `docker run -d --name resapro-test-pg -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:5432:5432 postgres:16`) ;
- Docker + Supabase CLI (`npx supabase`) pour lancer l'application complète ;
- Python 3.10+ (script HOCS, bibliothèque standard uniquement) ;
- [gitleaks](https://github.com/gitleaks/gitleaks) 8.19+ (scan de secrets) ;
- optionnel : Deno 2 (test de fumée des Edge Functions), Google Chrome ou Microsoft Edge (test navigateur).

Testé sous Linux (construction) et sous Windows 11 (Git Bash, Docker Desktop).

```bash
git clone <url-du-depot> resapro && cd resapro
npm ci
cp .env.example .env
```

Base de test : par défaut `postgres://postgres:postgres@127.0.0.1:5432/postgres` (utilisateur qui peut créer des bases). Pour une autre base :

```bash
export DATABASE_URL="postgres://utilisateur:motdepasse@127.0.0.1:5432/postgres"
```

Les tests créent puis remplacent une base dédiée (`resapro_test`, ou `resapro_hocs_<version>` pour HOCS) : n'utilisez pas un serveur contenant des données à conserver sous ces noms.

## Tests

```bash
npm test
```

46 tests, environ 10 secondes. Chaque test porte l'identifiant du contrôle qu'il prouve (`[C01]` … `[C17]`). Données de démo générées (adresses `@example.test`), secrets de test (JWT, webhook Stripe) générés aléatoirement à chaque exécution.

| Fichier | Ce qu'il prouve |
|---|---|
| `tests/rls.test.ts` | Cloisonnement des réservations avec 2 clients, 2 pros et un anonyme ; RLS active partout |
| `tests/roles.test.ts` | Escalade de rôle impossible (modification directe et inscription) |
| `tests/frontend-secrets.test.ts` | Aucune clé `service_role` dans le code ni dans le bundle (build avec valeur canari) |
| `tests/webhook.test.ts` | Signature Stripe absente / fausse / altérée / expirée refusée ; montant ou statut incohérent tracé ; rejeu traité une fois |
| `tests/checkout.test.ts` | Acompte calculé par le serveur ; erreurs 400 / 404 / 409 |
| `tests/storage.test.ts` | Factures privées |
| `tests/admin.test.ts` | Fonction admin : 401 / 403 / 200 |
| `tests/cancel.test.ts` | Annulation qui libère le créneau ; erreurs explicites |
| `tests/parcours.test.ts` | Parcours complet de bout en bout (non-régression) |
| `tests/gestion.test.ts` | Paiement abandonné → créneau libéré ; chiffre d'affaires admin hors annulations (v2.1) |

### Test de fumée sous Deno (optionnel, nécessite Deno 2)

```bash
npm test            # crée la base resapro_test
npm run test:deno   # deno check des 3 fonctions + parcours réservation → webhook signé → rejeu
```

## Contrôle HOCS (Go / No-Go)

```bash
npm run hocs    # version courante (HEAD) → GO attendu (code de sortie 0)
```

Le script extrait la version contrôlée dans un dossier temporaire (`git worktree`), lui applique **la même batterie de tests**, lance build, lint et gitleaks, puis écrit le rapport et les preuves brutes dans `qa/preuves/<version>/`. Les chemins locaux sont anonymisés dans les preuves (`<depot>`, `<tmp>`, `~`). Les preuves d'une nouvelle exécution vont dans `qa/preuves/HEAD/`. Rapports de référence, figés : [`qa/rapport-go-no-go.md`](qa/rapport-go-no-go.md) (v2.1), [`qa/rapport-go-no-go-v2.md`](qa/rapport-go-no-go-v2.md) (v2, batterie d'origine) et [`qa/rapport-go-no-go-v1.md`](qa/rapport-go-no-go-v1.md).

Avant toute publication : `python3 scripts/verif-publication.py --refs main` (identités, liens de session, chemins locaux, e-mails et secrets dans **tout** l'historique).

## Lancer l'application complète (Supabase CLI + Docker)

Prérequis : Docker (Docker Desktop sous Windows / macOS) et Node.js. Le CLI Supabase peut être utilisé sans installation via `npx supabase` (vérifié avec la version 3.3.0). Premier démarrage : plusieurs Go d'images Docker à télécharger.

```bash
npx supabase start                    # Postgres, Auth, Storage, Edge Functions… ; applique supabase/migrations/
cp .env.example .env                  # puis VITE_SUPABASE_ANON_KEY = « Publishable key » affichée par `npx supabase status`
cp supabase/functions/.env.example supabase/functions/.env
# Dans supabase/functions/.env, remplacer STRIPE_WEBHOOK_SECRET par une valeur aléatoire, par exemple :
#   node -e "console.log('whsec_' + require('crypto').randomBytes(24).toString('hex'))"
npx supabase stop && npx supabase start   # recharge les secrets des Edge Functions
npm run stripe:simule                 # terminal 2 : Stripe simulé sur http://localhost:12111
npm run dev                           # terminal 3 : application sur http://localhost:5173
```

`supabase start` sert directement les trois Edge Functions avec les secrets de `supabase/functions/.env`. Après une modification d'une fonction ou de ses secrets, redémarrer le conteneur `supabase_edge_runtime_resapro-demo` (ou `npx supabase stop && npx supabase start`).

Parcours : créer un compte « professionnel », publier un créneau (Espace pro), puis un compte « client » qui réserve. Le bouton « Réserver » ouvre la page de **paiement simulé** : « Payer » envoie au webhook un événement `checkout.session.completed` **signé** (même algorithme que Stripe), la réservation passe « Confirmée », la facture devient consultable. Pour un compte admin : `update public.profiles set role = 'admin' where id = '<uuid>';` dans Studio (http://127.0.0.1:54323 → SQL Editor).

### Paiement : Stripe simulé ou vrai Stripe en mode test

- **Stripe simulé (par défaut)** — `scripts/stripe-simule.mjs` : aucun compte Stripe, aucun appel à Internet, aucun débit. Il remplace l'API de création de session (`STRIPE_API_BASE`) et la page Checkout, écoute uniquement sur `127.0.0.1`. Le bouton « Simuler l'expiration » envoie l'événement signé `checkout.session.expired` que Stripe enverrait au bout de 35 min (paiement abandonné). Garde-fou côté fonction : `STRIPE_API_BASE` n'accepte que `https://api.stripe.com` ou un hôte local, la clé n'est jamais envoyée ailleurs.
- **Vrai Stripe en mode test** — compte Stripe (gratuit) et [Stripe CLI](https://stripe.com/docs/stripe-cli) : retirer `STRIPE_API_BASE`, renseigner `sk_test_…`, puis `stripe listen --forward-to http://127.0.0.1:54321/functions/v1/stripe-webhook` (donne le `whsec_…`). Carte de test `4242 4242 4242 4242`.

Garde-fou : la fonction de paiement refuse toute clé Stripe qui ne commence pas par `sk_test_`.

### Test du parcours dans un navigateur (optionnel)

Avec l'application complète lancée (ci-dessus) et Google Chrome installé :

```bash
npm run test:e2e        # E2E_BROWSER=msedge pour Microsoft Edge
```

19 vérifications dans un vrai navigateur (headless) : publication d'un créneau, réservation, paiement simulé, confirmation, facture privée affichée, annulation qui remet le créneau en vente, paiement abandonné puis expiration de la session (créneau remis en vente), erreur « Créneau déjà réservé », espace admin avec les acomptes annulés à part, absence d'erreur navigateur inattendue. Captures dans le dossier temporaire du système (`resapro-e2e`).

> Réseau : le CLI Supabase publie ses ports (54321-54324) sur toutes les interfaces de la machine, avec des clés de démonstration connues. À utiliser sur un réseau de confiance, et `npx supabase stop` après usage.

## Limites

- **Tests automatisés et HOCS sur Supabase émulé** : la batterie Vitest tourne sur PostgreSQL 16 avec une **émulation partielle** des éléments de Supabase utilisés par l'application (`tests/db/supabase-emulation.sql` : rôles `anon` / `authenticated` / `service_role`, `auth.uid()`, `auth.users`, `storage.buckets` / `storage.objects` avec RLS, droits par défaut). Les migrations testées sont exactement celles de `supabase/migrations/`.
- **Vérification sur un vrai Supabase local** (Supabase CLI + Docker) : migrations, Auth, Storage, Edge Functions sous edge-runtime, parcours navigateur et contrôles d'accès rejoués à la main. Méthode, résultats et correctifs qui en sont issus : [`qa/verification-supabase-local.md`](qa/verification-supabase-local.md). Cette vérification est manuelle et datée ; elle n'est pas intégrée au verdict HOCS.
- **Stripe** : aucun appel réel à l'API Stripe dans les tests ni dans la vérification (faux client dans les tests, simulateur local dans le navigateur). La vérification de signature suit l'algorithme publié par Stripe (HMAC-SHA256 de `timestamp.payload`, en-tête `t=…,v1=…`). Le parcours avec un vrai compte Stripe en mode test reste à exécuter.
- **Paiement abandonné (v2.1)** : testé avec un événement `checkout.session.expired` signé et simulé ; l'expiration réelle d'une session Stripe (35 min) n'a pas été observée. En production, l'endpoint webhook Stripe doit être abonné à `checkout.session.completed` **et** `checkout.session.expired`.
- **HOCS** est notre contrôle qualité interne, exécuté par nous : ce n'est pas une certification indépendante, et un GO n'est pas une garantie absolue de sécurité.
- Ce travail n'est **ni un audit complet ni un test d'intrusion** : il couvre les points listés dans le diagnostic.

## Sécurité et éthique

- Aucun vrai secret dans le dépôt : `.env.example` contient uniquement des valeurs factices ; scan `gitleaks` (fichiers + historique) à 0.
- Aucune donnée personnelle réelle : utilisateurs générés pendant les tests.
- Les tests ne visent que la base locale. Ne lancez jamais ces contrôles contre une application dont vous n'êtes pas propriétaire sans autorisation écrite.

---

Réalisé par **Zakaria** (Reprise Apps IA) avec l'assistance de Claude (Anthropic). Le prestataire reste l'humain responsable du livrable.
