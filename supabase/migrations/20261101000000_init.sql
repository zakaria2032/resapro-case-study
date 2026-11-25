-- ATTENTION : cette première migration reproduit volontairement la version héritée (v1), avec ses défauts.
-- Elle est corrigée par les migrations suivantes : ne jamais l'appliquer seule. NE PAS DÉPLOYER.
-- RésaPro — schéma initial
-- Rôles applicatifs, profils, créneaux, réservations, paiements, notifications, factures.

create type public.app_role as enum ('client', 'pro', 'admin');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  role public.app_role not null default 'client',
  created_at timestamptz not null default now()
);

create table public.slots (
  id uuid primary key default gen_random_uuid(),
  pro_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  price_cents integer not null check (price_cents > 0),
  is_booked boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.slots (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'confirmed', 'cancelled')),
  deposit_cents integer not null,
  stripe_session_id text,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  stripe_event_id text not null,
  amount_cents integer not null,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  booking_id uuid references public.bookings (id) on delete cascade,
  kind text not null,
  created_at timestamptz not null default now()
);

-- Création automatique du profil à l'inscription
create function public.handle_new_user()
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
    coalesce((new.raw_user_meta_data ->> 'role')::public.app_role, 'client')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.slots enable row level security;
alter table public.bookings enable row level security;
alter table public.payments enable row level security;
alter table public.notifications enable row level security;

create policy "Profiles are viewable by owner, pros are public"
  on public.profiles for select
  using (auth.uid() = id or role = 'pro');

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Slots are viewable by everyone"
  on public.slots for select
  using (true);

create policy "Pros manage their slots"
  on public.slots for all
  using (auth.uid() = pro_id)
  with check (
    auth.uid() = pro_id
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'pro')
  );

create policy "Enable read access for all users"
  on public.bookings for select
  using (true);

create policy "Users see payments of their bookings"
  on public.payments for select
  using (exists (
    select 1 from public.bookings b where b.id = booking_id and b.client_id = auth.uid()
  ));

create policy "Users see their notifications"
  on public.notifications for select
  using (user_id = auth.uid());

-- Annulation d'une réservation par le client
create function public.cancel_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.bookings
     set status = 'cancelled', cancelled_at = now()
   where id = p_booking_id and client_id = auth.uid();
end;
$$;

-- Stockage des factures
insert into storage.buckets (id, name, public) values ('invoices', 'invoices', true);

create policy "Invoices are accessible"
  on storage.objects for select
  using (bucket_id = 'invoices');
