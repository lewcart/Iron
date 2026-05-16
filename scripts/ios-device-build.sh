#!/usr/bin/env bash
# Build + install Rebirth on a physical iPhone using the App Store Connect API
# for signing. No manual Xcode clicking, no entitlement stripping — provided:
#
#   • The App Group `group.app.rebirth` is registered on the Developer Portal
#     and attached to all three bundle IDs (app.rebirth, .FitspoControlExtension,
#     .RestTimerLiveActivity).
#   • The ASC API key sits at ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8
#
# Usage:
#   scripts/ios-device-build.sh [device-name-or-udid]
#
# If no device is given, the first connected iOS device is used.

set -euo pipefail

# ── Signing + API creds ───────────────────────────────────────────────────────
TEAM="${REBIRTH_IOS_TEAM:-43687B2JMB}"
KEY_ID="${REBIRTH_ASC_KEY_ID:-YUK3TAPCB7}"
ISSUER_ID="${REBIRTH_ASC_ISSUER_ID:-ed041b7c-9d18-40e6-8379-60795ce0e8ca}"
KEY_PATH="${REBIRTH_ASC_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8}"

if [ ! -f "$KEY_PATH" ]; then
  echo "ASC API key not found at: $KEY_PATH" >&2
  echo "Put your .p8 file there or export REBIRTH_ASC_KEY_PATH." >&2
  exit 1
fi

# ── Pick a device ─────────────────────────────────────────────────────────────
DEVICE_ARG="${1:-}"
if [ -n "$DEVICE_ARG" ]; then
  DEVICE_ID="$DEVICE_ARG"
else
  # Extract a UUID from a line that mentions iPhone + connected.
  DEVICE_ID=$(xcrun devicectl list devices 2>/dev/null \
    | grep -E 'iPhone.*connected|connected.*iPhone' \
    | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' \
    | head -1)
  if [ -z "$DEVICE_ID" ]; then
    echo "No connected iOS device. Plug one in or pass a device name/UDID." >&2
    exit 1
  fi
fi
echo "▸ Using device: $DEVICE_ID"

# ── Build web ─────────────────────────────────────────────────────────────────
echo "▸ next build (capacitor mode)…"
npm run build:cap >/dev/null

echo "▸ cap sync ios…"
npm run cap:sync >/dev/null

# ── Build + sign ──────────────────────────────────────────────────────────────
echo "▸ xcodebuild…"
# No `-sdk iphoneos` — that flag globally overrides per-target SDKROOT, so the
# embedded RebirthWatch (SDKROOT=watchos) target gets compiled against iOS and
# fails to find WatchKit. -destination is enough to drive the iOS app target;
# xcodebuild resolves the watch dep against watchOS automatically.
xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Debug \
  -destination "platform=iOS,id=$DEVICE_ID" \
  -derivedDataPath build/ios-device \
  -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration \
  -authenticationKeyPath "$KEY_PATH" \
  -authenticationKeyID "$KEY_ID" \
  -authenticationKeyIssuerID "$ISSUER_ID" \
  -skipPackagePluginValidation \
  -skipMacroValidation \
  DEVELOPMENT_TEAM="$TEAM" \
  CODE_SIGN_STYLE=Automatic \
  build \
  | tail -1

# ── Install + launch ──────────────────────────────────────────────────────────
# devicectl emits a harmless "Failed to load provisioning paramter list"
# warning before EVERY command (Apple bug — `manage create may support a
# reduced set of arguments`). Filter that out and surface only the real
# success/error lines.
APP_PATH="build/ios-device/Build/Products/Debug-iphoneos/App.app"
echo "▸ install…"
xcrun devicectl device install app --device "$DEVICE_ID" "$APP_PATH" 2>&1 \
  | grep -vE "Failed to load provisioning paramter list|may support a reduced" \
  | grep -E "bundleID|App installed|error|Error" | head -3

sleep 1
echo "▸ launch…"
# --terminate-existing forces a fresh launch even if a previous run left the
# app in a stuck/crashed state. Without it, devicectl returns FBSOpenApplication
# error 1 ("failed to launch") whenever the OS is still holding a stale instance.
xcrun devicectl device process launch --device "$DEVICE_ID" --terminate-existing app.rebirth 2>&1 \
  | grep -vE "Failed to load provisioning paramter list|may support a reduced" \
  | grep -E "Launched|error|Error" | head -2

echo "✓ Done."
