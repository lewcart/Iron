#!/usr/bin/env bash
# Maestro UI test orchestrator for the iOS simulator.
#
# Subcommands:
#   run      (default) — run full suite incrementally
#   full                — force cold rebuild + full suite
#   watch <flow>        — maestro test --continuous against one flow
#   studio              — open Maestro Studio against running sim
#   failed              — re-run flows that failed last time (parsed from junit.xml)
#   tree <route>        — dump live a11y tree for a given route, as JSON
#   doctor              — verify environment without running flows
#
# Pass-through args (after `--`) go to maestro test.
#
# Env:
#   SKIP_MAESTRO=1      — record a skip and exit 0 (used by /ship escape hatch)

set -euo pipefail

# ── Constants ─────────────────────────────────────────────────────────────────
MAESTRO_VERSION_PIN="${MAESTRO_VERSION_PIN:-2.4.0}"
SIM_NAME="${REBIRTH_SIM_NAME:-iPhone 17 Pro}"
SIM_OS="${REBIRTH_SIM_OS:-iOS 26.0}"
APP_BUNDLE_ID="app.rebirth"
DERIVED_DATA="build/ios-sim"
APP_PATH="$DERIVED_DATA/Build/Products/Debug-iphonesimulator/App.app"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

OUT_ROOT=".maestro-out"
mkdir -p "$OUT_ROOT"
TS="$(date +%Y-%m-%dT%H-%M-%S)"
RUN_DIR="$OUT_ROOT/$TS"

LAST_HASH_FILE="$OUT_ROOT/.last-build-hash"
SKIP_LOG="$OUT_ROOT/skip-log.txt"

# ── SKIP_MAESTRO escape hatch ─────────────────────────────────────────────────
if [ "${SKIP_MAESTRO:-0}" = "1" ]; then
  COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo 'no-commit')"
  printf '%s\t%s\tSKIP_MAESTRO=1\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$COMMIT" >> "$SKIP_LOG"
  echo "▸ SKIP_MAESTRO=1 — skipped, recorded to $SKIP_LOG"
  exit 0
fi

# ── Helpers ───────────────────────────────────────────────────────────────────
err() { echo "✗ $*" >&2; }
note() { echo "▸ $*"; }
done_() { echo "✓ $*"; }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "$1 not on PATH. $2"
    exit 1
  fi
}

current_sources_hash() {
  # Hash of all files Maestro can be invalidated by: web sources, iOS native
  # sources, capacitor config, package.json. Excludes generated files.
  {
    git ls-files src public capacitor.config.ts package.json next.config.ts 2>/dev/null
    git ls-files 'ios/App/App/*.swift' 'ios/App/App/*.plist' 'ios/App/App.xcodeproj/project.pbxproj' 2>/dev/null
  } | sort -u | while read -r f; do
      [ -f "$f" ] && shasum -a 256 "$f"
    done | shasum -a 256 | awk '{print $1}'
}

build_and_install_if_stale() {
  local force="${1:-0}"
  local current_hash
  current_hash="$(current_sources_hash)"
  local last_hash=""
  [ -f "$LAST_HASH_FILE" ] && last_hash="$(cat "$LAST_HASH_FILE")"

  if [ "$force" != "1" ] && [ -f "$APP_PATH/Info.plist" ] && [ "$current_hash" = "$last_hash" ]; then
    note "Sources unchanged since last build — skipping web build, cap sync, xcodebuild."
    return 0
  fi

  note "Building web (NEXT_PUBLIC_E2E=1, CAPACITOR_BUILD=1)…"
  NEXT_PUBLIC_E2E=1 npm run build:cap:e2e >/dev/null

  note "cap sync ios…"
  npm run cap:sync >/dev/null

  note "xcodebuild for sim ($SIM_NAME)…"
  xcodebuild \
    -project ios/App/App.xcodeproj \
    -scheme App \
    -configuration Debug \
    -sdk iphonesimulator \
    -destination "platform=iOS Simulator,name=$SIM_NAME" \
    -derivedDataPath "$DERIVED_DATA" \
    build \
    | tail -1

  if [ ! -d "$APP_PATH" ]; then
    err "App build did not produce $APP_PATH"
    exit 1
  fi

  note "Installing to sim…"
  local sim_udid
  sim_udid="$(get_sim_udid)"
  xcrun simctl install "$sim_udid" "$APP_PATH"

  echo "$current_hash" > "$LAST_HASH_FILE"
}

