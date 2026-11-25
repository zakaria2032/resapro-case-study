// Implémentation réelle des dépendances pour l'exécution sur Supabase Edge Functions (Deno).
// Non exécutée par les tests locaux (voir README, section « Limites »).
import postgres from 'npm:postgres@3';
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { Db, Deps } from './types.ts';

// deno-lint-ignore no-explicit-any
function wrap(s: any): Db {
  return {
    query: (text, params = []) => s.unsafe(text, params),
    // deno-lint-ignore no-explicit-any
    transaction: (fn) => s.begin((tx: any) => fn(wrap(tx))),
  };
}

// Supabase CLI (local) : SUPABASE_DB_URL vise l'hôte « supabase_db_<projet> », que le résolveur DNS
// de la couche Node de Deno refuse (« _ » invalide dans un nom d'hôte → ENOTFOUND). On utilise alors
// l'alias réseau « db.supabase.internal » que le CLI attribue au même conteneur. Sans effet en production.
function dbUrl(): string {
  const raw = Deno.env.get('SUPABASE_DB_URL') ?? '';
  try {
    const u = new URL(raw);
    if (u.hostname.includes('_')) {
      u.hostname = 'db.supabase.internal';
      return u.toString();
    }
  } catch {
    // URL illisible : laissée telle quelle, l'erreur apparaîtra à la connexion.
  }
  return raw;
}

const sql = postgres(dbUrl(), { prepare: false });

export function makeDeps(): Deps {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') ?? '';
  const appUrl = Deno.env.get('APP_URL') ?? 'http://localhost:5173';
  // Démo locale sans compte Stripe : STRIPE_API_BASE peut pointer vers le simulateur (scripts/stripe-simule.mjs).
  // Garde-fou : seuls l'API Stripe officielle ou un hôte local sont acceptés (la clé n'est jamais envoyée ailleurs).
  const stripeApi = (Deno.env.get('STRIPE_API_BASE') || 'https://api.stripe.com').replace(/\/+$/, '');
  const stripeApiAllowed = /^(https:\/\/api\.stripe\.com|http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?)$/.test(stripeApi);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  return {
    db: wrap(sql),
    async getUser(jwt) {
      if (!jwt) return null;
      const { data, error } = await admin.auth.getUser(jwt);
      if (error || !data.user) return null;
      return { id: data.user.id, email: data.user.email };
    },
    stripe: {
      async createCheckoutSession(p) {
        // Garde-fou de la démo : Stripe en mode test uniquement.
        if (!stripeKey.startsWith('sk_test_')) {
          throw new Error('Seules les clés Stripe de test (sk_test_) sont autorisées dans cette démo');
        }
        if (!stripeApiAllowed) {
          throw new Error('STRIPE_API_BASE refusé : seuls https://api.stripe.com ou un hôte local sont autorisés');
        }
        const body = new URLSearchParams({
          mode: 'payment',
          'line_items[0][quantity]': '1',
          'line_items[0][price_data][currency]': 'eur',
          'line_items[0][price_data][unit_amount]': String(p.amountCents),
          'line_items[0][price_data][product_data][name]': p.description,
          'metadata[booking_id]': p.bookingId,
          // Paiement abandonné : la session expire après 35 min (minimum Stripe : 30) et Stripe envoie
          // checkout.session.expired, qui libère le créneau (voir stripe-webhook).
          expires_at: String(Math.floor(Date.now() / 1000) + 35 * 60),
          success_url: `${appUrl}/?paiement=ok`,
          cancel_url: `${appUrl}/?paiement=annule`,
        });
        if (p.customerEmail) body.set('customer_email', p.customerEmail);
        const r = await fetch(`${stripeApi}/v1/checkout/sessions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${stripeKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
        });
        if (!r.ok) throw new Error(`Stripe a répondu ${r.status}`);
        const s = await r.json();
        return { id: s.id, url: s.url };
      },
    },
    storage: {
      async upload(bucket, path, content, contentType) {
        const { error } = await admin.storage.from(bucket).upload(path, content, { contentType, upsert: true });
        if (error) throw error;
      },
    },
    env: {
      STRIPE_WEBHOOK_SECRET: Deno.env.get('STRIPE_WEBHOOK_SECRET'),
      APP_URL: appUrl,
    },
  };
}
