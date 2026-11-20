// Test-only in-memory fake of the parts of supabase-js the app uses.
// It mimics SERVER RESPONSES so the UI can be exercised. It does NOT test SQL/RLS.
/* eslint-disable @typescript-eslint/no-explicit-any */
const M = (): any => (window as any).__MOCK__;
const calls = (): any[] => {
  const list: any[] = ((window as any).__calls ??= []);
  return { push: (c: any) => { list.push(c); console.log('__CALL__' + JSON.stringify(c)); return list.length; } } as unknown as any[];
};

class Q {
  filters: ((r: any) => boolean)[] = [];
  ord: [string, boolean] | null = null;
  lim = Infinity;
  constructor(public table: string) {}
  select() { return this; }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: any) { this.filters.push((r) => r[c] !== v); return this; }
  in(c: string, v: any[]) { this.filters.push((r) => v.includes(r[c])); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.ord = [c, o?.ascending !== false]; return this; }
  limit(n: number) { this.lim = n; return this; }
  run() {
    let rows: any[] = (M().tables?.[this.table] ?? []).filter((r: any) => this.filters.every((f) => f(r)));
    if (this.ord) { const [c, asc] = this.ord; rows = [...rows].sort((a, b) => (a[c] > b[c] ? 1 : -1) * (asc ? 1 : -1)); }
    return { data: rows.slice(0, this.lim), error: null };
  }
  maybeSingle() { return Promise.resolve({ data: this.run().data[0] ?? null, error: null }); }
  single() { return this.maybeSingle(); }
  then(res: any, rej: any) { return Promise.resolve(this.run()).then(res, rej); }
}

export const createClient = () => ({
  from: (t: string) => new Q(t),
  rpc: async (name: string, args: any) => {
    calls().push({ type: 'rpc', name, args });
    const m = M();
    if (name === 'dg_is_admin') return { data: !!m.isAdmin, error: null };
    if (name === 'dg_run_expiry') return { data: 0, error: null };
    if (name.startsWith('dg_admin_') && !m.isAdmin) {
      return { data: null, error: { message: 'Administrator access required' } };
    }
    if (m.rpcErrors?.[name]) return { data: null, error: { message: m.rpcErrors[name] } };
    return { data: m.rpcResults?.[name] ?? { ok: true, message: 'ok', id: 'x', slug: 'new-slug-1', status: 'open' }, error: null };
  },
  functions: {
    invoke: async (name: string, opts: any) => {
      calls().push({ type: 'invoke', name, body: opts?.body });
      const r = M().invoke?.[name];
      return { data: r ?? {}, error: null };
    },
  },
  auth: {
    getUser: async () => ({ data: { user: M().user ?? null }, error: null }),
    onAuthStateChange: (cb: any) => { (window as any).__authCb = cb; return { data: { subscription: { unsubscribe() {} } } }; },
    updateUser: async (args: any) => { calls().push({ type: 'auth', name: 'updateUser', args }); return { data: {}, error: null }; },
    signOut: async () => ({ error: null }),
    signInWithPassword: async () => ({ error: M().authError ? { message: M().authError } : null }),
    signUp: async () => ({ data: { session: null }, error: M().authError ? { message: M().authError } : null }),
    resetPasswordForEmail: async () => ({ error: null }),
  },
});
