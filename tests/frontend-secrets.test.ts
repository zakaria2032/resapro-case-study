// Problème #3 — Aucune clé « service_role » (accès total à la base) ne doit atteindre le navigateur.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { describe, expect, test } from 'vitest';

const root = resolve(__dirname, '..');
const FORBIDDEN = /VITE_[A-Z0-9_]*(SERVICE_ROLE|SECRET|PRIVATE)[A-Z0-9_]*/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('[C04] Pas de clé service_role côté navigateur', () => {
  test('[C04] aucune variable VITE_* sensible dans le code front ni dans .env.example', () => {
    const files = [...walk(join(root, 'src')), join(root, '.env.example')].filter(existsSync);
    const hits = files.flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(FORBIDDEN)].map((m) => `${relative(root, f).split(sep).join('/')}: ${m[0]}`),
    );
    expect(hits).toEqual([]);
  });

  test("[C04] le bundle de production ne contient pas la clé, même si elle est présente dans l'environnement", () => {
    const canary = `CANARI_SERVICE_ROLE_${randomBytes(6).toString('hex')}`;
    const out = mkdtempSync(join(tmpdir(), 'resapro-build-'));
    try {
      // Vite lancé via Node (et non « npx ») : portable sous Windows, où npx est un script .cmd.
      const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
      const r = spawnSync(process.execPath, [vite, 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
          VITE_SUPABASE_ANON_KEY: 'cle-anon-de-test',
          VITE_SUPABASE_SERVICE_ROLE_KEY: canary,
          SUPABASE_SERVICE_ROLE_KEY: canary,
        },
      });
      expect(r.status, r.stderr).toBe(0);
      const leaked = walk(out).filter((f) => readFileSync(f, 'utf8').includes(canary));
      expect(leaked.map((f) => `dist/${relative(out, f).split(sep).join('/')}`)).toEqual([]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);
});
