// Configuration de la base de test (Postgres local). Aucune valeur secrète : identifiants de dev local.
export const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
export const TEST_DB = process.env.RESAPRO_TEST_DB ?? 'resapro_test';

export function testDbUrl(): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${TEST_DB}`;
  return u.toString();
}
