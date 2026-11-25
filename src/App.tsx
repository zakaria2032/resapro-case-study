import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, type Profile } from './lib/supabase';
import { errorMessage } from './lib/errors';
import ErrorBox from './components/ErrorBox';
import Banner from './components/Banner';
import AuthPage from './pages/AuthPage';
import SlotsPage from './pages/SlotsPage';
import MyBookingsPage from './pages/MyBookingsPage';
import ProDashboard from './pages/ProDashboard';
import AdminPage from './pages/AdminPage';
import ProfilePage from './pages/ProfilePage';

type Tab = 'slots' | 'bookings' | 'pro' | 'admin' | 'profile';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<Tab>('slots');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single()
      .then(async ({ data, error }) => {
        if (error) setError(await errorMessage(error));
        else setProfile(data);
      });
  }, [session]);

  if (!session) {
    return (
      <>
        <Banner />
        <AuthPage />
      </>
    );
  }

  const tabs: [Tab, string][] = [['slots', 'Créneaux'], ['bookings', 'Mes réservations']];
  if (profile?.role === 'pro') tabs.push(['pro', 'Espace pro']);
  if (profile?.role === 'admin') tabs.push(['admin', 'Administration']);
  tabs.push(['profile', 'Mon profil']);

  return (
    <>
      <Banner />
      <header className="topbar">
        <strong>RésaPro</strong>
        <nav>
          {tabs.map(([id, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        <span className="muted">
          {session.user.email} ({profile?.role})
        </span>
        <button onClick={() => supabase.auth.signOut()}>Déconnexion</button>
      </header>
      <main>
        <ErrorBox message={error} />
        {new URLSearchParams(window.location.search).get('paiement') === 'annule' && (
          <p className="error">Paiement annulé : la réservation n'est pas confirmée.</p>
        )}
        {tab === 'slots' && <SlotsPage />}
        {tab === 'bookings' && <MyBookingsPage userId={session.user.id} />}
        {tab === 'pro' && <ProDashboard userId={session.user.id} />}
        {tab === 'admin' && <AdminPage />}
        {tab === 'profile' && profile && <ProfilePage profile={profile} onSaved={setProfile} />}
      </main>
    </>
  );
}
