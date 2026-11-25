// Dépendances injectées dans les fonctions serveur (Edge Functions).
// En production (Deno / Supabase) : voir deno-deps.ts.
// En test (Node / Vitest) : voir tests/helpers/deps.ts.

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

export interface AuthUser {
  id: string;
  email?: string;
}

export interface CheckoutParams {
  amountCents: number;
  bookingId: string;
  description: string;
  customerEmail?: string;
}

export interface Deps {
  /** Connexion serveur (rôle service : contourne la RLS). Jamais exposée au navigateur. */
  db: Db;
  /** Vérifie un JWT Supabase et renvoie l'utilisateur, ou null si invalide. */
  getUser(jwt: string): Promise<AuthUser | null>;
  stripe: {
    createCheckoutSession(p: CheckoutParams): Promise<{ id: string; url: string }>;
  };
  storage: {
    upload(bucket: string, path: string, content: string, contentType: string, ownerId?: string): Promise<void>;
  };
  env: {
    STRIPE_WEBHOOK_SECRET?: string;
    APP_URL?: string;
  };
  now?: () => Date;
}
