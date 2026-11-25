-- Correctif #4 (complément, relecture qualité) — Traçabilité des paiements non rattachés.
-- Un paiement reçu pour une réservation annulée, inconnue ou d'un montant différent de l'acompte
-- n'est pas confirmé, mais il est désormais enregistré comme anomalie (à rembourser ou vérifier).

alter table public.stripe_events
  add column booking_id uuid,
  add column anomaly text;

create index stripe_events_anomalies_idx on public.stripe_events (received_at) where anomaly is not null;
