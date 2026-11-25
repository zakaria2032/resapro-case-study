// Point d'entrée Supabase Edge Function (Deno). La logique est dans handler.ts (testée sous Node).
import { handler } from './handler.ts';
import { makeDeps } from '../_shared/deno-deps.ts';

const deps = makeDeps();
Deno.serve((req) => handler(req, deps));
