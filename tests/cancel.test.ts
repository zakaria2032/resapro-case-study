// Problème #8 — L'annulation doit libérer le créneau et signaler clairement les erreurs.
import { describe, expect, test } from 'vitest';
import { handler as checkout } from '../supabase/functions/create-checkout/handler';
import { asUser, call, createSlot, createUser, makeDeps, request, sql, tryAsUser } from './helpers/db';
import { bookSlot, payBooking } from './helpers/flows';

const { deps } = makeDeps();

async function setup() {
  const pro = await createUser({ role: 'pro' });
  const client = await createUser();
  const slot = await createSlot(pro.id);
  const bookingId = await bookSlot(deps, client, slot);
  await payBooking(deps, bookingId);
  return { pro, client, slot, bookingId };
}

describe('[C10] Annulation complète', () => {
  test('[C10] annuler une réservation confirmée libère le créneau', async () => {
    const { client, slot, bookingId } = await setup();
    await asUser(client, (tx) => tx`select public.cancel_booking(${bookingId})`);
    const [b] = await sql`select status from public.bookings where id = ${bookingId}`;
    const [s] = await sql`select is_booked from public.slots where id = ${slot.id}`;
    expect(b.status).toBe('cancelled');
    expect(s.is_booked).toBe(false);
  });

  test('[C10] le créneau libéré peut être réservé par un autre client', async () => {
    const { client, slot, bookingId } = await setup();
    await asUser(client, (tx) => tx`select public.cancel_booking(${bookingId})`);
    const other = await createUser();
    const r = await call(checkout, request({ slot_id: slot.id, amount_cents: 3000 }, { token: other.token }), deps);
    expect(r.status).toBe(200);
  });
});

describe("[C11] Erreurs d'annulation explicites", () => {
  test('[C11] annuler une réservation inexistante → erreur explicite', async () => {
    const client = await createUser();
    const r = await tryAsUser(client, (tx) => tx`select public.cancel_booking(${'00000000-0000-4000-8000-000000000000'})`);
    expect(r.error?.message).toMatch(/introuvable/i);
  });

  test("[C11] annuler la réservation d'un autre client → erreur, réservation inchangée", async () => {
    const { bookingId } = await setup();
    const intruder = await createUser();
    const r = await tryAsUser(intruder, (tx) => tx`select public.cancel_booking(${bookingId})`);
    expect(r.error).toBeDefined();
    const [b] = await sql`select status from public.bookings where id = ${bookingId}`;
    expect(b.status).toBe('confirmed');
  });

  test('[C11] annuler deux fois → erreur explicite « déjà annulée »', async () => {
    const { client, bookingId } = await setup();
    await asUser(client, (tx) => tx`select public.cancel_booking(${bookingId})`);
    const r = await tryAsUser(client, (tx) => tx`select public.cancel_booking(${bookingId})`);
    expect(r.error?.message).toMatch(/déjà annulée/i);
  });
});
