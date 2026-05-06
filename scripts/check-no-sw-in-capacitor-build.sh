#!/usr/bin/env bash
# Pre-ship guard: fail if a service worker leaked into the Capacitor static
# export. The bundle is already on local disk inside the .ipa, so an extra
# Workbox cache layer adds zero offline benefit and creates a stale-asset
# trap — after a new install, the previously registered SW serves last
# build's HTML / chunk hashes, masking newly shipped UI (e.g. MuscleMap on
# the exercise page) until the user force-quits twice.
#
# next.config.ts disables next-pwa when CAPACITOR_BUILD=1; this script is
# the second line of defence in case anyone re-enables it.
#
# Run after `npm run build:cap`. Wired into ship-checks.sh.

set -euo pipefail

OUT_DIR="${1:-out}"

if [ ! -d "$OUT_DIR" ]; then
  echo "✗ check-no-sw: $OUT_DIR/ does not exist — did you run \`npm run build:cap\`?" >&2
  exit 2
fi

HITS=()
for f in \
  "$OUT_DIR"/sw.js \
  "$OUT_DIR"/sw.js.map \
  "$OUT_DIR"/workbox-*.js \
  "$OUT_DIR"/workbox-*.js.map \
  "$OUT_DIR"/swe-worker-*.js \
  "$OUT_DIR"/swe-worker-*.js.map \
  "$OUT_DIR"/fallback-*.js \
  "$OUT_DIR"/fallback-*.js.map
do
  # Glob may not match — the literal string is then the value of $f. Skip those.
  [ -e "$f" ] && HITS+=("$f")
done

if [ ${#HITS[@]} -gt 0 ]; then
  echo "✗ check-no-sw: service worker / Workbox files present in $OUT_DIR/" >&2
  for f in "${HITS[@]}"; do echo "    $f" >&2; done
  echo "" >&2
  echo "  Capacitor builds must NOT ship a service worker. The bundle is" >&2
  echo "  already on local disk in the .ipa; a Workbox CacheFirst layer just" >&2
  echo "  serves stale HTML/chunks after each install (see v0.10.1 fix)." >&2
  echo "" >&2
  echo "  Likely cause: \`disable\` in next.config.ts no longer covers" >&2
  echo "  CAPACITOR_BUILD=1, or stale artifacts from a prior web build are" >&2
  echo "  bleeding through public/ → out/. Clean rebuild:" >&2
  echo "    rm -f public/sw.js public/workbox-*.js public/fallback-*.js" >&2
  echo "    rm -rf .next out && npm run build:cap" >&2
  exit 1
fi

echo "✓ check-no-sw: no service worker in $OUT_DIR/"
