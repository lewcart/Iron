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
# Two-tier check, reflecting what's actually load-bearing:
#
#   Tier A (HARD FAIL): the activation literal `NEXT_PUBLIC_E2E:"1"` baked
#   into a chunk. This is the build-flag-leaked-to-prod scenario the guard
#   is designed to catch. If this is present, webpack's DefinePlugin saw
#   NEXT_PUBLIC_E2E=1 during build and inlined it everywhere — both
#   runtime gates (in providers.tsx and test-bridge.ts) flip to true,
#   bridge mounts in prod, all storage is one XSS away from being wiped.
#
#   Tier B (WARN): the bridge identifier `__rebirthTestBridge` present in
#   any chunk. By design, the bridge code ships in a dynamic-import chunk
#   even in non-E2E builds (webpack can't fully tree-shake a referenced
#   dynamic import). It is double-gated by runtime env checks; with
#   NEXT_PUBLIC_E2E unset at build time the gates always evaluate false.
#   This is informational — security depends on Tier A staying clean, not
#   on the chunk being absent.

TIER_A='NEXT_PUBLIC_E2E[":=]+"1"'
TIER_B='__rebirthTestBridge'

ACTIVATION_HITS="$(grep -rIE \
  --include='*.js' \
  --include='*.html' \
  --include='*.json' \
  --include='*.map' \
  --include='*.txt' \
  "$TIER_A" "$OUT_DIR" || true)"

if [ -n "$ACTIVATION_HITS" ]; then
  echo "✗ check-no-test-bridge: NEXT_PUBLIC_E2E=\"1\" baked into $OUT_DIR/" >&2
  echo "$ACTIVATION_HITS" | head -10 >&2
  echo "" >&2
  echo "  The test bridge will MOUNT in this build. This must NOT ship to" >&2
  echo "  users — any same-origin XSS becomes a one-line data wipe." >&2
  echo "" >&2
  echo "  Likely cause: NEXT_PUBLIC_E2E=1 was set in env (.env.local," >&2
  echo "  .env.production, or shell) during \`npm run build:cap\`. Use" >&2
  echo "  \`npm run build:cap:e2e\` for E2E builds and plain \`build:cap\` for" >&2
  echo "  prod. Clean rebuild: \`rm -rf .next out && npm run build:cap\`." >&2
  exit 1
fi

PRESENCE_HITS="$(grep -rIE \
  --include='*.js' \
  --include='*.html' \
  --include='*.json' \
  "$TIER_B" "$OUT_DIR" 2>/dev/null | head -1 || true)"

if [ -n "$PRESENCE_HITS" ]; then
  echo "ℹ check-no-test-bridge: bridge code ships in $OUT_DIR/ (gated, dormant)"
  echo "  Activation flag absent → runtime gate evaluates false → bridge never mounts."
  echo "  This is by design (webpack can't fully tree-shake the dynamic import)."
fi

echo "✓ check-no-test-bridge: clean (NEXT_PUBLIC_E2E activation flag absent)"