get_sim_udid() {
  xcrun simctl list devices available -j 2>/dev/null \
    | python3 -c "
import json, sys
data = json.load(sys.stdin)
for runtime, devices in data.get('devices', {}).items():
    for d in devices:
        if d.get('name') == '$SIM_NAME' and d.get('isAvailable', False):
            print(d['udid']); sys.exit(0)
" || true
}

ensure_sim_booted() {
  local udid
  udid="$(get_sim_udid)"
  if [ -z "$udid" ]; then
    err "No sim found named '$SIM_NAME'. Available:"
    xcrun simctl list devices available | grep -E 'iPhone' | head -10 >&2
    err "Set REBIRTH_SIM_NAME=<name> or create the sim in Xcode."
    exit 1
  fi
  local state
  state="$(xcrun simctl list devices -j | python3 -c "
import json,sys
data = json.load(sys.stdin)
for rt, devs in data.get('devices', {}).items():
    for d in devs:
        if d.get('udid') == '$udid':
            print(d.get('state', '')); sys.exit(0)
")"
  if [ "$state" != "Booted" ]; then
    note "Booting sim $udid ($SIM_NAME)…"
    xcrun simctl boot "$udid"
    open -a Simulator
  fi
}

# ── Subcommands ───────────────────────────────────────────────────────────────
cmd_doctor() {
  local fail=0
  if command -v maestro >/dev/null 2>&1; then
    local ver
    ver="$(maestro --version 2>/dev/null | head -1 || echo unknown)"
    done_ "maestro CLI present: $ver"
    if [ "$ver" != "$MAESTRO_VERSION_PIN" ]; then
      note "warning: pinned $MAESTRO_VERSION_PIN, found $ver — set MAESTRO_VERSION_PIN to override or upgrade"
    fi
  else
    err "maestro CLI not on PATH — install: curl -fsSL https://get.maestro.mobile.dev | bash"
    fail=1
  fi
  if command -v java >/dev/null 2>&1; then
    done_ "java present: $(java -version 2>&1 | head -1)"
  else
    err "java not on PATH — Maestro requires JDK 8+. brew install openjdk"
    fail=1
  fi
  if command -v xcrun >/dev/null 2>&1; then
    done_ "xcrun present"
  else
    err "xcrun missing — install Xcode Command Line Tools"
    fail=1
  fi
  local udid
  udid="$(get_sim_udid)"
  if [ -n "$udid" ]; then
    done_ "sim found: $SIM_NAME ($udid)"
  else
    err "sim '$SIM_NAME' not found. Set REBIRTH_SIM_NAME=<name> or create in Xcode."
    fail=1
  fi
  if [ -d ".maestro/flows" ]; then
    local n
    n="$(find .maestro/flows -name '*.yaml' | wc -l | tr -d ' ')"
    done_ ".maestro/flows present: $n flows"
  else
    err ".maestro/flows missing"
    fail=1
  fi
  if [ "$fail" = "1" ]; then
    err "doctor: one or more checks failed"
    exit 1
  fi
  done_ "doctor: all checks passed"
}

cmd_run() {
  local force_full="${1:-0}"
  shift || true
  require_cmd maestro "Run \`scripts/maestro-run.sh doctor\`."
  ensure_sim_booted
  build_and_install_if_stale "$force_full"
  mkdir -p "$RUN_DIR"
  note "Running flows → $RUN_DIR"
  set +e
  maestro test \
    --debug-output "$RUN_DIR" \
    --format junit \
    --output "$RUN_DIR/junit.xml" \
    "$@" \
    .maestro/flows
  local rc=$?
  set -e
  summarize "$RUN_DIR/junit.xml" "$rc"
  exit "$rc"
}

