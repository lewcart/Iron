#!/usr/bin/env bash
#
# Build, archive, and upload Rebirth to App Store Connect (TestFlight).
#
# PREREQUISITES (one-time, done in App Store Connect — see docs/app-store-connect-testflight.md):
#   1. An app record for bundle id `app.rebirth` must already exist in App Store Connect.
#   2. You must be signed into Xcode with an Apple ID on team 43687B2JMB.
#   3. For a non-interactive upload, create an app-specific password or an
#      App Store Connect API key (see notes at bottom).
#
# Usage:
#   bash scripts/ios-archive-upload.sh            # archive + upload
#   bash scripts/ios-archive-upload.sh --archive-only   # stop after archive (no upload)
#
set -euo pipefail
cd "$(dirname "$0")/.."

ARCHIVE_PATH="build/Rebirth.xcarchive"
EXPORT_DIR="build/export"
WORKSPACE_PROJ="ios/App/App.xcodeproj"
SCHEME="App"

echo "==> [1/5] Building web assets (static export)"
npm run build:cap

echo "==> [2/5] Syncing to iOS (+ post-sync watch-target check + HealthKit gen)"
npm run cap:sync

echo "==> [3/5] Archiving (Release, generic iOS device)"
rm -rf "$ARCHIVE_PATH"
xcodebuild archive \
  -project "$WORKSPACE_PROJ" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE_PATH" \
  -allowProvisioningUpdates

if [[ "${1:-}" == "--archive-only" ]]; then
  echo "==> Archive complete: $ARCHIVE_PATH (skipping export/upload)"
  exit 0
fi

echo "==> [4/5] Exporting signed .ipa"
rm -rf "$EXPORT_DIR"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportOptionsPlist ios/App/ExportOptions.plist \
  -exportPath "$EXPORT_DIR" \
  -allowProvisioningUpdates

echo "==> [5/5] Uploading to App Store Connect"
IPA="$(find "$EXPORT_DIR" -name '*.ipa' | head -1)"
echo "    ipa: $IPA"
# Requires an app-specific password stored in keychain, OR an API key.
# Option A (app-specific password saved as a keychain item named AC_PASSWORD):
#   xcrun altool --store-password-in-keychain-item AC_PASSWORD -u "hey@lewcart.com" -p "<app-specific-pw>"
xcrun altool --upload-app -f "$IPA" -t ios \
  -u "hey@lewcart.com" -p "@keychain:AC_PASSWORD"

echo "==> Done. Build will appear in App Store Connect > TestFlight in ~5-15 min after processing."
echo "    Then assign it to your Internal Testing group."
