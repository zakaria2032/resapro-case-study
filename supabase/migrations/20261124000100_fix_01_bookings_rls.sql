-- Correctif #1 — Les réservations ne sont plus lisibles par tout le monde.
-- Avant : politique « using (true) » → tout visiteur, même non connecté, lisait toutes les réservations.
-- Après : le client lit ses réservations, le pro celles de ses créneaux, l'admin toutes.

drop policy "Enable read access for all users" on public.bookings;

-- Rôle admin lu en base (jamais depuis le jeton, modifiable par l'utilisateur).
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

create policy "Bookings readable by client, slot owner and admins"
  on public.bookings for select
  to authenticated
  using (
    client_id = auth.uid()
    or exists (select 1 from public.slots s where s.id = slot_id and s.pro_id = auth.uid())
    or public.is_admin()
  );
