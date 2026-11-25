-- Correctif #8 — Annulation complète et erreurs explicites.
-- Avant : l'annulation laissait le créneau « réservé » (jamais remis en vente) et ne signalait
--         aucune erreur (réservation inexistante, d'un autre client ou déjà annulée : silence).
-- Après : réservation annulée ET créneau libéré dans la même transaction ; messages d'erreur clairs.

create or replace function public.cancel_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  b record;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;

  select id, client_id, slot_id, status into b
    from public.bookings
   where id = p_booking_id
   for update;

  -- Même message pour « inexistante » et « appartient à un autre client » : on ne révèle pas son existence.
  if not found or (b.client_id <> auth.uid() and not public.is_admin()) then
    raise exception 'Réservation introuvable' using errcode = 'P0002';
  end if;

  if b.status = 'cancelled' then
    raise exception 'Réservation déjà annulée' using errcode = 'P0001';
  end if;

  update public.bookings set status = 'cancelled', cancelled_at = now() where id = b.id;
  update public.slots set is_booked = false where id = b.slot_id;
end;
$$;

revoke execute on function public.cancel_booking(uuid) from public, anon;
grant execute on function public.cancel_booking(uuid) to authenticated;
