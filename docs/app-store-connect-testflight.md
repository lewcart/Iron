# Rebirth → App Store Connect (TestFlight internal testing)

Runbook for getting Rebirth into TestFlight for **internal** testers. Internal
testing needs **no Beta App Review** and no full store metadata — a valid build
+ a testing group is enough. Testers must be users on your App Store Connect
team (up to 100).

Team: `43687B2JMB` · Apple ID: `hey@lewcart.com` · Bundle: `app.rebirth`

## What's already prepped in the repo

- App icons flattened to opaque (alpha channel removed — was a hard upload blocker). Main + watch.
- All bundles report the same version (`MARKETING_VERSION` 1.0 / build 1). The two
  watch targets previously hardcoded `0.1`, which App Store Connect rejects on a
  paired upload — now they reference `$(MARKETING_VERSION)`/`$(CURRENT_PROJECT_VERSION)`.
- `ITSAppUsesNonExemptEncryption = false` added to `Info.plist` → skips the per-build
  export-compliance prompt (Rebirth uses only standard HTTPS/TLS).
- All privacy usage strings present (HealthKit, camera, photo-add, location ×3).
- `ios/App/ExportOptions.plist` + `scripts/ios-archive-upload.sh` for archive/upload.

## Step 1 — Register identifiers (developer.apple.com, one-time)

These are almost certainly **already registered** — device builds (`npm run
ios:device`) provision the same App IDs, entitlements, and the
`group.app.rebirth` App Group, so if those have been working, this is done.
Listed for completeness / if signing ever complains. In Certificates,
Identifiers & Profiles → Identifiers:

| Identifier | Capabilities to enable |
|---|---|
| `app.rebirth` | HealthKit, App Groups (`group.app.rebirth`) |
| `app.rebirth.watchkitapp` | HealthKit (watch) |
| `app.rebirth.watchkitapp.complications` | — |
| `app.rebirth.RestTimerLiveActivity` | — |
| `app.rebirth.FitspoControlExtension` | — |
| App Group `group.app.rebirth` | (create under Identifiers → App Groups) |

## Step 2 — Create the App Store Connect record (one-time)

App Store Connect → **Apps → + → New App**:
- Platform **iOS**, Name **Rebirth** (if taken, pick e.g. "Rebirth Fitness" — the
  store name is independent of the on-device name), Primary language,
  Bundle ID **`app.rebirth`**, SKU e.g. `rebirth-001`.

A build cannot be uploaded until this record exists.

## Step 3 — Build & upload

Sign into Xcode with the Apple ID on team `43687B2JMB` first. Then either:

**CLI:**
```bash
bash scripts/ios-archive-upload.sh          # build → archive → export → upload
bash scripts/ios-archive-upload.sh --archive-only   # stop before upload
```
For a non-interactive upload, save an app-specific password once
(appleid.apple.com → Sign-In & Security → App-Specific Passwords):
```bash
xcrun altool --store-password-in-keychain-item AC_PASSWORD -u hey@lewcart.com -p <app-specific-pw>
```

**Or Xcode GUI:** `npm run build:cap && npm run cap:sync`, open
`ios/App/App.xcodeproj`, select the **App** scheme + **Any iOS Device**,
Product → Archive → Distribute App → App Store Connect → Upload.

## Step 4 — TestFlight internal testing (web)

App Store Connect → your app → **TestFlight** tab:
1. Wait for the build to finish processing (~5–15 min; you'll get an email).
2. Export compliance is already answered (no prompt).
3. **Internal Testing** → create/select a group → add testers (App Store Connect
   users on your team) → enable the build for the group.
4. Testers accept the invite in the TestFlight app and install.

That's it — no app review for internal testers.

## Gotchas

- If `npm run cap:sync` warns that watchOS targets were stripped, re-add them with
  `ruby scripts/setup-watch-targets.rb` and commit the pbxproj diff before archiving.
- Bumping the version later: change `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION`
  in the Xcode project — every bundle tracks them via `$(...)` now, so they stay in sync.
- HealthKit apps need a privacy policy URL **for App Store release / external
  testing**, but **not** for internal TestFlight.
