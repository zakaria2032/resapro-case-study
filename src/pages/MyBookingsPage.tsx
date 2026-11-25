import { useCallback, useEffect, useState } from 'react';
import { supabase, euros, dateFr, type Booking } from '../lib/supabase';
import { errorMessage } from '../lib/errors';
import ErrorBox from '../components/ErrorBox';

const STATUS: Record<Booking['status'], string> = {
  pending_payment: 'En attente de paiement',
  confirmed: 'Confirmée',
  cancelled: 'Annulée',
};

export default function MyBookingsPage({ userId }: { userId: string }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Le cloisonnement est garanti par la RLS en base ; ce filtre sert seulement l'affichage
    // (un pro voit aussi les réservations de ses créneaux, affichées dans l'Espace pro).
    const { data, error } = await supabase
      .from('bookings')
      .select('*, slots(*)')
      .eq('client_id', userId)
      .order('created_at', { ascending: false });
    if (error) return setError(await errorMessage(error));
    setBookings(data ?? []);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function cancel(id: string) {
    if (!window.confirm('Annuler cette réservation ? Le créneau sera remis en vente.')) return;
    setError(null);
    const { error } = await supabase.rpc('cancel_booking', { p_booking_id: id });
    if (error) setError(await errorMessage(error));
    load();
  }

  // Bucket privé : lien signé valable 60 secondes, généré au clic.
  // Supabase Storage sert les fichiers HTML en text/plain (protection anti-XSS) : ouvrir le lien afficherait
  // le code source. La facture est donc lue puis affichée dans une iframe « sandbox » (aucun script, origine isolée).
  async function openInvoice(b: Booking) {
    setError(null);
    const { data, error } = await supabase.storage.from('invoices').createSignedUrl(`${b.client_id}/${b.id}.html`, 60);
    if (error || !data) return setError(error ? await errorMessage(error) : 'Facture indisponible.');
    try {
      const r = await fetch(data.signedUrl);
      if (!r.ok) throw new Error(String(r.status));
      setInvoice(await r.text());
    } catch {
      setError('Facture indisponible, veuillez réessayer.');
    }
  }

  return (
    <section>
      <h2>Mes réservations</h2>
      <ErrorBox message={error} />
      {invoice !== null && (
        <div className="card stack">
          <iframe title="Facture" sandbox="" srcDoc={invoice} className="invoice" />
          <button onClick={() => setInvoice(null)}>Fermer la facture</button>
        </div>
      )}
      {bookings.length === 0 && !error && <p className="muted">Aucune réservation.</p>}
      <ul className="list">
        {bookings.map((b) => (
          <li key={b.id} className="card row">
            <div>
              <strong>{b.slots?.title}</strong>
              <div className="muted">{b.slots && dateFr(b.slots.starts_at)}</div>
              <div>
                {STATUS[b.status]} — acompte {euros(b.deposit_cents)}
              </div>
            </div>
            <div className="right">
              {b.status === 'confirmed' && (
                <button className="link" onClick={() => openInvoice(b)}>
                  Facture
                </button>
              )}
              {b.status !== 'cancelled' && <button onClick={() => cancel(b.id)}>Annuler</button>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
