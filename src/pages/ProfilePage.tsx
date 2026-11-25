import { useState, type FormEvent } from 'react';
import { supabase, type Profile } from '../lib/supabase';
import { errorMessage } from '../lib/errors';
import ErrorBox from '../components/ErrorBox';

export default function ProfilePage({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const [fullName, setFullName] = useState(profile.full_name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    // Seul le nom est modifiable : le rôle est géré exclusivement côté serveur.
    const { data, error } = await supabase
      .from('profiles')
      .update({ full_name: fullName })
      .eq('id', profile.id)
      .select()
      .single();
    if (error) return setError(await errorMessage(error));
    onSaved(data);
    setSaved(true);
  }

  return (
    <section className="card narrow">
      <h2>Mon profil</h2>
      <form onSubmit={save} className="stack">
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nom complet" />
        <ErrorBox message={error} />
        {saved && <p className="muted">Profil enregistré.</p>}
        <button type="submit">Enregistrer</button>
      </form>
    </section>
  );
}
