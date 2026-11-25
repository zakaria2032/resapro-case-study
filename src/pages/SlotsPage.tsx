import { useEffect, useState } from 'react';
import { supabase, euros, dateFr, type Slot } from '../lib/supabase';
import { errorMessage } from '../lib/errors';
import ErrorBox from '../components/ErrorBox';

// Affichage indicatif uniquement : le montant réellement facturé est calculé par le serveur.
const DEPOSIT_RATE = 0.3;
const estimatedDeposit = (priceCents: number) => Math.ceil(priceCents * DEPOSIT_RATE);

export default function SlotsPage() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('slots')
      .select('*')
      .eq('is_booked', false)
      .gt('starts_at', new Date().toISOString())
      .order('starts_at')
      .then(async ({ data, error }) => {
        if (error) setError(await errorMessage(error));
        else setSlots(data ?? []);
      });
  }, []);

  async function book(slot: Slot) {
    setError(null);
    setBusyId(slot.id);
    const { data, error } = await supabase.functions.invoke<{ url: string }>('create-checkout', {
      body: { slot_id: slot.id },
    });
    if (error || !data?.url) {
      setBusyId(null);
      return setError(error ? await errorMessage(error) : 'Paiement indisponible, veuillez réessayer.');
    }
    window.location.href = data.url;
  }

  return (
    <section>
      <h2>Créneaux disponibles</h2>
      <ErrorBox message={error} />
      {slots.length === 0 && !error && <p className="muted">Aucun créneau disponible pour le moment.</p>}
      <ul className="list">
        {slots.map((s) => (
          <li key={s.id} className="card row">
            <div>
              <strong>{s.title}</strong>
              <div className="muted">{dateFr(s.starts_at)}</div>
            </div>
            <div className="right">
              <div>{euros(s.price_cents)}</div>
              <div className="muted">Acompte : {euros(estimatedDeposit(s.price_cents))}</div>
              <button onClick={() => book(s)} disabled={busyId !== null}>
                {busyId === s.id ? 'Redirection…' : 'Réserver'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
