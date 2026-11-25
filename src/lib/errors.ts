import { FunctionsHttpError } from '@supabase/supabase-js';

/** Message lisible à partir d'une erreur Supabase (base, auth, stockage ou fonction serveur). */
export async function errorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (body?.error) return String(body.error);
    } catch {
      // corps non JSON : message générique ci-dessous
    }
  }
  if (error && typeof error === 'object' && 'message' in error && error.message) return String(error.message);
  return 'Une erreur inattendue est survenue. Veuillez réessayer.';
}
