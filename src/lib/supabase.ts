import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);

export type Role = 'client' | 'pro' | 'admin';

export interface Profile {
  id: string;
  full_name: string | null;
  role: Role;
}

export interface Slot {
  id: string;
  pro_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  price_cents: number;
  is_booked: boolean;
}

export interface Booking {
  id: string;
  slot_id: string;
  client_id: string;
  status: 'pending_payment' | 'confirmed' | 'cancelled';
  deposit_cents: number;
  created_at: string;
  slots?: Slot;
}

export const euros = (cents: number) =>
  (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

export const dateFr = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
