import { bearer, corsHeaders, json } from '../_shared/http.ts';
import type { Deps } from '../_shared/types.ts';

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // 1. Identité : jeton Supabase valide obligatoire.
  const user = await deps.getUser(bearer(req));
  if (!user) return json({ error: 'Authentification requise' }, 401);

  // 2. Autorisation : rôle lu en base (jamais depuis le jeton ou la requête).
  const [profile] = await deps.db.query<{ role: string }>('select role from public.profiles where id = $1', [user.id]);
  if (profile?.role !== 'admin') return json({ error: 'Accès réservé aux administrateurs' }, 403);

  const users = await deps.db.query(
    `select p.id, u.email, p.full_name, p.role
       from public.profiles p join auth.users u on u.id = p.id
      order by p.created_at`,
  );
  // Les acomptes des réservations annulées sont comptés à part (remboursement à décider), pas dans le chiffre d'affaires.
  const [stats] = await deps.db.query(
    `select count(*) filter (where b.status <> 'cancelled')::int as bookings,
            count(*) filter (where b.status = 'cancelled')::int as cancelled_bookings,
            coalesce(sum(p.paid) filter (where b.status <> 'cancelled'), 0)::int as revenue_cents,
            coalesce(sum(p.paid) filter (where b.status = 'cancelled'), 0)::int as cancelled_paid_cents,
            (select count(*)::int from public.stripe_events where anomaly is not null) as payment_anomalies
       from public.bookings b
       left join (select booking_id, sum(amount_cents) as paid from public.payments group by booking_id) p
         on p.booking_id = b.id`,
  );
  return json({ users, ...stats });
}
