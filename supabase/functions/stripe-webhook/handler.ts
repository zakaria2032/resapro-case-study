import { json } from '../_shared/http.ts';
import { verifyStripeSignature } from '../_shared/stripe-signature.ts';
import type { Deps } from '../_shared/types.ts';

export function invoiceHtml(bookingId: string, amountCents: number): string {
  const euros = (amountCents / 100).toFixed(2).replace('.', ',');
  return `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Facture ${bookingId}</title>
<body><h1>RésaPro — Facture d'acompte (démo)</h1><p>Réservation : ${bookingId}</p><p>Acompte réglé : ${euros} €</p>
<p>Document fictif généré pour une démonstration.</p></body></html>`;
}

interface StripeEvent {
  id: string;
  type: string;
  data?: { object?: { amount_total?: number; metadata?: { booking_id?: string } } };
}

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);

  const secret = deps.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json({ error: 'Webhook non configuré' }, 500);

  // 1. Authenticité : le corps brut doit être signé par Stripe avec notre secret, il y a moins de 5 minutes.
  const payload = await req.text();
  const now = (deps.now?.() ?? new Date()).getTime();
  if (!(await verifyStripeSignature(payload, req.headers.get('Stripe-Signature'), secret, 300, now))) {
    return json({ error: 'Signature Stripe invalide' }, 400);
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(payload);
  } catch {
    return json({ error: 'Corps invalide' }, 400);
  }
  const HANDLED = ['checkout.session.completed', 'checkout.session.expired'];
  if (!HANDLED.includes(event.type)) return json({ received: true, ignored: event.type });

  const session = event.data?.object;
  const bookingId = session?.metadata?.booking_id;
  if (!bookingId) return json({ received: true, ignored: 'booking_id absent' });

  // 2. Idempotence : chaque événement Stripe n'est traité qu'une fois (Stripe peut le renvoyer).
  let outcome: string;
  try {
    outcome = await deps.db.transaction(async (tx) => {
      const fresh = await tx.query(
        'insert into public.stripe_events (id, type) values ($1, $2) on conflict (id) do nothing returning id',
        [event.id, event.type],
      );
      if (fresh.length === 0) return 'déjà traité';

      if (event.type === 'checkout.session.expired') {
        // Paiement abandonné : la session Stripe a expiré (30 min) → réservation annulée, créneau remis en vente.
        const released = await tx.query<{ slot_id: string }>(
          `update public.bookings set status = 'cancelled', cancelled_at = now()
            where id = $1 and status = 'pending_payment' returning slot_id`,
          [bookingId],
        );
        await tx.query('update public.stripe_events set booking_id = $2 where id = $1', [event.id, bookingId]);
        if (released.length === 0) return 'expiration ignorée (réservation non en attente)';
        await tx.query('update public.slots set is_booked = false where id = $1', [released[0].slot_id]);
        return 'paiement abandonné : créneau libéré';
      }

      const [b] = await tx.query<{ client_id: string; status: string; deposit_cents: number }>(
        'select client_id, status, deposit_cents from public.bookings where id = $1 for update',
        [bookingId],
      );
      // 3. Cohérence : réservation en attente et montant payé = acompte attendu.
      //    Sinon : pas de confirmation, mais l'anomalie est tracée (argent encaissé à rembourser ou vérifier).
      const anomaly = !b
        ? 'réservation inconnue'
        : b.status !== 'pending_payment'
          ? `réservation au statut ${b.status}`
          : session?.amount_total !== b.deposit_cents
            ? 'montant incohérent'
            : null;
      if (anomaly) {
        await tx.query('update public.stripe_events set booking_id = $2, anomaly = $3 where id = $1', [
          event.id,
          bookingId,
          `${anomaly} (montant reçu : ${session?.amount_total ?? 'inconnu'})`,
        ]);
        console.error('stripe-webhook anomalie', event.id, bookingId, anomaly);
        return anomaly;
      }

      await tx.query('update public.stripe_events set booking_id = $2 where id = $1', [event.id, bookingId]);
      await tx.query(`update public.bookings set status = 'confirmed' where id = $1`, [bookingId]);
      await tx.query(
        'insert into public.payments (booking_id, stripe_event_id, amount_cents) values ($1, $2, $3)',
        [bookingId, event.id, b.deposit_cents],
      );
      await tx.query(
        `insert into public.notifications (user_id, booking_id, kind) values ($1, $2, 'booking_confirmed')`,
        [b.client_id, bookingId],
      );
      // Dans la transaction : si l'envoi de la facture échoue, tout est annulé et Stripe renverra l'événement.
      await deps.storage.upload('invoices', `${b.client_id}/${bookingId}.html`, invoiceHtml(bookingId, b.deposit_cents), 'text/html', b.client_id);
      return 'confirmé';
    });
  } catch (e) {
    // 500 → Stripe renverra l'événement plus tard ; rien n'a été enregistré (transaction annulée).
    console.error('stripe-webhook', e);
    return json({ error: 'Erreur interne' }, 500);
  }

  return json({ received: true, outcome });
}
