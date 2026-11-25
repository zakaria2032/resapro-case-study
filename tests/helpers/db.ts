import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type { AuthUser, CheckoutParams, Db, Deps } from '../../supabase/functions/_shared/types';
import { testDbUrl } from './env';

/** Connexion « serveur » (superutilisateur local : contourne la RLS comme le rôle service de Supabase). */
export const sql = postgres(testDbUrl(), { max: 4, onnotice: () => {} });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function wrapDb(s: any): Db {
  return {
    query: (text, params = []) => s.unsafe(text, params),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transaction: (fn) => s.begin((tx: any) => fn(wrapDb(tx))),
  };
}

// ---------- JWT de test (HS256) : secret aléatoire généré à chaque exécution, jamais versionné ----------
const JWT_SECRET = randomBytes(32).toString('hex');
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function signJwt(payload: Record<string, unknown>): string {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export function verifyJwt(token: string): Record<string, unknown> | null {
  const [head, body, sig] = token.split('.');
  if (!head || !body || !sig) return null;
  const expected = createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  if (expected !== sig) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (typeof payload.exp === 'number' && payload.exp < Date.now() / 1000) return null;
  return payload;
}

// ---------- Utilisateurs de démo (données générées, aucune personne réelle) ----------
export interface TestUser {
  id: string;
  email: string;
  token: string;
}

export async function createUser(opts: { role?: 'client' | 'pro' | 'admin'; metaRole?: string; name?: string } = {}): Promise<TestUser> {
  const email = `demo-${randomUUID().slice(0, 8)}@example.test`;
  const meta: Record<string, string> = { full_name: opts.name ?? 'Utilisateur Démo' };
  const metaRole = opts.metaRole ?? (opts.role === 'pro' ? 'pro' : undefined);
  if (metaRole) meta.role = metaRole;
  const [u] = await sql`insert into auth.users (email, raw_user_meta_data) values (${email}, ${sql.json(meta)}) returning id`;
  if (opts.role === 'admin') {
    // Promotion par l'opérateur (connexion serveur), seule voie légitime.
    await sql`update public.profiles set role = 'admin' where id = ${u.id}`;
  }
  const token = signJwt({ sub: u.id, email, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 });
  return { id: u.id, email, token };
}

/** Exécute fn avec les droits d'un utilisateur connecté (rôle authenticated + claims JWT), comme PostgREST. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function asUser(user: TestUser | null, fn: (tx: any) => Promise<any>): Promise<any> {
  return sql.begin(async (tx) => {
    const claims = user ? { sub: user.id, email: user.email, role: 'authenticated' } : { role: 'anon' };
    await tx.unsafe(`set local role ${user ? 'authenticated' : 'anon'}`);
    await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
    return fn(tx);
  });
}

/** Comme asUser mais renvoie l'erreur au lieu de la lever (pour les tentatives censées échouer). */
export async function tryAsUser(user: TestUser | null, fn: (tx: any) => Promise<any>): Promise<{ result?: any; error?: Error }> {
  try {
    return { result: await asUser(user, fn) };
  } catch (error) {
    return { error: error as Error };
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------- Dépendances des fonctions serveur pour les tests ----------
export const WEBHOOK_SECRET = `whsec_test_${randomBytes(16).toString('hex')}`;

export function makeDeps(): { deps: Deps; stripeCalls: CheckoutParams[] } {
  const stripeCalls: CheckoutParams[] = [];
  const deps: Deps = {
    db: wrapDb(sql),
    async getUser(jwt: string): Promise<AuthUser | null> {
      const p = jwt ? verifyJwt(jwt) : null;
      if (!p || typeof p.sub !== 'string') return null;
      return { id: p.sub, email: p.email as string | undefined };
    },
    stripe: {
      async createCheckoutSession(p) {
        stripeCalls.push(p);
        const id = `cs_test_${randomBytes(8).toString('hex')}`;
        return { id, url: `https://checkout.stripe.test/c/pay/${id}` };
      },
    },
    storage: {
      async upload(bucket, path, content, contentType, ownerId) {
        await sql`insert into storage.objects (bucket_id, name, owner, metadata)
                  values (${bucket}, ${path}, ${ownerId ?? null}, ${sql.json({ contentType, size: content.length })})
                  on conflict (bucket_id, name) do update set metadata = excluded.metadata, owner = excluded.owner`;
      },
    },
    env: { STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, APP_URL: 'http://localhost:5173' },
  };
  return { deps, stripeCalls };
}

// ---------- Requêtes HTTP vers les handlers ----------
export function request(body: unknown, opts: { token?: string; headers?: Record<string, string>; raw?: boolean } = {}): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers ?? {}) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  return new Request('http://localhost/functions/v1/test', {
    method: 'POST',
    headers,
    body: opts.raw ? (body as string) : JSON.stringify(body),
  });
}

/** Appelle un handler ; une exception non gérée est convertie en « crash » pour que le test puisse la constater. */
export async function call(
  handler: (req: Request, deps: Deps) => Promise<Response>,
  req: Request,
  deps: Deps,
): Promise<{ status: number; body: Record<string, unknown> | null; crashed: boolean; text: string }> {
  try {
    const res = await handler(req, deps);
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: res.status, body, crashed: false, text };
  } catch (e) {
    return { status: 500, body: null, crashed: true, text: String(e) };
  }
}

// ---------- Stripe : signature d'un événement comme le fait Stripe (en-tête Stripe-Signature) ----------
export function stripeSignature(payload: string, secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

export function checkoutCompletedEvent(bookingId: string, amountTotal: number, eventId = `evt_test_${randomBytes(8).toString('hex')}`) {
  return {
    id: eventId,
    type: 'checkout.session.completed',
    data: { object: { id: `cs_test_${randomBytes(6).toString('hex')}`, amount_total: amountTotal, metadata: { booking_id: bookingId } } },
  };
}

// ---------- Jeux de données ----------
export async function createSlot(proId: string, priceCents = 10000, title = 'Séance de coaching (démo)') {
  const start = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const end = new Date(start.getTime() + 3600 * 1000);
  const [s] = await sql`insert into public.slots (pro_id, title, starts_at, ends_at, price_cents)
                        values (${proId}, ${title}, ${start}, ${end}, ${priceCents}) returning *`;
  return s as { id: string; price_cents: number };
}
