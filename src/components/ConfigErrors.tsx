import type { Health } from '../lib/health';

export function ConfigErrorScreen({ problems }: { problems: string[] }) {
  return (
    <div className="app-shell">
      <main className="section" role="alert">
        <div className="eyebrow">SETUP NEEDED</div>
        <h2>Dream Game is not connected to its server yet</h2>
        <p className="muted">
          This website was built with incorrect Supabase settings. The site owner needs to fix the
          variables in Cloudflare Pages and redeploy.
        </p>
        <div className="admin-warning" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          {problems.map((p) => <span key={p}>• {p}</span>)}
        </div>
        <p className="muted">
          Fix: Cloudflare Pages → your project → Settings → Variables and Secrets → set
          <b> VITE_SUPABASE_URL</b> and <b>VITE_SUPABASE_ANON_KEY</b>, then Deployments → Retry deployment.
        </p>
      </main>
    </div>
  );
}

export function ConnectionBanner({ health, host }: { health: Health; host: string }) {
  if (health.state === 'ok') return null;
  const text =
    health.state === 'unreachable'
      ? `Your browser cannot reach the Dream Game server (${host}). Check your internet connection. If you own this site, the Supabase URL baked into this build is probably wrong or the Supabase project is paused. (${health.detail})`
      : health.state === 'bad-key'
        ? `The Dream Game server (${host}) rejected this site's public key (${health.detail}). The key in the build is wrong or was rotated.`
        : `The Dream Game server (${host}) answered with an unexpected error (${health.detail}).`;
  return (
    <div className="admin-warning" role="alert" style={{ margin: '0 auto 16px', maxWidth: 1152 }}>
      <span>{text}</span>
    </div>
  );
}
