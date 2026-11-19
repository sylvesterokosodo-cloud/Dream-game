import { useState } from 'react';
import { X } from 'lucide-react';
import { supabase } from '../lib/supabase';

/** Shown after the user opens the password-reset link from their email. */
export default function RecoveryModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setMsg('The two passwords do not match.'); return; }
    setBusy(true);
    setMsg('');
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      onDone();
    } catch (err) {
      setMsg((err as Error).message || 'Could not update your password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <form className="modal auth-modal" onSubmit={submit} aria-label="Set a new password">
        <div className="modal-head">
          <div><div className="eyebrow">ACCOUNT RECOVERY</div><h2>Set a new password</h2></div>
          <button type="button" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <label>New password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            required minLength={8} autoComplete="new-password" placeholder="At least 8 characters" />
        </label>
        <label>Confirm new password
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
            required minLength={8} autoComplete="new-password" />
        </label>
        {msg && <div className="form-note">{msg}</div>}
        <button className="btn-primary submit" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</button>
      </form>
    </div>
  );
}
