Les commandes citant des tags (v1-initial, v2-corrigee) s'exécutent dans le dépôt complet, disponible sur demande ; ici, leurs résultats sont figés dans qa/.

# Diagnostic — RésaPro v1 (`v1-initial`)

| | |
|---|---|
| Application | RésaPro — réservation de créneaux avec acompte en ligne (React + Vite, Supabase, Stripe) |
| Version analysée | tag `v1-initial` |
| Méthode | Lecture du code et des migrations SQL, puis **reproduction de chaque problème par un test automatisé** exécuté sur une base locale (aucun système en ligne n'a été testé) |
| Preuve | `python3 scripts/hocs.py --ref v1-initial` → rapport `qa/preuves/v1-initial/rapport-go-no-go.md` |
| Verdict | **NO-GO** : 13 contrôles bloquants sur 17 en échec, 36 tests sur 46 en échec (batterie v2.1 ; avec la batterie v2 : 12 sur 16, 34 sur 43) |
| Responsable | Zakaria |

> Ce diagnostic est ciblé sur les points listés ci-dessous. Ce n'est ni un audit complet, ni un test d'intrusion.

## En une phrase

L'application **fonctionne en apparence** (le parcours inscription → réservation → paiement → confirmation passe), mais **n'importe quel utilisateur peut lire les données des autres, devenir administrateur, réserver sans payer ou payer 1 €**. Elle ne doit pas être mise en ligne en l'état.

## Synthèse priorisée

| Priorité | # | Problème | Gravité | Ce que ça coûte au propriétaire |
|---|---|---|---|---|
| 1 | 3 | Clé « service_role » (accès total à la base) livrée dans le site | **Critique** | N'importe quel visiteur peut lire, modifier ou effacer toute la base |
| 2 | 2 | Un utilisateur peut se nommer administrateur | **Critique** | Prise de contrôle de l'espace admin par n'importe quel inscrit |
| 3 | 4 | Webhook Stripe sans vérification de signature, non idempotent | **Critique** | Réservations confirmées sans paiement ; doubles confirmations |
| 4 | 5 | Montant de l'acompte décidé par le navigateur | **Critique** | Un client paie 1 € au lieu de 30 € |
| 5 | 1 | Règle d'accès `using (true)` sur les réservations | **Critique** | Fuite des réservations de tous les clients (données personnelles, RGPD) |
| 6 | 7 | Fonction d'administration sans contrôle d'accès | **Critique** | E-mails de tous les utilisateurs et chiffre d'affaires accessibles sans compte |
| 7 | 6 | Factures dans un espace de stockage public | Élevée | Factures d'autres clients consultables et listables |
| 8 | 8 | Annulation incomplète, erreurs non gérées | Moyenne | Créneaux annulés jamais remis en vente ; pannes silencieuses |
| 9 | 9 | Aucun test, README minimal | Moyenne | Chaque modification peut tout casser sans que personne ne le voie |

---

## Détail des problèmes

### #3 — Clé « service_role » exposée dans le navigateur — Critique

- **Où** : `src/lib/supabaseAdmin.ts:6`, `.env.example:4`, `src/vite-env.d.ts:6`. La page Administration crée un client Supabase avec `VITE_SUPABASE_SERVICE_ROLE_KEY`.
- **Pourquoi c'est grave** : toute variable préfixée `VITE_` est **copiée en clair dans le JavaScript envoyé au navigateur**. La clé `service_role` contourne toutes les règles d'accès (RLS).
- **Preuve** : le test construit le site avec une valeur « canari » dans la variable ; le canari se retrouve dans `dist/assets/index-*.js`.
  `tests/frontend-secrets.test.ts` → C04 : 0/2.
- **Impact métier** : n'importe qui ouvre les outils du navigateur, copie la clé et obtient un accès complet à la base (lecture, modification, suppression).
- **Correctif** : supprimer le client admin du front ; les données d'administration passent par une fonction serveur protégée (voir #7). **En situation réelle : régénérer immédiatement la clé** (elle doit être considérée comme compromise).

### #2 — Escalade de rôle vers administrateur — Critique

- **Où** : `supabase/migrations/20261101000000_init.sql`
  - l.85 : politique `Users can update own profile` sans restriction de colonnes → un utilisateur peut modifier sa colonne `role` ;
  - l.64 : à l'inscription, le rôle est lu dans les métadonnées envoyées par le navigateur (`raw_user_meta_data.role`) → on peut s'inscrire directement en `admin`.
- **Preuve** : `tests/roles.test.ts` → C03 : 2/6 (« un client ne peut pas passer son propre rôle à admin » : obtenu `admin`).
- **Impact métier** : n'importe quel inscrit accède à l'espace d'administration et à toutes les données qu'il affiche.
- **Correctif** : droits de mise à jour limités à la colonne `full_name` ; à l'inscription, seuls `client` et `pro` sont acceptés ; le rôle `admin` ne s'attribue que côté serveur.

### #4 — Webhook Stripe : ni signature, ni protection contre le rejeu — Critique

- **Où** : `supabase/functions/stripe-webhook/handler.ts:12` (`await req.json()` sans vérifier l'en-tête `Stripe-Signature`) et l.20 (insertion du paiement à chaque réception).
- **Preuve** : `tests/webhook.test.ts`
  - C05 : 1/7 — un appel **sans signature** ou signé avec un **faux secret** confirme la réservation (réponse 200) ;
  - C06 : 0/2 — le même événement envoyé deux fois crée **2 paiements et 2 notifications**.
- **Impact métier** : quelqu'un qui connaît l'adresse du webhook confirme ses réservations sans payer. Stripe renvoie parfois le même événement : le client reçoit deux confirmations et le chiffre d'affaires est compté deux fois.
- **Correctif** : vérification HMAC de la signature avec le secret du webhook et tolérance de 5 minutes ; table `stripe_events` (identifiant unique) pour traiter chaque événement une seule fois ; contrôle que le montant payé correspond à l'acompte attendu ; tout paiement non rattachable (réservation annulée, inconnue, montant différent) est tracé comme anomalie à rembourser ou vérifier.

### #5 — Montant de l'acompte calculé dans le navigateur — Critique

- **Où** : `src/pages/SlotsPage.tsx:20` calcule le montant ; `supabase/functions/create-checkout/handler.ts:18` l'utilise tel quel pour Stripe.
- **Preuve** : `tests/checkout.test.ts` → C07 : 2/3 — en envoyant `amount_cents: 100` pour un créneau à 100 €, Stripe est appelé avec **1 €** au lieu de 30 €.
- **Impact métier** : perte directe de chiffre d'affaires ; n'importe quel client un peu curieux paie l'acompte qu'il veut.
- **Correctif** : le serveur ignore tout montant reçu et calcule l'acompte à partir du prix enregistré en base (30 %).

### #1 — Réservations visibles par tout le monde — Critique

- **Où** : `supabase/migrations/20261101000000_init.sql:101-103`, politique `Enable read access for all users ... using (true)` sur `bookings`. Le front masque le problème en filtrant côté navigateur (`src/pages/MyBookingsPage.tsx`), mais la base renvoie tout.
- **Preuve** : `tests/rls.test.ts` → C01 : 0/4 — le client B lit la réservation du client A ; un **visiteur non connecté** voit toutes les réservations. C02 : la politique `using (true)` est détectée.
- **Impact métier** : fuite de données personnelles (qui a rendez-vous avec qui, quand) → risque RGPD et perte de confiance.
- **Correctif** : lecture limitée au client concerné, au pro propriétaire du créneau et aux administrateurs.

### #7 — Fonction d'administration ouverte — Critique

- **Où** : `supabase/functions/admin-stats/handler.ts:4` (aucune vérification d'identité) et `supabase/config.toml` (`verify_jwt = false`).
- **Preuve** : `tests/admin.test.ts` → C09 : 1/4 — sans compte, avec un jeton falsifié ou avec un compte client, la fonction renvoie **200 et la liste des e-mails**.
- **Impact métier** : fichier clients et chiffre d'affaires accessibles à n'importe qui connaissant l'URL.
- **Correctif** : jeton obligatoire, rôle `admin` vérifié en base (pas dans le jeton), réponses 401 / 403 ; `verify_jwt = true`.

### #6 — Factures dans un bucket public — Élevée

- **Où** : `supabase/migrations/20261101000000_init.sql:130` (`public = true`) et l.132 (lecture autorisée pour tous) ; `src/pages/MyBookingsPage.tsx:29` (`getPublicUrl`).
- **Preuve** : `tests/storage.test.ts` → C08 : 1/4 — bucket public ; le client B et un visiteur anonyme peuvent lister les factures des autres.
- **Impact métier** : factures (nom, montant, date) d'autres clients téléchargeables.
- **Correctif** : bucket privé, lecture réservée au dossier du client (`<id_client>/…`) ou à l'admin, liens signés à durée courte (60 s).

### #8 — Annulation incomplète et erreurs non gérées — Moyenne

- **Où** : `public.cancel_booking` (migration l.116) ne libère pas le créneau et ne signale aucune erreur ; `create-checkout/handler.ts:18-21` plante si le corps est invalide ou si le créneau n'existe pas ; le front ignore les erreurs (`SlotsPage.tsx`, `MyBookingsPage.tsx`).
- **Preuve** : `tests/cancel.test.ts` et `tests/checkout.test.ts`
  - C10 : 0/2 — après annulation, le créneau reste « réservé » et ne peut plus être revendu (409) ;
  - C11 : 0/6 — réservation inexistante, d'un autre client ou déjà annulée : aucune erreur ; requête mal formée : plantage (exception non gérée).
- **Impact métier** : créneaux perdus = chiffre d'affaires perdu ; l'utilisateur clique et rien ne se passe, sans message.
- **Correctif** : annulation atomique (réservation + créneau dans la même transaction), contrôles d'état avec messages explicites, réponses 400/404/409 côté serveur, affichage des erreurs dans l'interface.

### #9 — Aucun test, README minimal — Moyenne

- **Où** : aucun dossier `tests/` ; `README.md` de 81 caractères.
- **Preuve** : contrôle C12 (arborescence Git de la version).
- **Impact métier** : impossible de vérifier qu'une correction n'en casse pas une autre ; reprise difficile par un autre développeur.
- **Correctif** : 43 tests automatisés couvrant les 8 problèmes et le parcours nominal, script `scripts/hocs.py` (verdict Go/No-Go), README complet.

---

## Ajouts v2.1 — défauts constatés lors de la vérification sur un vrai Supabase

| Défaut | Gravité | Impact métier | Correctif | Preuve |
|---|---|---|---|---|
| Un paiement abandonné laisse le créneau bloqué (réservation « en attente » sans fin) | Moyenne | Créneau invendable tant que le client n'annule pas | Session Stripe limitée à 35 min ; l'événement signé `checkout.session.expired` annule la réservation en attente et libère le créneau | `tests/gestion.test.ts` (C17) |
| Le chiffre d'affaires admin inclut les acomptes des réservations annulées | Faible | Tableau de bord trompeur | Chiffre d'affaires hors annulations ; acomptes à rembourser et paiements non rattachés affichés à part | `tests/gestion.test.ts` (C17) |

## Ce qui fonctionne déjà (à conserver)

- Build et typage TypeScript sans erreur, lint propre (C13, C14).
- Aucun secret réel dans le dépôt (C15).
- Parcours nominal complet fonctionnel (C16).
- RLS activée sur toutes les tables (le problème vient des règles, pas de son absence).

## Constats hors périmètre (recommandations, non corrigés)

- L'annulation ne déclenche pas de remboursement Stripe de l'acompte : règle commerciale à définir avec le propriétaire. En v2, un paiement reçu après annulation est tracé comme anomalie (table `stripe_events`) mais le remboursement reste manuel.
- Un pro peut modifier ou supprimer un créneau déjà réservé (remettre `is_booked` à faux, changer le prix) ; la suppression efface en cascade la réservation et le paiement associés. Recommandation : limiter la modification et la suppression aux créneaux libres et remplacer la suppression en cascade par une annulation.
- Pas de limitation de débit sur les fonctions serveur.
- Les rôles `anon` et `authenticated` conservent le droit TRUNCATE hérité des droits par défaut de Supabase (non exploitable via l'API, retrait conseillé par défense en profondeur).
- Pas de gestion des fuseaux horaires dans l'affichage des créneaux.
