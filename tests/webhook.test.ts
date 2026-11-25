// Problème #4 — Webhook Stripe : signature obligatoire et traitement unique de chaque événement.
import { beforeEach, describe, expect, test } from 'vitest';
import { handler as webhook } from '../supabase/functions/stripe-webhook/handler';
import {
  asUser,
  call,
  checkoutCompletedEvent,
  createSlot,
  createUser,
  makeDeps,
  request,
  sql,
  stripeSignature,
  type TestUser,
} from './helpers/db';
import { bookSlot, payBooking } from './helpers/flows';

const { deps } = makeDeps();
let bookingId: string;
let client: TestUser;

const status = async (id: string) => (await sql`select status from public.bookings where id = ${id}`)[0].status;
const count = async (table: 'payments' | 'notifications', id: string) =>
  (await sql`select count(*)::int as n from ${sql('public.' + table)} where booking_id = ${id}`)[0].n;

beforeEach(async () => {
  const pro = await createUser({ role: 'pro' });
  client = await createUser();
  bookingId = await bookSlot(deps, client, await createSlot(pro.id, 8000));
});

function event() {
  return JSON.stringify(checkoutCompletedEvent(bookingId, 2400));
}

describe('[C05] Le webhook refuse les appels non signés par Stripe', () => {
  test('[C05] sans en-tête Stripe-Signature → 400 et réservation non confirmée', async () => {
    const r = await call(webhook, request(event(), { raw: true }), deps);
    expect(r.status).toBe(400);
    expect(await status(bookingId)).toBe('pending_payment');
  });

  test('[C05] signature calculée avec un mauvais secret → 400', async () => {
    const payload = event();
    const sig = stripeSignature(payload, 'whsec_secret_d_un_attaquant');
    const r = await call(webhook, request(payload, { raw: true, headers: { 'Stripe-Signature': sig } }), deps);
    expect(r.status).toBe(400);
    expect(await status(bookingId)).toBe('pending_payment');
  });

  test('[C05] corps modifié après signature → 400', async () => {
    const payload = event();
    const sig = stripeSignature(payload);
    const tampered = payload.replace('"amount_total":2400', '"amount_total":1');
    const r = await call(webhook, request(tampered, { raw: true, headers: { 'Stripe-Signature': sig } }), deps);
    expect(r.status).toBe(400);
    expect(await status(bookingId)).toBe('pending_payment');
  });

  test('[C05] signature valide mais trop ancienne (> 5 min) → 400', async () => {
    const payload = event();
    const sig = stripeSignature(payload, undefined, Math.floor(Date.now() / 1000) - 3600);
    const r = await call(webhook, request(payload, { raw: true, headers: { 'Stripe-Signature': sig } }), deps);
    expect(r.status).toBe(400);
  });

  test('[C05] montant signé différent de l\'acompte → non confirmée, anomalie tracée', async () => {
    const payload = JSON.stringify(checkoutCompletedEvent(bookingId, 100));
    const r = await call(webhook, request(payload, { raw: true, headers: { 'Stripe-Signature': stripeSignature(payload) } }), deps);
    expect(r.status).toBe(200);
    expect(await status(bookingId)).toBe('pending_payment');
    const [ev] = await sql`select anomaly from public.stripe_events where booking_id = ${bookingId}`;
    expect(ev?.anomaly).toMatch(/montant incohérent/);
  });

  test('[C05] paiement reçu après annulation → non confirmé, anomalie tracée', async () => {
    await asUser(client, (tx) => tx`select public.cancel_booking(${bookingId})`);
    const r = await payBooking(deps, bookingId);
    expect(r.status).toBe(200);
    expect(await status(bookingId)).toBe('cancelled');
    const [ev] = await sql`select anomaly from public.stripe_events where booking_id = ${bookingId}`;
    expect(ev?.anomaly).toMatch(/cancelled/);
  });

  test('[C05] non-régression : un événement correctement signé confirme la réservation', async () => {
    const r = await payBooking(deps, bookingId);
    expect(r.status).toBe(200);
    expect(await status(bookingId)).toBe('confirmed');
  });
});

describe('[C06] Un événement rejoué est traité une seule fois', () => {
  test('[C06] le même événement reçu deux fois → 1 paiement, 1 notification', async () => {
    const first = await payBooking(deps, bookingId, `evt_test_rejeu_${bookingId.slice(0, 8)}`);
    const second = await payBooking(deps, bookingId, `evt_test_rejeu_${bookingId.slice(0, 8)}`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await count('payments', bookingId)).toBe(1);
    expect(await count('notifications', bookingId)).toBe(1);
  });

  test("[C06] rejeu isolé : même si la réservation repasse « en attente », l'événement n'est pas retraité", async () => {
    const id = `evt_test_isole_${bookingId.slice(0, 8)}`;
    await payBooking(deps, bookingId, id);
    await sql`update public.bookings set status = 'pending_payment' where id = ${bookingId}`;
    await payBooking(deps, bookingId, id);
    expect(await count('payments', bookingId)).toBe(1);
    expect(await status(bookingId)).toBe('pending_payment');
  });
});
