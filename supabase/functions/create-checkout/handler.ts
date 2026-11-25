import { bearer, corsHeaders, json } from '../_shared/http.ts';
import { depositFor } from '../_shared/pricing.ts';
import type { Deps } from '../_shared/types.ts';

interface Slot {
  id: string;
  title: string;
  price_cents: number;
  is_booked: boolean;
  starts_at: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Outcome = { status: 200; url: string; booking_id: string } | { status: 404 | 409; error: string };

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);

  try {
    const user = await deps.getUser(bearer(req));
    if (!user) return json({ error: 'Authentification requise' }, 401);

    let body: { slot_id?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Corps de requête JSON invalide' }, 400);
    }
    const slotId = body?.slot_id;
    if (typeof slotId !== 'string' || !UUID.test(slotId)) {
      return json({ error: 'Identifiant de créneau (slot_id) manquant ou invalide' }, 400);
    }
    // Seul l'identifiant du créneau est lu : tout montant envoyé par le navigateur est ignoré.

    // Réservation atomique : verrou sur le créneau, et tout est annulé si Stripe échoue.
    const outcome = await deps.db.transaction<Outcome>(async (tx) => {
      const [slot] = await tx.query<Slot>(
        'select id, title, price_cents, is_booked, starts_at from public.slots where id = $1 for update',
        [slotId],
      );
      if (!slot) return { status: 404, error: 'Créneau introuvable' };
      if (slot.is_booked) return { status: 409, error: 'Créneau déjà réservé' };
      if (new Date(slot.starts_at).getTime() <= (deps.now?.() ?? new Date()).getTime()) {
        return { status: 409, error: 'Ce créneau est déjà passé' };
      }

      const depositCents = depositFor(slot.price_cents); // prix lu en base, pas dans la requête
      const [booking] = await tx.query<{ id: string }>(
        'insert into public.bookings (slot_id, client_id, deposit_cents) values ($1, $2, $3) returning id',
        [slotId, user.id, depositCents],
      );
      await tx.query('update public.slots set is_booked = true where id = $1', [slotId]);

      const session = await deps.stripe.createCheckoutSession({
        amountCents: depositCents,
        bookingId: booking.id,
        description: slot.title,
        customerEmail: user.email,
      });
      await tx.query('update public.bookings set stripe_session_id = $1 where id = $2', [session.id, booking.id]);
      return { status: 200, url: session.url, booking_id: booking.id };
    });

    if (outcome.status !== 200) return json({ error: outcome.error }, outcome.status);
    return json({ url: outcome.url, booking_id: outcome.booking_id });
  } catch (e) {
    // Détail dans les logs serveur uniquement ; message générique pour le client (pas de trace technique).
    console.error('create-checkout', e);
    return json({ error: 'Erreur interne, veuillez réessayer' }, 500);
  }
}
