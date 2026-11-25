#!/usr/bin/env node
// Stripe SIMULÉ pour la démo locale — aucun compte Stripe, aucun appel à Internet, aucun débit.
//
// Remplace deux choses, et seulement en local :
//   1. l'API « POST /v1/checkout/sessions » appelée par la fonction create-checkout
//      (activée par STRIPE_API_BASE=http://host.docker.internal:12111 dans supabase/functions/.env) ;
//   2. la page de paiement Stripe Checkout : une page locale « Payer (simulation) » / « Annuler ».
// Au clic sur « Payer », le simulateur envoie au webhook un événement checkout.session.completed
// SIGNÉ avec STRIPE_WEBHOOK_SECRET (même algorithme que Stripe) : le webhook vérifie donc la signature
// exactement comme avec le vrai Stripe.
// Paiement abandonné : avec le vrai Stripe, la session expire après 35 min et Stripe envoie
// checkout.session.expired. Ici, le bouton « Simuler l'expiration » (ou POST /checkout/<id>/expire)
// envoie cet événement signé immédiatement.
//
// Usage : node scripts/stripe-simule.mjs   (lit supabase/functions/.env)
// Écoute uniquement sur 127.0.0.1 (jamais exposé sur le réseau).
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(file) {
  try {
    return Object.fromEntries(
      readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
        .filter(Boolean)
        .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
    );
  } catch {
    return {};
  }
}

const env = { ...loadEnv(join(root, 'supabase', 'functions', '.env')), ...process.env };
const PORT = Number(env.STRIPE_SIMULE_PORT ?? 12111);
const HOST = '127.0.0.1';
const PUBLIC_URL = `http://localhost:${PORT}`;
const WEBHOOK_URL = env.STRIPE_SIMULE_WEBHOOK_URL ?? 'http://127.0.0.1:54321/functions/v1/stripe-webhook';
const WEBHOOK_SECRET = env.STRIPE_WEBHOOK_SECRET;

if (!WEBHOOK_SECRET || WEBHOOK_SECRET.includes('remplacer')) {
  console.error('STRIPE_WEBHOOK_SECRET manquant dans supabase/functions/.env (voir README).');
  process.exit(1);
}

/** @type {Map<string, {id:string, amount:number, currency:string, name:string, bookingId:string, email?:string, success:string, cancel:string, status:string}>} */
const sessions = new Map();

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const eur = (cents) => (cents / 100).toFixed(2).replace('.', ',') + ' €';

