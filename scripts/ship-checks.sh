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

# ── 0. db migration gate ──────────────────────────────────────────────────────
# Refuses to ship when src/db/migrations/ has SQL files that haven't been
# applied to the configured DB (i.e. prod, when .env.local points at prod).
# Catches the failure mode that broke workout-set sync on 2026-05-04: code
# referenced a column whose CREATE migration was never run on prod.
#
# SKIP_DB_MIGRATE_CHECK=1 escape hatch when shipping a non-DB-touching change
# while a migration is intentionally pending (rare).
if [ "${SKIP_DB_MIGRATE_CHECK:-0}" = "1" ]; then
  note "SKIP_DB_MIGRATE_CHECK=1 — skipping db migration gate"
else
  note "db migration check…"
  npm run db:migrate:check
  done_ "no pending migrations"
fi

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
# SKIP_MAESTRO=1 skips ONLY the suite — the leak guard (step 5) is cheap and
# load-bearing for prod safety, so it always runs. If you need to bypass that
# too (truly emergency), set SKIP_LEAK_GUARD=1 explicitly and own the risk.
if [ "${SKIP_MAESTRO:-0}" = "1" ]; then
  note "SKIP_MAESTRO=1 — skipping maestro suite (leak guard still runs)"
  bash scripts/maestro-run.sh run   # records the skip in skip-log, exits 0
else
  note "maestro suite…"
  npm run test:maestro
  done_ "maestro suite passed"
fi

# ── 4. clean prod build (no E2E flag) ─────────────────────────────────────────
note "clean prod build (build:cap)…"
# Full nuke of .next/, not just .next/cache/. Webpack's persistent module
# graph in .next/ can carry inlined NEXT_PUBLIC_E2E constants from a prior
# E2E build across into the next prod build. The 30s rebuild cost is worth
# provable isolation.
rm -rf out .next
npm run build:cap
done_ "prod build done"

# ── 5. grep guard against test-bridge leak ────────────────────────────────────
if [ "${SKIP_LEAK_GUARD:-0}" = "1" ]; then
  note "SKIP_LEAK_GUARD=1 — bypassing prod leak guard (DANGEROUS)"
else
  note "grep guard…"
  npm run check:no-test-bridge
  done_ "grep guard clean"
fi

done_ "ship:checks all green"
