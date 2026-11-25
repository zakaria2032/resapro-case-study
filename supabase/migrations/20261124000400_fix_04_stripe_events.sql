-- Correctif #4 — Webhook Stripe idempotent.
-- Chaque événement Stripe reçu est enregistré une seule fois (clé primaire = identifiant Stripe) :
-- un événement rejoué ne crée plus de second paiement ni de seconde confirmation.

create table public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

-- Table interne : RLS activée sans aucune politique → accessible uniquement côté serveur.
alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from anon, authenticated;
