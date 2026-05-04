#!/usr/bin/env bash
# Pre-ship guard: fail if the E2E test bridge string leaked into the prod
# static export. This is the second line of defence behind webpack DCE.
#
# Run after `npm run build:cap` (NOT `build:cap:e2e`). Wired into /ship.

set -euo pipefail

OUT_DIR="${1:-out}"

if [ ! -d "$OUT_DIR" ]; then
  echo "✗ check-no-test-bridge: $OUT_DIR/ does not exist — did you run \`npm run build:cap\`?" >&2
  exit 2
fi

# Strict pattern: matches the bridge global identifier. We intentionally do
# NOT match "__rebirth" alone — that's used elsewhere in the codebase.
PATTERN='__rebirthTestBridge'

# Scan all text artifacts in the static export. Sourcemaps (.js.map),
# Next/PWA manifests (.json), service-worker assets (sw.js, workbox-*.js),
# and route payloads (.txt) all need checking — webpack DCE catches most
# leaks at runtime, but bundle metadata or split chunks can still surface
# the identifier even when the runtime path is dead. -I auto-skips binary
# files (images, fonts).
HITS="$(grep -rIE \
  --include='*.js' \
  --include='*.html' \
  --include='*.json' \
  --include='*.map' \
  --include='*.txt' \
  "$PATTERN" "$OUT_DIR" || true)"

if [ -n "$HITS" ]; then
  echo "✗ check-no-test-bridge: '$PATTERN' found in prod build at $OUT_DIR/" >&2
  echo "$HITS" | head -10 >&2
  echo "" >&2
  echo "  This means the test bridge leaked into a non-E2E build. Likely cause:" >&2
  echo "    1. NEXT_PUBLIC_E2E=1 was set during the prod build" >&2
  echo "    2. webpack failed to dead-eliminate the gated import in providers.tsx" >&2
  echo "" >&2
  echo "  Fix: clean rebuild — \`rm -rf .next out && npm run build:cap\`" >&2
  exit 1
fi

echo "✓ check-no-test-bridge: clean ($OUT_DIR/ has no '$PATTERN' references)"
