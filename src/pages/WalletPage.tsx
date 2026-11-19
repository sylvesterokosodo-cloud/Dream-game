import { useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { fetchLedger, startCheckout, type LedgerRow } from '../lib/api';
import { coinsLabel } from '../lib/format';
import type { WalletSnapshot } from '../lib/tournaments';

type Props = {
  userId: string | null;
  wallet: WalletSnapshot;
  notify: (m: string) => void;
  requireLogin: () => void;
  refreshKey: number;
};

const PRESETS = [1000, 2000, 5000, 10000];
const LABEL: Record<string, string> = {
  purchase: 'Coins purchased', entry_reserve: 'Entry held in escrow', entry_refund: 'Entry refunded',
  entry_settle: 'Entry fee settled', prize_credit: 'Prize credited', admin_adjustment: 'Adjustment',
};

export default function WalletPage({ userId, wallet, notify, requireLogin, refreshKey }: Props) {
  const [amount, setAmount] = useState('1000');
  const [busy, setBusy] = useState(false);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);

  useEffect(() => {
    if (!userId) { setLedger([]); return; }
    fetchLedger(userId).then(setLedger).catch(() => setLedger([]));
  }, [userId, refreshKey]);

  const n = Number(amount);
  const valid = Number.isInteger(n) && n >= 100 && n <= 500000;

  const buy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) { requireLogin(); return; }
    if (!valid) { notify('Enter a whole amount between ₦100 and ₦500,000.'); return; }
    setBusy(true);
    try {
      const { link } = await startCheckout(n);
      window.location.assign(link); // Flutterwave hosted checkout
    } catch (err) {
      notify((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <section className="section wallet-section">
      <div className="section-head">
        <div><div className="eyebrow">PLAYER ACCOUNT</div><h2>Your Dream Wallet</h2>
          <p>1 coin = ₦1. Entry fees are held in escrow until the tournament ends or is refunded.</p></div>
      </div>
      <div className="wallet-cards">
        <div className="wallet-main"><Wallet size={23} /><small>AVAILABLE COINS</small>
          <strong>{wallet.availableCoins.toLocaleString('en-NG')}</strong><span>Ready to enter tournaments</span></div>
        <div className="wallet-secondary"><small>IN ESCROW</small><b>{wallet.escrowedCoins.toLocaleString('en-NG')}</b>
          <p>Held for tournaments you entered</p></div>
      </div>

      <form className="credit-form" onSubmit={buy}>
        <h3>Buy coins</h3>
        <p>Pay securely with Flutterwave (card, bank transfer, USSD). Coins are added after we verify the payment with Flutterwave.</p>
        <div className="presets">
          {PRESETS.map((p) => (
            <button type="button" key={p} className={'chip' + (n === p ? ' on' : '')} onClick={() => setAmount(String(p))}>₦{p.toLocaleString('en-NG')}</button>
          ))}
        </div>
        <div className="inline-field">
          <span>₦</span>
          <input type="number" inputMode="numeric" min={100} max={500000} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount in naira" />
          <button disabled={busy || !valid}>{busy ? 'Redirecting…' : `Buy ${valid ? coinsLabel(n) : 'coins'}`}</button>
        </div>
      </form>

      <h3 style={{ marginTop: 28 }}>Recent activity</h3>
      {ledger.length === 0 ? <p className="muted">No transactions yet.</p> : (
        <div className="admin-list">
          {ledger.map((r) => (
            <div className="admin-row" key={r.id}>
              <div><b>{LABEL[r.type] ?? r.type}</b><span>{new Date(r.createdAt).toLocaleString()}</span></div>
              <span className="delta">
                {r.availableDelta > 0 ? '+' : ''}{r.availableDelta} coins
                {r.escrowDelta !== 0 ? ` · escrow ${r.escrowDelta > 0 ? '+' : ''}${r.escrowDelta}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
