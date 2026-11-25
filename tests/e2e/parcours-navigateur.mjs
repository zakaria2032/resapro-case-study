// Test de parcours dans un vrai navigateur (optionnel, hors HOCS) — application complète en local :
// Supabase CLI + Docker, `npm run dev`, Stripe simulé (`npm run stripe:simule`). Voir README.
//
// Parcours : un pro publie un créneau → un client réserve → paiement simulé → réservation confirmée →
// facture privée affichée → annulation (créneau remis en vente) → paiement abandonné puis expiration de la session
// (v2.1 : créneau remis en vente) → erreur « créneau déjà réservé » → espace admin (acomptes annulés à part).
// Navigateur : Chrome déjà installé (playwright-core, aucun téléchargement). E2E_BROWSER=msedge pour Edge.
// Ne vise QUE l'application locale ; comptes fictifs @example.test.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP = process.env.E2E_APP_URL ?? 'http://localhost:5173/';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(APP)) throw new Error('E2E_APP_URL doit viser une application locale');
const DB_CONTAINER = process.env.E2E_DB_CONTAINER ?? 'supabase_db_resapro-demo';
const SHOTS_DIR = process.env.E2E_SHOTS ?? join(tmpdir(), 'resapro-e2e');
mkdirSync(SHOTS_DIR, { recursive: true });
const SHOTS = SHOTS_DIR + '/';
const run = Date.now().toString(36);
const PWD = 'motdepasse-demo-1';
const results = [];
const ok = (name, cond, extra = '') => {
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
};

const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? 'chrome', headless: true });
const errors = [];
// Erreurs provoquées volontairement (étape « créneau déjà réservé ») : attendues, donc non signalées.
const EXPECTED = [/\[http 409\] POST .*\/functions\/v1\/create-checkout$/, /status of 409 \(Conflict\)/];
const report = () => [...new Set(errors)].filter((e) => !EXPECTED.some((rx) => rx.test(e)));

