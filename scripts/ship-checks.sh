#!/usr/bin/env bash
# Ship-time bundle: everything that should pass before pushing to main.
# Composes individual gates so /ship (or a manual pre-push run) gets a
# single command.
#
# Order matters:
#   1. vitest         — fast unit tests
#   2. maestro lint   — flows are syntactically valid
#   3. maestro suite  — UI regressions caught (uses E2E build via orchestrator)
#   4. prod build     — clean build (no E2E flag)
#   5. grep guard     — bridge module did NOT leak into prod static export
#
# Each step exits non-zero on failure; `set -e` halts the pipeline.
#
# Override (single-user, emergency only):
#   SKIP_MAESTRO=1 bash scripts/ship-checks.sh   # skip maestro suite + grep guard
#   SKIP_VITEST=1  bash scripts/ship-checks.sh   # skip vitest

set -euo pipefail

cd "$(dirname "$0")/.."

note() { echo "▸ $*"; }
done_() { echo "✓ $*"; }

# ── 1. vitest ─────────────────────────────────────────────────────────────────
if [ "${SKIP_VITEST:-0}" = "1" ]; then
  note "SKIP_VITEST=1 — skipping vitest"
else
  note "vitest…"
  npm run test
  done_ "vitest passed"
fi

# ── 2. maestro selector lint ──────────────────────────────────────────────────
note "maestro selector lint…"
npm run test:maestro:lint
done_ "lint clean"

# ── 3. maestro suite ──────────────────────────────────────────────────────────
if [ "${SKIP_MAESTRO:-0}" = "1" ]; then
  note "SKIP_MAESTRO=1 — skipping maestro suite + grep guard"
  echo "  (skip-log appended by orchestrator)"
  bash scripts/maestro-run.sh run   # this records the skip and exits 0
  exit 0
fi

note "maestro suite…"
npm run test:maestro
done_ "maestro suite passed"

# ── 4. clean prod build (no E2E flag) ─────────────────────────────────────────
note "clean prod build (build:cap)…"
rm -rf out .next/cache
npm run build:cap
done_ "prod build done"

# ── 5. grep guard against test-bridge leak ────────────────────────────────────
note "grep guard…"
npm run check:no-test-bridge
done_ "grep guard clean"

done_ "ship:checks all green"
