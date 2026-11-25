// Parcours nominal complet (non-régression) : ce que l'utilisateur voit fonctionner.
import { describe, expect, test } from 'vitest';
import { handler as checkout } from '../supabase/functions/create-checkout/handler';
import { asUser, call, createUser, makeDeps, request, sql } from './helpers/db';
import { payBooking } from './helpers/flows';

const { deps, stripeCalls } = makeDeps();

describe('[C16] Parcours complet inscription → réservation → paiement → confirmation', () => {
  test('[C16] un pro publie, un client réserve et paie, la réservation est confirmée avec facture', async () => {
    const pro = await createUser({ role: 'pro', name: 'Coach Démo' });
    const client = await createUser({ name: 'Client Démo' });

    // 1. Le pro publie un créneau (avec ses propres droits, RLS appliquée)
    const start = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    const [slot] = await asUser(pro, (tx) => tx`
      insert into public.slots (pro_id, title, starts_at, ends_at, price_cents)
      values (${pro.id}, 'Bilan découverte', ${start}, ${new Date(start.getTime() + 3600_000)}, 6000)
      returning id, price_cents`);

    // 2. Le client voit le créneau disponible
    const visible = await asUser(client, (tx) => tx`select id from public.slots where id = ${slot.id} and not is_booked`);
    expect(visible).toHaveLength(1);

    // 3. Le client réserve : session de paiement Stripe (test) créée
    const r = await call(checkout, request({ slot_id: slot.id, amount_cents: 1800 }, { token: client.token }), deps);
    expect(r.status).toBe(200);
    expect(String(r.body?.url)).toContain('checkout.stripe.test');
    expect(stripeCalls.at(-1)?.amountCents).toBe(1800);
    const bookingId = r.body?.booking_id as string;

    // 4. Stripe confirme le paiement
    const w = await payBooking(deps, bookingId);
    expect(w.status).toBe(200);

    // 5. Le client voit sa réservation confirmée, sa notification et sa facture
    const [b] = await asUser(client, (tx) => tx`select status from public.bookings where id = ${bookingId}`);
    expect(b.status).toBe('confirmed');
    const notif = await asUser(client, (tx) => tx`select kind from public.notifications where booking_id = ${bookingId}`);
    expect(notif.map((n: { kind: string }) => n.kind)).toContain('booking_confirmed');
    const [inv] = await sql`select name from storage.objects where bucket_id = 'invoices' and name = ${`${client.id}/${bookingId}.html`}`;
    expect(inv).toBeDefined();
  });
});
