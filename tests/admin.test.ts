// Problème #7 — La fonction d'administration exige un compte administrateur.
import { describe, expect, test } from 'vitest';
import { handler as adminStats } from '../supabase/functions/admin-stats/handler';
import { call, createUser, makeDeps, request, signJwt } from './helpers/db';

const { deps } = makeDeps();

describe("[C09] Fonction admin protégée", () => {
  test('[C09] sans authentification → 401 et aucune donnée', async () => {
    const r = await call(adminStats, request({}), deps);
    expect(r.status).toBe(401);
    expect(r.body?.users).toBeUndefined();
  });

  test('[C09] jeton falsifié → 401', async () => {
    const fake = signJwt({ sub: 'x' }).replace(/\.[^.]+$/, '.signature-falsifiee');
    const r = await call(adminStats, request({}, { token: fake }), deps);
    expect(r.status).toBe(401);
  });

  test('[C09] client connecté (non admin) → 403 et aucune donnée', async () => {
    const client = await createUser();
    const r = await call(adminStats, request({}, { token: client.token }), deps);
    expect(r.status).toBe(403);
    expect(r.body?.users).toBeUndefined();
  });

  test('[C09] non-régression : un administrateur obtient les statistiques', async () => {
    const admin = await createUser({ role: 'admin' });
    const r = await call(adminStats, request({}, { token: admin.token }), deps);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body?.users)).toBe(true);
    expect(typeof r.body?.revenue_cents).toBe('number');
  });
});
