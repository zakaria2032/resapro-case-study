// Ajout v2.1 — cohérence de gestion, constatée lors de la vérification sur un vrai Supabase :
// un paiement abandonné ne doit pas bloquer le créneau ; le chiffre d'affaires admin exclut les annulations.
import { randomBytes } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { handler as adminStats } from '../supabase/functions/admin-stats/handler';
import { handler as checkout } from '../supabase/functions/create-checkout/handler';
import { handler as webhook } from '../supabase/functions/stripe-webhook/handler';
import { asUser, call, createSlot, createUser, makeDeps, request, sql, stripeSignature } from './helpers/db';
import { bookSlot, payBooking } from './helpers/flows';

const { deps } = makeDeps();

function expiredEvent(bookingId: string) {
  const payload = JSON.stringify({
    id: `evt_test_${randomBytes(8).toString('hex')}`,
    type: 'checkout.session.expired',
    data: { object: { id: `cs_test_${randomBytes(6).toString('hex')}`, metadata: { booking_id: bookingId } } },
  });
  return request(payload, { raw: true, headers: { 'Stripe-Signature': stripeSignature(payload) } });
}

const state = async (bookingId: string) =>
  (
    await sql`select b.status, s.is_booked from public.bookings b join public.slots s on s.id = b.slot_id
              where b.id = ${bookingId}`
  )[0];

describe('[C17] Paiement abandonné : le créneau est remis en vente', () => {
  test('[C17] session Stripe expirée → réservation annulée, créneau libre et à nouveau réservable', async () => {
    const pro = await createUser({ role: 'pro' });
    const client = await createUser();
    const slot = await createSlot(pro.id);
    const bookingId = await bookSlot(deps, client, slot);

    const r = await call(webhook, expiredEvent(bookingId), deps);
    expect(r.status).toBe(200);
    expect(await state(bookingId)).toEqual({ status: 'cancelled', is_booked: false });

    const other = await createUser();
    const again = await call(checkout, request({ slot_id: slot.id }, { token: other.token }), deps);
    expect(again.status).toBe(200);
  });

  test("[C17] une expiration reçue après paiement ne touche pas à la réservation confirmée", async () => {
    const pro = await createUser({ role: 'pro' });
    const client = await createUser();
    const bookingId = await bookSlot(deps, client, await createSlot(pro.id));
    await payBooking(deps, bookingId);

    const r = await call(webhook, expiredEvent(bookingId), deps);
    expect(r.status).toBe(200);
    expect(await state(bookingId)).toEqual({ status: 'confirmed', is_booked: true });
  });
});

describe("[C17] Tableau de bord admin : chiffre d'affaires hors réservations annulées", () => {
  test("[C17] l'acompte d'une réservation annulée est compté à part, pas dans le chiffre d'affaires", async () => {
    const admin = await createUser({ role: 'admin' });
    const stats = async () => (await call(adminStats, request({}, { token: admin.token }), deps)).body as Record<string, number>;
    const before = await stats();

    const pro = await createUser({ role: 'pro' });
    const kept = await createUser();
    const cancelling = await createUser();
    const keptId = await bookSlot(deps, kept, await createSlot(pro.id, 10000)); // acompte 30 €
    const cancelledId = await bookSlot(deps, cancelling, await createSlot(pro.id, 5000)); // acompte 15 €
    await payBooking(deps, keptId);
    await payBooking(deps, cancelledId);
    await asUser(cancelling, (tx) => tx`select public.cancel_booking(${cancelledId})`);

    const after = await stats();
    expect(after.revenue_cents - before.revenue_cents).toBe(3000);
    expect(after.cancelled_paid_cents - before.cancelled_paid_cents).toBe(1500);
  });
});
