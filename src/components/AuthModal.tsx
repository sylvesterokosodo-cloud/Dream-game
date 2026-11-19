import { useState } from 'react';
import { Crown, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Props = { onClose: () => void; onDone: () => void };

export default function AuthModal({ onClose, onDone }: Props) {
  const [mode, setMode] = useState<'register' | 'login'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      const cleanEmail = email.trim().toLowerCase();
      if (mode === 'register') {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: { data: { display_name: name.trim() } },
        });
        if (error) throw error;
        if (!data.session) {
          setMsg('Check your email to confirm your account, then log in.');
          setMode('login');
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) throw error;
      }
      setPassword('');
      onDone();
    } catch (err) {
      setMsg((err as Error).message || 'Could not complete account access.');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!email.trim()) { setMsg('Enter your email first, then tap "Forgot password".'); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: window.location.origin + window.location.pathname,
    });
    setMsg(error ? error.message : 'Password reset email sent (if the account exists).');
  };

  return (
    <div className="modal-backdrop">
      <form className="modal auth-modal" onSubmit={submit}>
        <div className="modal-head">
          <div className="brand">
            <div className="brand-icon"><Crown size={22} /></div>
            <div><strong>DREAM <span>GAME</span></strong></div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <h2>{mode === 'register' ? 'Create your account' : 'Welcome back'}</h2>
        <p className="muted">Each player gets a separate profile and wallet.</p>
        {mode === 'register' && (
          <label>Display name
            <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={48} placeholder="e.g. Tunde" />
          </label>
        )}
        <label>Email address
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label>Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'} placeholder="At least 8 characters" />
        </label>
        {msg && <div className="form-note">{msg}</div>}
        <button className="btn-primary submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'register' ? 'Create my account' : 'Log in'}
        </button>
        <button type="button" className="btn-outline submit" style={{ marginTop: 10 }}
          onClick={() => setMode(mode === 'register' ? 'login' : 'register')}>
          {mode === 'register' ? 'Already have an account? Log in' : 'New here? Create account'}
        </button>
        {mode === 'login' && (
          <button type="button" className="link-btn" onClick={reset}>Forgot password?</button>
        )}
      </form>
    </div>
  );
}
