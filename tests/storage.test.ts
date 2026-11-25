// Problème #6 — Les factures ne doivent être lisibles que par leur propriétaire.
import { beforeAll, describe, expect, test } from 'vitest';
import { asUser, createSlot, createUser, makeDeps, sql, type TestUser } from './helpers/db';
import { bookSlot, payBooking } from './helpers/flows';

const { deps } = makeDeps();
let clientA: TestUser, clientB: TestUser;
let invoicePath: string;

beforeAll(async () => {
  const pro = await createUser({ role: 'pro' });
  clientA = await createUser();
  clientB = await createUser();
  const bookingId = await bookSlot(deps, clientA, await createSlot(pro.id));
  await payBooking(deps, bookingId);
  invoicePath = `${clientA.id}/${bookingId}.html`;
});

describe('[C08] Factures privées', () => {
  test("[C08] le bucket « invoices » n'est pas public", async () => {
    const [b] = await sql`select public from storage.buckets where id = 'invoices'`;
    expect(b.public).toBe(false);
  });

  test('[C08] le client B ne peut pas lire la facture du client A', async () => {
    const rows = await asUser(clientB, (tx) => tx`select name from storage.objects where bucket_id = 'invoices' and name = ${invoicePath}`);
    expect(rows).toHaveLength(0);
  });

  test('[C08] un visiteur non connecté ne peut lire aucune facture', async () => {
    const rows = await asUser(null, (tx) => tx`select name from storage.objects where bucket_id = 'invoices'`);
    expect(rows).toHaveLength(0);
  });

  test('[C08] non-régression : le client A lit bien sa facture', async () => {
    const rows = await asUser(clientA, (tx) => tx`select name from storage.objects where bucket_id = 'invoices' and name = ${invoicePath}`);
    expect(rows).toHaveLength(1);
  });
});
