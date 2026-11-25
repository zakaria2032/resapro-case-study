-- Correctif #2 — Un utilisateur ne peut plus se donner le rôle « admin ».
-- Avant : (a) la politique de mise à jour du profil autorisait toutes les colonnes, dont « role » ;
--         (b) à l'inscription, le rôle était lu dans les métadonnées envoyées par le navigateur.

-- (a) Seule la colonne full_name est modifiable par l'utilisateur lui-même.
drop policy "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (full_name) on public.profiles to authenticated;

-- Défense en profondeur : refus explicite si un rôle client tente de changer « role ».
create function public.prevent_role_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role and current_user in ('anon', 'authenticated') then
    raise exception 'Modification du rôle interdite' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_prevent_role_change
  before update on public.profiles
  for each row execute function public.prevent_role_change();

-- (b) À l'inscription, seuls « client » (défaut) et « pro » sont acceptés.
--     Le rôle « admin » ne s'attribue que côté serveur (SQL ou fonction protégée).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    case when new.raw_user_meta_data ->> 'role' = 'pro' then 'pro'::public.app_role
         else 'client'::public.app_role end
  );
  return new;
end;
$$;
