// Test de fumée sous Deno (runtime des Edge Functions Supabase), optionnel.
// Exécute les handlers avec l'adaptateur réel de base de données (_shared/deno-deps.ts, driver npm:postgres)
// contre la base de test locale. Auth, Storage et Stripe restent simulés (pas de Supabase ni d'Internet).
//
//   npm test   # crée la base resapro_test
//   deno run --allow-env --allow-net --allow-read --no-lock tests/deno/smoke.ts
//
// Variable optionnelle : SUPABASE_DB_URL (défaut : base resapro_test locale).

const secret = `whsec_test_${crypto.randomUUID().replaceAll('-', '')}`;
Deno.env.set('SUPABASE_DB_URL', Deno.env.get('SUPABASE_DB_URL') ?? 'postgres://postgres:postgres@127.0.0.1:5432/resapro_test');
Deno.env.set('SUPABASE_URL', 'http://127.0.0.1:9');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'non-utilisee-dans-ce-test');
Deno.env.set('STRIPE_WEBHOOK_SECRET', secret);

const { makeDeps } = await import('../../supabase/functions/_shared/deno-deps.ts');
const { handler: checkout } = await import('../../supabase/functions/create-checkout/handler.ts');
const { handler: webhook } = await import('../../supabase/functions/stripe-webhook/handler.ts');

const real = makeDeps();
const db = real.db;
let failures = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
};

const [pro] = await db.query<{ id: string }>(
  `insert into auth.users (email, raw_user_meta_data) values ($1, '{"role":"pro"}') returning id`,
  [`deno-pro-${crypto.randomUUID().slice(0, 8)}@example.test`],
);
const [client] = await db.query<{ id: string }>(
  `insert into auth.users (email) values ($1) returning id`,
  [`deno-client-${crypto.randomUUID().slice(0, 8)}@example.test`],
);
const [slot] = await db.query<{ id: string }>(
  `insert into public.slots (pro_id, title, starts_at, ends_at, price_cents)
   values ($1, 'Séance Deno', now() + interval '2 days', now() + interval '2 days 1 hour', 9000) returning id`,
  [pro.id],
);

const deps = {
  ...real,
  getUser: (jwt: string) => Promise.resolve(jwt === 'jeton-client' ? { id: client.id, email: 'client@example.test' } : null),
  stripe: { createCheckoutSession: () => Promise.resolve({ id: 'cs_test_deno', url: 'https://checkout.stripe.test/deno' }) },
  storage: { upload: () => Promise.resolve() },
};

const post = (body: string, headers: Record<string, string>) =>
  new Request('http://localhost/', { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...headers } });

// 1. Réservation : montant envoyé par le navigateur ignoré, acompte = 30 % de 90 €
const r1 = await checkout(post(JSON.stringify({ slot_id: slot.id, amount_cents: 1 }), { Authorization: 'Bearer jeton-client' }), deps);
const b1 = await r1.json();
check('create-checkout → 200', r1.status === 200);
const [booking] = await db.query<{ deposit_cents: number }>('select deposit_cents from public.bookings where id = $1', [b1.booking_id]);
check('acompte calculé côté serveur (2 700 centimes)', booking?.deposit_cents === 2700);

// 2. Webhook signé (Web Crypto) → confirmation ; rejeu → ignoré
const event = JSON.stringify({
  id: `evt_test_deno_${crypto.randomUUID().slice(0, 8)}`,
  type: 'checkout.session.completed',
  data: { object: { amount_total: 2700, metadata: { booking_id: b1.booking_id } } },
});
const t = Math.floor(Date.now() / 1000);
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${event}`)))]
  .map((x) => x.toString(16).padStart(2, '0'))
  .join('');
const r2 = await webhook(post(event, { 'Stripe-Signature': `t=${t},v1=${sig}` }), deps);
check('webhook signé → 200', r2.status === 200);
const r3 = await webhook(post(event, { 'Stripe-Signature': `t=${t},v1=${sig}` }), deps);
check('rejeu → « déjà traité »', (await r3.json()).outcome === 'déjà traité');
const r4 = await webhook(post(event, {}), deps);
check('sans signature → 400', r4.status === 400);
const [p] = await db.query<{ n: number }>('select count(*)::int as n from public.payments where booking_id = $1', [b1.booking_id]);
check('un seul paiement enregistré', p.n === 1);

console.log(failures === 0 ? '\nDeno : tous les contrôles PASS' : `\nDeno : ${failures} échec(s)`);
Deno.exit(failures === 0 ? 0 : 1);
