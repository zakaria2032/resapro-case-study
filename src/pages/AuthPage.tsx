import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { errorMessage } from '../lib/errors';
import ErrorBox from '../components/ErrorBox';

export default function AuthPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'client' | 'pro'>('client');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    const { data, error } =
      mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName, role } } });
    setBusy(false);
    if (error) return setError(await errorMessage(error));
    if (mode === 'signup' && !data.session) setInfo('Compte créé : vérifiez votre e-mail pour confirmer l’inscription.');
  }

  return (
    <main className="card narrow">
      <h1>RésaPro</h1>
      <p className="muted">Réservez un créneau chez un indépendant et réglez l'acompte en ligne.</p>
      <form onSubmit={submit} className="stack">
        {mode === 'signup' && (
          <>
            <input placeholder="Nom complet" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            <select value={role} onChange={(e) => setRole(e.target.value as 'client' | 'pro')}>
              <option value="client">Je suis client</option>
              <option value="pro">Je suis professionnel</option>
            </select>
          </>
        )}
        <input type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input
          type="password"
          placeholder="Mot de passe"
          value={password}
          minLength={8}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <ErrorBox message={error} />
        {info && <p className="muted">{info}</p>}
        <button type="submit" disabled={busy}>
          {mode === 'login' ? 'Se connecter' : "S'inscrire"}
        </button>
      </form>
      <button className="link" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
        {mode === 'login' ? 'Créer un compte' : "J'ai déjà un compte"}
      </button>
    </main>
  );
}
