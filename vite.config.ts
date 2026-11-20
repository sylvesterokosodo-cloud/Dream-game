import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const sha = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || 'local';
const builtAt = new Date().toISOString();

export default defineConfig({
  plugins: [
    react(),
    {
      // Publishes /build-info.json (no secrets) so you can check which commit a deployment contains.
      name: 'dream-build-info',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'build-info.json',
          source: JSON.stringify({
            commit: sha,
            branch: process.env.CF_PAGES_BRANCH || 'local',
            builtAt,
            supabaseHost: (() => {
              try { return new URL(process.env.VITE_SUPABASE_URL || '').hostname; } catch { return 'invalid'; }
            })(),
          }, null, 2),
        });
      },
    },
  ],
  base: './',
  define: {
    __BUILD_SHA__: JSON.stringify(sha),
    __BUILD_TIME__: JSON.stringify(builtAt),
  },
  build: {
    outDir: process.env.APPDEPLOY_VITE_OUT_DIR || 'dist',
    sourcemap:
      process.env.APPDEPLOY_VITE_SOURCEMAP === 'hidden' ? 'hidden' : false,
    rollupOptions: {
      maxParallelFileOps: 128,
    },
  },
});
