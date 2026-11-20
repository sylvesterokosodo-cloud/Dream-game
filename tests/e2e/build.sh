#!/bin/sh
# Bundles the REAL app source with a mock Supabase for browser tests. Run from repo root.
set -e
ESBUILD="${ESBUILD:-npx esbuild}"
cd "$(dirname "$0")"
rm -rf dist dist-bad && mkdir dist dist-bad
bundle() { # outdir supabase_url key
  $ESBUILD entry.tsx --bundle --outdir="$1" --jsx=automatic --loader:.css=css \
    --alias:@supabase/supabase-js=./mocks/supabase.mock.ts \
    --alias:lucide-react=./mocks/lucide.stub.tsx \
    --define:import.meta.env.VITE_SUPABASE_URL="\"$2\"" \
    --define:import.meta.env.VITE_SUPABASE_ANON_KEY="\"$3\"" \
    --define:import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY=undefined \
    --define:__BUILD_SHA__='"test1234abcd"' --define:__BUILD_TIME__='"2026-01-01T00:00:00Z"' \
    --define:process.env.NODE_ENV='"production"' --log-level=warning
}
GOOD_URL="https://abcdefghijklmnopqrst.supabase.co"
GOOD_KEY="sb_publishable_TestKeyTestKeyTestKeyTestKey1"
bundle dist "$GOOD_URL" "$GOOD_KEY"
# Deliberately broken settings (placeholder copied from .env.example) to test the setup-error screen
bundle dist-bad "https://YOUR-PROJECT-REF.supabase.co" "$GOOD_KEY"
for d in dist dist-bad; do
  cp base.css $d/base.css
  cat > $d/index.html <<'HTML'
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="base.css"><link rel="stylesheet" href="entry.css"></head>
<body><div id="root"></div><script src="entry.js"></script></body></html>
HTML
done
echo "bundle ok: $(du -k dist/entry.js | cut -f1) KB"
