export const naira = (n: number) => '₦' + Math.max(0, n).toLocaleString('en-NG');
export const coinsLabel = (n: number) => `${n.toLocaleString('en-NG')} coin${n === 1 ? '' : 's'}`;

export function timeLeft(deadline: number | null, now = Date.now()): string {
  if (!deadline) return '';
  const ms = deadline - now;
  if (ms <= 0) return 'Registration closed';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h left` : `${h}h ${m}m left`;
}

export const STATUS_LABEL: Record<string, string> = {
  draft: 'DRAFT', open: 'OPEN', live: 'LIVE', completed: 'COMPLETED',
  cancelled: 'CANCELLED', failed: 'REFUNDED',
};

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
