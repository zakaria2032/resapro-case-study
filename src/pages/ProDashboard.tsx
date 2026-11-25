import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase, euros, dateFr, type Booking, type Slot } from '../lib/supabase';
import { errorMessage } from '../lib/errors';
import ErrorBox from '../components/ErrorBox';

export default function ProDashboard({ userId }: { userId: string }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [title, setTitle] = useState('Séance individuelle');
  const [startsAt, setStartsAt] = useState('');
  const [duration, setDuration] = useState(60);
  const [price, setPrice] = useState(60);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: s, error: e1 } = await supabase.from('slots').select('*').eq('pro_id', userId).order('starts_at');
    if (e1) return setError(await errorMessage(e1));
    setSlots(s ?? []);
    const ids = (s ?? []).map((x) => x.id);
    const { data: b, error: e2 } = await supabase.from('bookings').select('*, slots(*)').in('slot_id', ids);
    if (e2) return setError(await errorMessage(e2));
    setBookings(b ?? []);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  async function addSlot(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const start = new Date(startsAt);
    if (!startsAt || Number.isNaN(start.getTime()) || start <= new Date()) {
      return setError('Choisissez une date et une heure à venir.');
    }
    if (duration <= 0 || price <= 0) return setError('La durée et le prix doivent être positifs.');
    const end = new Date(start.getTime() + duration * 60_000);
    const { error } = await supabase.from('slots').insert({
      pro_id: userId,
      title,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      price_cents: Math.round(price * 100),
    });
    if (error) return setError(await errorMessage(error));
    load();
  }

  return (
    <section>
      <h2>Espace pro</h2>
      <form onSubmit={addSlot} className="card stack">
        <h3>Publier un créneau</h3>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Intitulé" />
        <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        <label>
          Durée (min) <input type="number" value={duration} onChange={(e) => setDuration(+e.target.value)} />
        </label>
        <label>
          Prix (€) <input type="number" value={price} onChange={(e) => setPrice(+e.target.value)} />
        </label>
        <ErrorBox message={error} />
        <button type="submit">Publier</button>
      </form>
      <h3>Mes créneaux</h3>
      <ul className="list">
        {slots.map((s) => (
          <li key={s.id} className="card row">
            <span>
              {s.title} — {dateFr(s.starts_at)}
            </span>
            <span>
              {euros(s.price_cents)} {s.is_booked ? '· réservé' : '· libre'}
            </span>
          </li>
        ))}
      </ul>
      <h3>Réservations reçues</h3>
      <ul className="list">
        {bookings.map((b) => (
          <li key={b.id} className="card row">
            <span>{b.slots?.title}</span>
            <span>
              {b.status} · acompte {euros(b.deposit_cents)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
