export type Health =
  | { state: 'ok' }
  | { state: 'unreachable'; detail: string } // DNS failure, offline, blocked (browser says "Failed to fetch")
  | { state: 'bad-key'; detail: string }
  | { state: 'error'; detail: string };

/** Asks Supabase Auth's public health endpoint (needs the public key in the apikey header). */
export async function probeSupabase(url: string, key: string, timeoutMs = 8000): Promise<Health> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/auth/v1/health`, { headers: { apikey: key }, signal: ctl.signal });
    if (res.ok) return { state: 'ok' };
    if (res.status === 401 || res.status === 403) return { state: 'bad-key', detail: `HTTP ${res.status}` };
    return { state: 'error', detail: `HTTP ${res.status}` };
  } catch (e) {
    return { state: 'unreachable', detail: (e as Error).name === 'AbortError' ? 'timed out' : (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