async function newPage() {
  const ctx = await browser.newContext({ locale: 'fr-FR', viewport: { width: 1100, height: 800 } });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`[console] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('dialog', (d) => d.accept());
  page.on('response', (r) => r.status() >= 400 && errors.push(`[http ${r.status()}] ${r.request().method()} ${r.url().replace(/token=.*/, 'token=…')}`));
  return page;
}

async function signup(page, email, name, role) {
  await page.goto(APP);
  await page.getByRole('button', { name: 'Créer un compte' }).click();
  await page.getByPlaceholder('Nom complet').fill(name);
  await page.locator('select').selectOption(role);
  await page.getByPlaceholder('E-mail').fill(email);
  await page.getByPlaceholder('Mot de passe').fill(PWD);
  await page.getByRole('button', { name: "S'inscrire" }).click();
  await page.getByRole('button', { name: 'Déconnexion' }).waitFor();
}

const shot = (page, n) => page.screenshot({ path: `${SHOTS}${n}.png`, fullPage: true });

try {
  // ---------- 1. Le pro publie un créneau ----------
  const pro = await newPage();
  await signup(pro, `pro-${run}@example.test`, 'Camille Pro (démo)', 'pro');
  await pro.getByText('(pro)').waitFor();
  ok('pro : inscription + rôle affiché', await pro.getByText('(pro)').isVisible());
  await pro.getByRole('button', { name: 'Espace pro' }).click();
  const title = `Coaching navigateur ${run}`;
  await pro.getByPlaceholder('Intitulé').fill(title);
  const d = new Date(Date.now() + 5 * 86400e3);
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T14:30`;
  await pro.locator('input[type="datetime-local"]').fill(local);
  await pro.getByLabel('Prix (€)').fill('80');
  await pro.getByRole('button', { name: 'Publier' }).click();
  await pro.getByText(title).first().waitFor();
  ok('pro : créneau publié et listé', await pro.getByText(title).first().isVisible());
  await shot(pro, '01-pro-creneau');

  // ---------- 2. Le client réserve et paie (simulation) ----------
  const cli = await newPage();
  await signup(cli, `client-${run}@example.test`, 'Alex Client (démo)', 'client');
  const card = cli.locator('li.card', { hasText: title });
  await card.waitFor();
  ok('client : créneau visible avec acompte estimé 24 €', (await card.textContent()).includes('24,00'));
  await shot(cli, '02-client-creneaux');
  await card.getByRole('button', { name: 'Réserver' }).click();
  await cli.waitForURL(/localhost:12111\/checkout\//);
  const pageTxt = await cli.textContent('body');
  ok('checkout simulé : montant serveur 24,00 €', pageTxt.includes('24,00 €'), pageTxt.match(/Acompte à régler : [^\n]+/)?.[0]);
  await shot(cli, '03-checkout-simule');
  await cli.getByRole('button', { name: /Payer/ }).click();
  await cli.waitForURL(/localhost:5173\/\?paiement=ok/);
  ok('retour sur l’application après paiement', cli.url().includes('paiement=ok'));
  await cli.getByRole('button', { name: 'Mes réservations' }).click();
  const bk = cli.locator('li.card', { hasText: title });
  await bk.waitFor();
  ok('réservation « Confirmée » avec acompte 24 €', /Confirmée — acompte 24,00/.test(await bk.textContent()), (await bk.textContent()).trim());
  await shot(cli, '04-reservation-confirmee');

  // ---------- 3. Facture privée (lien signé) ----------
  await bk.getByRole('button', { name: 'Facture' }).click();
  const frame = cli.frameLocator('iframe[title="Facture"]');
  await frame.locator('h1').waitFor();
  const h1 = await frame.locator('h1').textContent();
  const body = await frame.locator('body').textContent();
  ok('facture affichée (HTML rendu, pas le code source)', h1.includes('Facture') && body.includes('24,00') && !body.includes('<p>'), h1);
  await shot(cli, '05-facture');
  await cli.getByRole('button', { name: 'Fermer la facture' }).click();

  // ---------- 4. Le pro voit la réservation ----------
  await pro.reload();
  await pro.getByRole('button', { name: 'Espace pro' }).click();
  await pro.getByText('· réservé').first().waitFor();
  ok('pro : créneau marqué réservé', await pro.getByText('· réservé').first().isVisible());
  await shot(pro, '06-pro-reservation-recue');

  // ---------- 5. Annulation → créneau remis en vente ----------
  await bk.getByRole('button', { name: 'Annuler' }).click();
  await cli.locator('li.card', { hasText: 'Annulée' }).first().waitFor();
  ok('annulation : statut « Annulée »', true);
  await cli.getByRole('button', { name: 'Créneaux' }).click();
  await cli.locator('li.card', { hasText: title }).waitFor();
  ok('annulation : créneau de nouveau disponible', await cli.locator('li.card', { hasText: title }).isVisible());

  // ---------- 6. Paiement abandonné ----------
  await cli.locator('li.card', { hasText: title }).getByRole('button', { name: 'Réserver' }).click();
  await cli.waitForURL(/localhost:12111\/checkout\//);
  const abandonedCheckout = cli.url();
  await cli.getByRole('button', { name: 'Annuler' }).click();
  await cli.waitForURL(/paiement=annule/);
  ok('paiement abandonné : message affiché', await cli.getByText('Paiement annulé').isVisible());
  await cli.getByRole('button', { name: 'Mes réservations' }).click();
  await cli.getByText('En attente de paiement').first().waitFor();
  ok('paiement abandonné : réservation « En attente de paiement »', true);
  await shot(cli, '07-paiement-abandonne');

  // ---------- 7. Erreur affichée : créneau déjà pris ----------
  const cli2 = await newPage();
  await signup(cli2, `client2-${run}@example.test`, 'Sam Client (démo)', 'client');
  ok('2e client : créneau réservé (en attente) non proposé', !(await cli2.locator('li.card', { hasText: title }).count()));

  // ---------- 7 bis (v2.1). Expiration de la session abandonnée → créneau remis en vente ----------
  await cli.goto(abandonedCheckout);
  await cli.getByRole('button', { name: /Simuler l'expiration/ }).click();
  await cli.waitForURL(/localhost:5173\//);
  await cli.getByRole('button', { name: 'Mes réservations' }).click();
  await cli.locator('li.card').first().waitFor();
  ok('v2.1 expiration : plus aucune réservation « En attente de paiement »', !(await cli.getByText('En attente de paiement').count()));
  await cli.getByRole('button', { name: 'Créneaux' }).click();
  const freed = cli.locator('li.card', { hasText: title });
  await freed.waitFor();
  ok('v2.1 expiration : créneau de nouveau proposé', await freed.isVisible());

  // ---------- 7 ter. Erreur claire : le créneau est pris entre-temps par un autre client ----------
  await cli2.reload();
  await cli2.locator('li.card', { hasText: title }).getByRole('button', { name: 'Réserver' }).click();
  await cli2.waitForURL(/localhost:12111\/checkout\//);
  await freed.getByRole('button', { name: 'Réserver' }).click(); // liste affichée avant la réservation de Sam
  await cli.getByRole('alert').waitFor();
  const alertTxt = await cli.getByRole('alert').textContent();
  ok('erreur explicite « Créneau déjà réservé »', /déjà réservé/.test(alertTxt), alertTxt);
  await shot(cli, '07b-erreur-creneau-pris');

  // ---------- 8. Administration (rôle attribué côté serveur) ----------
  const adm = await newPage();
  await signup(adm, `admin-${run}@example.test`, 'Admin (démo)', 'client');
  execFileSync('docker', ['exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-qc',
    `update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'admin-${run}@example.test')`]);
  await adm.reload();
  await adm.getByRole('button', { name: 'Administration' }).click();
  await adm.getByText(/réservations actives ·/).waitFor();
  ok('admin : statistiques via fonction serveur', await adm.getByText(/réservations actives ·/).isVisible(), await adm.getByText(/réservations actives ·/).textContent());
  // La réservation du parcours (24 €) a été payée puis annulée : son acompte est affiché à part (v2.1).
  const cancelledLine = adm.getByText(/encaissés sur des réservations annulées/);
  ok('v2.1 admin : acomptes des réservations annulées affichés à part', (await cancelledLine.count()) === 1, (await cancelledLine.count()) ? await cancelledLine.textContent() : '');
  await shot(adm, '08-admin');
  ok('client : pas d’onglet Administration', !(await cli.getByRole('button', { name: 'Administration' }).count()));
} catch (e) {
  ok('exécution du parcours', false, e.message.split('\n')[0]);
} finally {
  await browser.close();
  console.log(results.join('\n'));
  console.log(`\nCaptures : ${SHOTS_DIR}`);
  const unexpected = report();
  if (unexpected.length) process.exitCode = 1;
  console.log(unexpected.length ? `\nErreurs navigateur :\n${unexpected.join('\n')}` : '\nAucune erreur navigateur inattendue (409 volontaires exclues).');
}
