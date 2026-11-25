import { handler as checkout } from '../../supabase/functions/create-checkout/handler';
import { handler as webhook } from '../../supabase/functions/stripe-webhook/handler';
import type { Deps } from '../../supabase/functions/_shared/types';
import { call, checkoutCompletedEvent, request, sql, stripeSignature, type TestUser } from './db';

/** Réserve un créneau via la fonction serveur (en envoyant l'acompte « attendu » de 30 %). */
export async function bookSlot(deps: Deps, client: TestUser, slot: { id: string; price_cents: number }): Promise<string> {
  const r = await call(checkout, request({ slot_id: slot.id, amount_cents: Math.round(slot.price_cents * 0.3) }, { token: client.token }), deps);
  if (r.status !== 200 || !r.body?.booking_id) throw new Error(`Réservation impossible : ${r.status} ${r.text}`);
  return r.body.booking_id as string;
}

/** Simule le paiement réussi de l'acompte : événement Stripe signé envoyé au webhook. */
export async function payBooking(deps: Deps, bookingId: string, eventId?: string) {
  const [b] = await sql`select deposit_cents from public.bookings where id = ${bookingId}`;
  const payload = JSON.stringify(checkoutCompletedEvent(bookingId, b.deposit_cents, eventId));
  return call(webhook, request(payload, { raw: true, headers: { 'Stripe-Signature': stripeSignature(payload) } }), deps);
}
