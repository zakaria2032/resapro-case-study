// Problème #5 — Montant de l'acompte décidé par le serveur ; #8 — erreurs gérées proprement.
import { beforeAll, describe, expect, test } from 'vitest';
import { handler as checkout } from '../supabase/functions/create-checkout/handler';
import { call, createSlot, createUser, makeDeps, request, sql, type TestUser } from './helpers/db';

const { deps, stripeCalls } = makeDeps();
let pro: TestUser, client: TestUser;

beforeAll(async () => {
  pro = await createUser({ role: 'pro' });
  client = await createUser();
});

describe("[C07] L'acompte est calculé côté serveur", () => {
  test("[C07] un navigateur qui envoie 1 € pour un créneau à 100 € paie quand même 30 € d'acompte", async () => {
    const slot = await createSlot(pro.id, 10000);
    const r = await call(checkout, request({ slot_id: slot.id, amount_cents: 100 }, { token: client.token }), deps);
    expect(r.status).toBe(200);
    expect(stripeCalls.at(-1)?.amountCents).toBe(3000);
    const [b] = await sql`select deposit_cents from public.bookings where id = ${r.body?.booking_id as string}`;
    expect(b.deposit_cents).toBe(3000);
  });

  test('[C07] un créneau déjà réservé ne peut pas être réservé une seconde fois', async () => {
    const slot = await createSlot(pro.id, 5000);
    const first = await call(checkout, request({ slot_id: slot.id, amount_cents: 1500 }, { token: client.token }), deps);
    const second = await call(checkout, request({ slot_id: slot.id, amount_cents: 1500 }, { token: client.token }), deps);
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
  });

  test('[C07] non-régression : sans connexion → 401', async () => {
    const slot = await createSlot(pro.id, 5000);
    const r = await call(checkout, request({ slot_id: slot.id }), deps);
    expect(r.status).toBe(401);
  });
});

describe('[C11] Erreurs gérées : réponse claire, jamais de plantage', () => {
  test('[C11] identifiant de créneau manquant → 400 avec message', async () => {
    const r = await call(checkout, request({}, { token: client.token }), deps);
    expect(r.crashed).toBe(false);
    expect(r.status).toBe(400);
    expect(r.body?.error).toBeTruthy();
  });

  test('[C11] créneau inexistant → 404 avec message', async () => {
    const r = await call(checkout, request({ slot_id: '00000000-0000-4000-8000-000000000000' }, { token: client.token }), deps);
    expect(r.crashed).toBe(false);
    expect(r.status).toBe(404);
    expect(r.body?.error).toBeTruthy();
  });

  test('[C11] corps de requête illisible → 400', async () => {
    const r = await call(checkout, request('pas du json', { token: client.token, raw: true }), deps);
    expect(r.crashed).toBe(false);
    expect(r.status).toBe(400);
  });
});
