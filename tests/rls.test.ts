// Problème #1 — Cloisonnement des données (Row Level Security), testé avec plusieurs comptes.
import { beforeAll, describe, expect, test } from 'vitest';
import { asUser, createSlot, createUser, makeDeps, sql, type TestUser } from './helpers/db';
import { bookSlot } from './helpers/flows';

const { deps } = makeDeps();
let pro: TestUser, otherPro: TestUser, clientA: TestUser, clientB: TestUser;
let bookingA: string, bookingB: string;

beforeAll(async () => {
  pro = await createUser({ role: 'pro' });
  otherPro = await createUser({ role: 'pro' });
  clientA = await createUser();
  clientB = await createUser();
  bookingA = await bookSlot(deps, clientA, await createSlot(pro.id));
  bookingB = await bookSlot(deps, clientB, await createSlot(pro.id));
});

describe('[C01] Un client ne voit que ses propres réservations', () => {
  test('[C01] le client B ne peut pas lire la réservation du client A', async () => {
    const rows = await asUser(clientB, (tx) => tx`select id from public.bookings where id = ${bookingA}`);
    expect(rows).toHaveLength(0);
  });

  test('[C01] la liste complète vue par B ne contient que les réservations de B', async () => {
    const rows = await asUser(clientB, (tx) => tx`select id, client_id from public.bookings`);
    expect(rows.map((r: { id: string }) => r.id)).toEqual([bookingB]);
  });

  test("[C01] un visiteur non connecté ne voit aucune réservation", async () => {
    const rows = await asUser(null, (tx) => tx`select id from public.bookings`);
    expect(rows).toHaveLength(0);
  });

  test('[C01] un pro voit les réservations de ses créneaux, pas celles des autres pros', async () => {
    const mine = await asUser(pro, (tx) => tx`select id from public.bookings order by created_at`);
    expect(mine.map((r: { id: string }) => r.id).sort()).toEqual([bookingA, bookingB].sort());
    const other = await asUser(otherPro, (tx) => tx`select id from public.bookings`);
    expect(other).toHaveLength(0);
  });
});

describe('[C02] RLS active et sans règle « tout le monde » sur les tables sensibles', () => {
  test('[C02] la RLS est activée sur toutes les tables du schéma public', async () => {
    const rows = await sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`;
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  test('[C02] aucune politique « using (true) » sur profils, réservations, paiements, notifications', async () => {
    const rows = await sql`select tablename, policyname from pg_policies
                           where schemaname = 'public'
                             and tablename in ('profiles', 'bookings', 'payments', 'notifications', 'stripe_events')
                             and (trim(qual) = 'true' or trim(with_check) = 'true')`;
    expect(rows.map((r) => `${r.tablename}: ${r.policyname}`)).toEqual([]);
  });
});
