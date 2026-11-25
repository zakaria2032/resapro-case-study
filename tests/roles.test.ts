// Problème #2 — Escalade de privilèges : un utilisateur ne doit jamais pouvoir devenir admin seul.
import { describe, expect, test } from 'vitest';
import { asUser, createUser, sql, tryAsUser } from './helpers/db';

const roleOf = async (id: string) => (await sql`select role from public.profiles where id = ${id}`)[0].role;

describe('[C03] Escalade de rôle impossible', () => {
  test('[C03] un client ne peut pas passer son propre rôle à « admin »', async () => {
    const client = await createUser();
    const r = await tryAsUser(client, (tx) => tx`update public.profiles set role = 'admin' where id = ${client.id}`);
    expect((r.error as { code?: string } | undefined)?.code).toBe('42501'); // refus explicite « permission denied »
    expect(await roleOf(client.id)).toBe('client');
  });

  test('[C03] un pro ne peut pas passer son propre rôle à « admin »', async () => {
    const pro = await createUser({ role: 'pro' });
    const r = await tryAsUser(pro, (tx) => tx`update public.profiles set role = 'admin' where id = ${pro.id}`);
    expect((r.error as { code?: string } | undefined)?.code).toBe('42501');
    expect(await roleOf(pro.id)).toBe('pro');
  });

  test("[C03] une inscription qui demande le rôle « admin » crée un simple client", async () => {
    const u = await createUser({ metaRole: 'admin' });
    expect(await roleOf(u.id)).toBe('client');
  });

  test('[C03] non-régression : inscription en tant que pro toujours possible', async () => {
    const u = await createUser({ role: 'pro' });
    expect(await roleOf(u.id)).toBe('pro');
  });

  test('[C03] le trigger de défense en profondeur bloque un changement de rôle même avec le droit de colonne', async () => {
    const client = await createUser();
    // Simule une future migration qui rouvrirait par erreur le droit UPDATE sur « role » : le trigger doit tenir.
    const r = await tryAsUser(client, async (tx) => {
      await tx.unsafe('reset role');
      await tx.unsafe('grant update (role) on public.profiles to authenticated');
      await tx.unsafe('set local role authenticated');
      return tx`update public.profiles set role = 'admin' where id = ${client.id}`;
    });
    expect(r.error?.message).toMatch(/Modification du rôle interdite/);
    expect(await roleOf(client.id)).toBe('client');
  });

  test('[C03] non-régression : un utilisateur peut toujours modifier son nom', async () => {
    const client = await createUser();
    await asUser(client, (tx) => tx`update public.profiles set full_name = 'Nom modifié' where id = ${client.id}`);
    const [p] = await sql`select full_name from public.profiles where id = ${client.id}`;
    expect(p.full_name).toBe('Nom modifié');
  });
});