function send(res, status, body, type = 'application/json; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': type, ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

function page(title, inner) {
  return `<!doctype html><html lang="fr"><meta charset="utf-8"><link rel="icon" href="data:,"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;color:#1a1a1a}
.warn{background:#fff3cd;border:1px solid #e0c060;padding:8px 12px;border-radius:6px}
.card{border:1px solid #ddd;border-radius:8px;padding:16px;margin:16px 0}
button{font-size:16px;padding:10px 16px;border-radius:6px;border:1px solid #888;cursor:pointer;margin-right:8px}
.pay{background:#635bff;color:#fff;border-color:#635bff}</style>
<body><p class="warn">⚠️ <strong>Paiement SIMULÉ</strong> — démonstration locale, aucun débit, aucun appel à Stripe.</p>${inner}</body></html>`;
}

async function sendWebhook(s, type = 'checkout.session.completed') {
  const expired = type === 'checkout.session.expired';
  const event = {
    id: `evt_sim_${randomBytes(8).toString('hex')}`,
    object: 'event',
    type,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        id: s.id,
        object: 'checkout.session',
        amount_total: s.amount,
        currency: s.currency,
        payment_status: expired ? 'unpaid' : 'paid',
        status: expired ? 'expired' : 'complete',
        customer_email: s.email ?? null,
        metadata: { booking_id: s.bookingId },
      },
    },
  };
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex');
  const r = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${v1}` },
    body: payload,
  });
  return { status: r.status, text: await r.text(), eventId: event.id };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', PUBLIC_URL);
  try {
    // 1. API appelée par create-checkout (côté serveur)
    if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
      const auth = req.headers.authorization ?? '';
      if (!/^Bearer sk_test_/.test(auth)) {
        return send(res, 401, { error: { message: 'Clé de test (sk_test_) requise' } });
      }
      const f = new URLSearchParams(await readBody(req));
      const amount = Number(f.get('line_items[0][price_data][unit_amount]'));
      const bookingId = f.get('metadata[booking_id]');
      if (!Number.isInteger(amount) || amount <= 0 || !bookingId) {
        return send(res, 400, { error: { message: 'Paramètres de session invalides' } });
      }
      const id = `cs_test_sim_${randomBytes(12).toString('hex')}`;
      sessions.set(id, {
        id,
        amount,
        bookingId,
        currency: f.get('line_items[0][price_data][currency]') ?? 'eur',
        name: f.get('line_items[0][price_data][product_data][name]') ?? '',
        email: f.get('customer_email') ?? undefined,
        success: f.get('success_url') ?? 'http://localhost:5173/',
        cancel: f.get('cancel_url') ?? 'http://localhost:5173/',
        status: 'open',
      });
      console.log(`session créée ${id} — réservation ${bookingId} — ${eur(amount)}`);
      return send(res, 200, { id, object: 'checkout.session', url: `${PUBLIC_URL}/checkout/${id}`, amount_total: amount });
    }

    // 2. Page de paiement (navigateur)
    const m = url.pathname.match(/^\/checkout\/(cs_test_sim_[0-9a-f]+)(\/pay|\/cancel|\/expire)?$/);
    const s = m && sessions.get(m[1]);
    if (m && !s) return send(res, 404, page('Session inconnue', '<p>Session de paiement inconnue ou expirée (le simulateur a peut-être redémarré).</p>'), 'text/html; charset=utf-8');

    const expireForm = `<form method="post" action="/checkout/${s?.id}/expire" style="display:inline"><button type="submit">Simuler l'expiration (paiement abandonné)</button></form>`;
    if (s && req.method === 'GET' && !m[2]) {
      const inner =
        s.status === 'left'
          ? `<p>Paiement non effectué. Avec le vrai Stripe, la session expirerait au bout de 35 minutes.</p>${expireForm}`
          : s.status !== 'open'
          ? `<p>Cette session est déjà ${s.status === 'paid' ? 'payée' : 'expirée'}.</p><p><a href="${esc(s.success)}">Retour à RésaPro</a></p>`
          : `<div class="card"><h2>${esc(s.name)}</h2><p>Acompte à régler : <strong>${eur(s.amount)}</strong></p>
             ${s.email ? `<p>Client : ${esc(s.email)}</p>` : ''}<p>Carte : 4242 4242 4242 4242 (fictive)</p></div>
             <form method="post" action="/checkout/${s.id}/pay" style="display:inline"><button class="pay" type="submit">Payer ${eur(s.amount)} (simulation)</button></form>
             <form method="post" action="/checkout/${s.id}/cancel" style="display:inline"><button type="submit">Annuler</button></form>
             <p>${expireForm}</p>`;
      return send(res, 200, page('Paiement simulé — RésaPro', inner), 'text/html; charset=utf-8');
    }

    if (s && req.method === 'POST' && m[2] === '/pay') {
      if (s.status !== 'open') return send(res, 303, '', 'text/plain', { Location: s.success });
      const w = await sendWebhook(s);
      console.log(`paiement simulé ${s.id} → webhook ${w.status} ${w.text}`);
      if (w.status !== 200) {
        return send(res, 502, page('Échec du webhook', `<p>Le webhook a répondu ${w.status} :</p><pre>${esc(w.text)}</pre>
          <p>Vérifiez que <code>supabase functions serve</code> tourne avec le même STRIPE_WEBHOOK_SECRET.</p>`), 'text/html; charset=utf-8');
      }
      s.status = 'paid';
      return send(res, 303, '', 'text/plain', { Location: s.success });
    }

    // « Annuler » : comme sur Stripe, retour à l'application ; la session reste ouverte jusqu'à son expiration.
    if (s && req.method === 'POST' && m[2] === '/cancel') {
      if (s.status === 'open') s.status = 'left';
      return send(res, 303, '', 'text/plain', { Location: s.cancel });
    }

    if (s && req.method === 'POST' && m[2] === '/expire') {
      if (s.status !== 'open' && s.status !== 'left') return send(res, 409, { error: { message: `Session ${s.status}` } });
      const w = await sendWebhook(s, 'checkout.session.expired');
      console.log(`expiration simulée ${s.id} → webhook ${w.status} ${w.text}`);
      if (w.status !== 200) return send(res, 502, { error: { message: `webhook ${w.status}` }, webhook: w.text });
      s.status = 'expired';
      return send(res, 303, '', 'text/plain', { Location: s.cancel });
    }

    return send(res, 404, { error: { message: 'Not found' } });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: { message: 'Erreur du simulateur' } });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Stripe simulé sur ${PUBLIC_URL} (webhook → ${WEBHOOK_URL})`);
});
