import { useEffect, useState } from 'react';
import { supabase, euros, type Role } from '../lib/supabase';
import { errorMessage } from '../lib/errors';
import ErrorBox from '../components/ErrorBox';

interface AdminStats {
  bookings: number;
  cancelled_bookings: number;
  revenue_cents: number;
  cancelled_paid_cents: number;
  payment_anomalies: number;
  users: { id: string; email: string; full_name: string | null; role: Role }[];
}

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Les données d'administration passent par une fonction serveur : aucune clé privilégiée dans le navigateur.
    supabase.functions.invoke<AdminStats>('admin-stats').then(async ({ data, error }) => {
      if (error) setError(await errorMessage(error));
      else setStats(data);
    });
  }, []);

  return (
    <section>
      <h2>Administration</h2>
      <ErrorBox message={error} />
      {stats && (
        <>
          <p>
            {stats.bookings} réservations actives · {euros(stats.revenue_cents)} d'acomptes encaissés
          </p>
          {stats.cancelled_paid_cents > 0 && (
            <p className="muted">
              {euros(stats.cancelled_paid_cents)} d'acomptes encaissés sur des réservations annulées (remboursement à
              décider), non comptés ci-dessus.
            </p>
          )}
          {stats.payment_anomalies > 0 && (
            <p className="error">{stats.payment_anomalies} paiement(s) non rattaché(s) à une réservation : à vérifier.</p>
          )}
          <table>
            <thead>
              <tr>
                <th>Nom</th>
                <th>E-mail</th>
                <th>Rôle</th>
              </tr>
            </thead>
            <tbody>
              {stats.users.map((u) => (
                <tr key={u.id}>
                  <td>{u.full_name}</td>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
