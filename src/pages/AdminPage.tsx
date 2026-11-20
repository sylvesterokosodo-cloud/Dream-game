import { useCallback, useEffect, useState } from 'react';
import { Copy, Plus, ShieldCheck, X } from 'lucide-react';
import {
  adminCreateTournament, adminPublishTournament, GAME_CATALOGUE, gameLabel, tournamentUrl,
  type Tournament,
} from '../lib/tournaments';
import {
  adminApproveResult, adminCancelTournament, fetchAdminPayments, fetchBracket, type AdminPayment, type Match,
} from '../lib/api';
import { coinsLabel, copyText, STATUS_LABEL } from '../lib/format';

type Props = { tournaments: Tournament[]; notify: (m: string) => void; onChanged: () => void };

const EMPTY = {
  name: '', description: '', prizeTitle: '', prizeDescription: '', prizeImage: '',
  prizeValue: '50000', prizeCoins: '0', entryFee: '1000', targetPlayers: '16',
  games: GAME_CATALOGUE.map((g) => g.id) as string[], publish: true,
};

export default function AdminPage({ tournaments, notify, onChanged }: Props) {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await adminCreateTournament({
        title: form.name, description: form.description,
        prizeTitle: form.prizeTitle, prizeDescription: form.prizeDescription,
        prizeImageUrl: form.prizeImage, prizeValueNgn: Number(form.prizeValue),
        prizeCoins: Number(form.prizeCoins), entryFeeCoins: Number(form.entryFee),
        targetPlayers: Number(form.targetPlayers), games: form.games, publish: form.publish,
      });
      notify(`Tournament ${r.status === 'open' ? 'published' : 'saved as draft'}. Link: ${tournamentUrl(r.slug)}`);
      setShow(false);
      setForm(EMPTY);
      onChanged();
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); notify(ok); onChanged(); } catch (e) { notify((e as Error).message); }
  };

  return (
    <section className="section">
      <div className="section-head">
        <div><div className="eyebrow">CONTROL ROOM</div><h2>Tournament manager</h2>
          <p>Create events, approve results and manage refunds.</p></div>
        <button className="btn-primary compact" onClick={() => setShow(true)}><Plus size={16} /> Create tournament</button>
      </div>
      <div className="admin-warning"><ShieldCheck size={18} />
        <span>Every action here is re-checked by the database. Only the verified owner account can change anything.</span></div>

      <div className="admin-list">
        {tournaments.map((t) => (
          <div className="admin-block" key={t.id}>
            <div className="admin-row">
              <div>
                <b>{t.name}</b>
                <span>{t.games.map(gameLabel).join(', ')} · {t.entriesCount}/{t.targetPlayers} players · {coinsLabel(t.entryFee)} entry</span>
              </div>
              <span className={'status-text ' + t.status}>{STATUS_LABEL[t.status]}</span>
              {t.status !== 'draft' && (
                <button onClick={async () => notify((await copyText(tournamentUrl(t.slug))) ? 'Link copied.' : tournamentUrl(t.slug))}
                  aria-label="Copy link"><Copy size={14} /></button>
              )}
              {t.status === 'draft' && (
                <button onClick={() => run(() => adminPublishTournament(t.id), 'Published. 48-hour registration window started.')}>Publish</button>
              )}
              {['draft', 'open', 'live'].includes(t.status) && (
                <button className="danger" onClick={() => {
                  if (window.confirm(`Cancel "${t.name}" and refund every entry?`)) {
                    run(() => adminCancelTournament(t.id, 'Cancelled by admin'), 'Tournament cancelled and entries refunded.');
                  }
                }}>Cancel</button>
              )}
            </div>
            {t.status === 'live' && <AdminMatches tournament={t} notify={notify} onChanged={onChanged} />}
          </div>
        ))}
        {tournaments.length === 0 && <div className="admin-row"><span>No tournaments yet.</span></div>}
      </div>

      <PaymentsPanel notify={notify} />

      {show && (
        <div className="modal-backdrop">
          <form className="modal" onSubmit={create}>
            <div className="modal-head"><div><div className="eyebrow">NEW CHALLENGE</div><h2>Create tournament</h2></div>
              <button type="button" onClick={() => setShow(false)} aria-label="Close"><X /></button></div>
            <label>Tournament name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={3} maxLength={120} /></label>
            <div className="game-pool-field">
              <strong>Games in this tournament</strong>
              <div className="game-pool-options">
                {GAME_CATALOGUE.map((g) => (
                  <label key={g.id} className="game-pool-option">
                    <input type="checkbox" checked={form.games.includes(g.id)}
                      onChange={(e) => setForm({ ...form, games: e.target.checked ? [...form.games, g.id] : form.games.filter((x) => x !== g.id) })} />
                    {g.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-row">
              <label>Entry fee (coins = ₦)
                <input type="number" min={1} max={1000000} value={form.entryFee} onChange={(e) => setForm({ ...form, entryFee: e.target.value })} required /></label>
              <label>Players needed
                <input type="number" min={2} max={512} value={form.targetPlayers} onChange={(e) => setForm({ ...form, targetPlayers: e.target.value })} required /></label>
            </div>
            <label>Prize name
              <input value={form.prizeTitle} onChange={(e) => setForm({ ...form, prizeTitle: e.target.value })} required minLength={2} maxLength={120} /></label>
            <label>Prize description
              <textarea value={form.prizeDescription} onChange={(e) => setForm({ ...form, prizeDescription: e.target.value })} required minLength={2} maxLength={2000} /></label>
            <label>Prize picture URL (https only)
              <input value={form.prizeImage} onChange={(e) => setForm({ ...form, prizeImage: e.target.value })} placeholder="https://…" /></label>
            <div className="form-row">
              <label>Prize value (₦)
                <input type="number" min={0} value={form.prizeValue} onChange={(e) => setForm({ ...form, prizeValue: e.target.value })} required /></label>
              <label>Bonus coins credited to champion
                <input type="number" min={0} value={form.prizeCoins} onChange={(e) => setForm({ ...form, prizeCoins: e.target.value })} required /></label>
            </div>
            <label className="game-pool-option"><input type="checkbox" checked={form.publish} onChange={(e) => setForm({ ...form, publish: e.target.checked })} />
              Publish now (starts the 48-hour registration window)</label>
            <button className="btn-primary submit" disabled={busy || form.games.length < 1}>{busy ? 'Saving…' : 'Create tournament'}</button>
          </form>
        </div>
      )}
    </section>
  );
}

function AdminMatches({ tournament, notify, onChanged }: { tournament: Tournament; notify: (m: string) => void; onChanged: () => void }) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    try {
      const b = await fetchBracket(tournament.id);
      setMatches(b.matches.filter((m) => m.status !== 'completed'));
      setNames(b.names);
    } catch (e) { notify((e as Error).message); }
  }, [tournament.id, notify]);
  useEffect(() => { load(); }, [load, tournament.entriesCount, tournament.status]);

  const nm = (id: string | null) => (id && names[id]) || 'Player';
  const approve = async (m: Match, winner: string) => {
    try {
      await adminApproveResult(m.id, winner);
      notify('Result approved.');
      await load();
      onChanged();
    } catch (e) { notify((e as Error).message); }
  };

  if (matches.length === 0) return <div className="admin-sub muted">No open matches.</div>;
  return (
    <div className="admin-sub">
      {matches.map((m) => (
        <div className="admin-match" key={m.id}>
          <span>{gameLabel(m.game)}: <b>{nm(m.playerA)}</b> vs <b>{nm(m.playerB)}</b>
            {' '}<em>{m.status === 'awaiting_approval' ? (m.proposedWinnerId ? `· proposed winner: ${nm(m.proposedWinnerId)}` : '· drawn, needs your decision') : `· ${m.status.replace('_', ' ')}`}</em></span>
          <span className="admin-match-actions">
            {[m.playerA, m.playerB].map((p) => p && (
              <button key={p} className={m.proposedWinnerId === p ? 'primary' : ''}
                onClick={() => approve(m, p)}>
                {m.proposedWinnerId === p ? 'Approve' : 'Award to'} {nm(p)}
              </button>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

function PaymentsPanel({ notify }: { notify: (m: string) => void }) {
  const [rows, setRows] = useState<AdminPayment[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    fetchAdminPayments().then((r) => { setRows(r.payments); setNames(r.names); }).catch((e: Error) => notify(e.message));
  }, [open, notify]);
  const stuck = (p: AdminPayment) => p.status === 'pending' && Date.now() - p.createdAt > 3_600_000;
  return (
    <div className="admin-panel">
      <button className="btn-outline compact" onClick={() => setOpen(!open)}>
        {open ? 'Hide' : 'Show'} payments &amp; reconciliation
      </button>
      {open && (
        <div className="admin-list" style={{ marginTop: 12 }}>
          {rows.length === 0 && <div className="admin-row"><span>No payments yet.</span></div>}
          {rows.map((p) => (
            <div className="admin-row" key={p.id}>
              <div>
                <b>₦{p.amountNgn.toLocaleString('en-NG')} · {names[p.userId] ?? 'Player'}</b>
                <span>{p.txRef} · {new Date(p.createdAt).toLocaleString()}{p.flwTransactionId ? ` · FLW #${p.flwTransactionId}` : ''}</span>
              </div>
              <span className={'status-text ' + (p.status === 'successful' ? 'completed' : p.status === 'failed' ? 'failed' : 'open')}>
                {p.status.toUpperCase()}{stuck(p) ? ' · STUCK >1h' : ''}
              </span>
            </div>
          ))}
          <div className="admin-row"><span>
            Stuck or failed payments that were actually charged must be checked in the Flutterwave dashboard.
            Re-delivering the webhook from there credits the coins safely (credits are idempotent).
          </span></div>
        </div>
      )}
    </div>
  );
}
