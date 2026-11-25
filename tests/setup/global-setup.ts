// Recrée une base de test vierge : émulation Supabase + migrations du dépôt, dans l'ordre.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import postgres from 'postgres';
import { ADMIN_URL, TEST_DB, testDbUrl } from '../helpers/env';

export default async function setup() {
  if (!/^[a-z0-9_]+$/.test(TEST_DB)) throw new Error(`Nom de base invalide : ${TEST_DB}`);
  const root = resolve(__dirname, '../..');

  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists ${TEST_DB} with (force)`);
  await admin.unsafe(`create database ${TEST_DB}`);
  await admin.end();

  const db = postgres(testDbUrl(), { max: 1, onnotice: () => {} });
  try {
    await db.unsafe(readFileSync(join(root, 'tests/db/supabase-emulation.sql'), 'utf8'));
    const dir = join(root, 'supabase/migrations');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      try {
        await db.unsafe(readFileSync(join(dir, file), 'utf8'));
      } catch (e) {
        throw new Error(`Migration ${file} en échec : ${(e as Error).message}`);
      }
    }
  } finally {
    await db.end();
  }
}