cmd_failed() {
  require_cmd maestro "Run \`scripts/maestro-run.sh doctor\`."
  local prev_junit
  prev_junit="$(find "$OUT_ROOT" -maxdepth 2 -name junit.xml 2>/dev/null | sort | tail -1)"
  if [ -z "$prev_junit" ]; then
    err "No previous junit.xml found. Run \`npm run test:maestro\` first."
    exit 1
  fi
  local failed_flows
  failed_flows="$(python3 - "$prev_junit" <<'PY'
import sys, xml.etree.ElementTree as ET
tree = ET.parse(sys.argv[1])
root = tree.getroot()
out = []
for tc in root.iter('testcase'):
    if any(child.tag in ('failure','error') for child in tc):
        name = tc.get('classname') or tc.get('name')
        if name: out.append(name)
print('\n'.join(out))
PY
)"
  if [ -z "$failed_flows" ]; then
    done_ "Last run had no failures."
    exit 0
  fi
  ensure_sim_booted
  build_and_install_if_stale 0
  mkdir -p "$RUN_DIR"
  note "Re-running failed flows: $failed_flows"
  set +e
  echo "$failed_flows" | while read -r f; do
    [ -n "$f" ] && maestro test --debug-output "$RUN_DIR" "$f"
  done
  local rc=$?
  set -e
  exit "$rc"
}

cmd_watch() {
  require_cmd maestro "Run \`scripts/maestro-run.sh doctor\`."
  if [ "${1:-}" = "" ]; then
    err "Usage: scripts/maestro-run.sh watch <flow.yaml>"
    exit 1
  fi
  ensure_sim_booted
  build_and_install_if_stale 0
  note "Watching $1 (re-runs on save). Ctrl-C to stop."
  maestro test --continuous "$1"
}

cmd_studio() {
  require_cmd maestro "Run \`scripts/maestro-run.sh doctor\`."
  ensure_sim_booted
  build_and_install_if_stale 0
  note "Launching Maestro Studio."
  maestro studio
}

cmd_tree() {
  require_cmd maestro "Run \`scripts/maestro-run.sh doctor\`."
  local route="${1:-/feed}"
  ensure_sim_booted
  build_and_install_if_stale 0
  note "Dumping a11y tree at route $route…"
  # Launch app, navigate to route via deep link (capacitor doesn't expose
  # one — fall back to bridge.evalScript navigating React Router).
  # For now: launch + dump hierarchy. Author can navigate via studio if needed.
  maestro hierarchy --output "$RUN_DIR/tree-${route//\//_}.json" || true
  done_ "tree dumped to $RUN_DIR/"
}

summarize() {
  local junit="$1"
  local rc="$2"
  if [ ! -f "$junit" ]; then
    err "No junit.xml at $junit (rc=$rc)."
    return
  fi
  python3 - "$junit" "$rc" <<'PY'
import sys, xml.etree.ElementTree as ET
tree = ET.parse(sys.argv[1])
root = tree.getroot()
total = passed = failed = 0
fails = []
for tc in root.iter('testcase'):
    total += 1
    if any(c.tag in ('failure','error') for c in tc):
        failed += 1
        fails.append(tc.get('classname') or tc.get('name') or '?')
    else:
        passed += 1
status = 'OK' if failed == 0 else 'FAIL'
print(f"\n[{status}] Maestro: {passed}/{total} passed", end='')
if fails:
    print(f", {failed} failed: {', '.join(fails[:5])}", end='')
    if len(fails) > 5:
        print(f" (+{len(fails)-5} more)", end='')
print()
PY
}

# ── Dispatch ──────────────────────────────────────────────────────────────────
SUB="${1:-run}"
shift || true

case "$SUB" in
  run)     cmd_run 0 "$@" ;;
  full)    cmd_run 1 "$@" ;;
  watch)   cmd_watch "$@" ;;
  studio)  cmd_studio ;;
  failed)  cmd_failed ;;
  tree)    cmd_tree "$@" ;;
  doctor)  cmd_doctor ;;
  *)
    err "Unknown subcommand: $SUB"
    err "Usage: scripts/maestro-run.sh [run|full|watch|studio|failed|tree|doctor] [args]"
    exit 1
    ;;
esac
