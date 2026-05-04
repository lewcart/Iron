# Day 1 — Xcode UI setup (one-time)

This is the manual step that scripts can't safely automate. It takes ~10 min
the first time, then `cap-post-sync.mjs` warns if anything goes missing on
later `cap:sync` runs.

Open `ios/App/App.xcworkspace` in Xcode (NOT `App.xcodeproj` — the watch
target needs the workspace so the local SPM package resolves).

## 1. Add `RebirthShared` as a local Swift package

1. In Xcode, **File → Add Package Dependencies…** → **Add Local…**
2. Navigate to the repo root, select the `RebirthShared/` folder, click **Add Package**.
3. Add the package to the **App** target (the iOS app — for the
   `WatchConnectivityPlugin.swift` to import `RebirthAppGroup`, `RebirthModels`).
4. Targets to link from RebirthShared on the **App** target:
   - `RebirthAppGroup`
   - `RebirthModels`
   - `RebirthWatchLog`

## 2. Add a Watch App target

1. **File → New → Target…** → choose **watchOS → App** → Next.
2. Product Name: `RebirthWatch`
3. Bundle Identifier: `app.rebirth.watchkitapp` (Xcode may render this with the team prefix; that's fine).
4. Interface: **SwiftUI**, Language: **Swift**.
5. Set the deployment target to **watchOS 10.0**.
6. Finish — Xcode creates the target with default sources. Delete those
   defaults (`ContentView.swift`, `RebirthWatchApp.swift` placeholder, the
   asset catalog if you want — but keep `Assets.xcassets` for app icons later).

7. **Move our pre-made files into the target:**
   - In Finder, the existing folders are at `ios/RebirthWatch/`. Drag
     `RebirthWatchApp.swift` and `WatchSessionStore.swift` into the
     `RebirthWatch` target folder in Xcode (use **Create folder references**,
     not groups).
   - Use the existing `Info.plist` and `RebirthWatch.entitlements` from
     `ios/RebirthWatch/`. In the watch target's **Build Settings**:
     - `INFOPLIST_FILE` → `ios/RebirthWatch/Info.plist`
     - `CODE_SIGN_ENTITLEMENTS` → `ios/RebirthWatch/RebirthWatch.entitlements`

8. Add the Capabilities the entitlements expect:
   - **Signing & Capabilities** → **+ Capability** → **HealthKit**
   - **+ Capability** → **App Groups** → tick `group.app.rebirth`
   - **+ Capability** → **Keychain Sharing** → add `group.app.rebirth`

9. Link RebirthShared modules to the watch target:
   - Watch target → **General → Frameworks, Libraries, and Embedded Content** → **+**
   - Add: `RebirthAPI`, `RebirthAppGroup`, `RebirthKeychain`, `RebirthModels`, `RebirthOutbox`, `RebirthWatchLog`.

## 3. Add a Complications WidgetKit extension

1. **File → New → Target…** → **watchOS → Widget Extension** → Next.
2. Product Name: `RebirthWatchComplications`
3. Bundle Identifier: `app.rebirth.watchkitapp.complications`
4. Embed in: `RebirthWatch` (the watch app).
5. Tick **Include Configuration Intent** = NO (we use `StaticConfiguration` for v1).
6. Replace the default sources with our pre-made files in `ios/RebirthWatchComplications/`:
   - `RebirthWatchComplications.swift`
   - `Info.plist`
   - `RebirthWatchComplications.entitlements`
7. **+ Capability → App Groups** → tick `group.app.rebirth`.
8. Link `RebirthModels` from RebirthShared.

## 4. Add `WatchConnectivityPlugin.swift` to the iOS App target

We already created `ios/App/App/WatchConnectivityPlugin.swift`. Capacitor
plugins discovered as loose `.swift` files need 4 entries in `project.pbxproj`
that only Xcode knows how to add cleanly:

1. In Xcode's project navigator, right-click the **App** group under
   `App.xcodeproj` → **Add Files to "App"…**
2. Select `ios/App/App/WatchConnectivityPlugin.swift`.
3. Tick **App** target only. Click **Add**.

The `cap-post-sync.mjs` script already includes `WatchConnectivityPlugin` in
its `LOCAL_PLUGINS` list, so the next `npm run cap:sync` will register it in
`capacitor.config.json` automatically. Nothing more to do JS-side until Day 2.

## 5. Build to verify

1. Select the `RebirthWatch` scheme + a paired Watch simulator (e.g.,
   "iPhone 15 Pro + Apple Watch Series 9 (45mm)").
2. **⌘B** to build. You should see "Day 1 skeleton" + "no exercises yet"
   on the watch face (because no snapshot has been pushed yet).
3. **⌘R** to run if you want to confirm WC activation works (logs will
   appear in Xcode's console: "RebirthWatch launched").

## 6. Commit

The pbxproj changes from the steps above need to land in git so future
`cap:sync` runs don't strip the targets. Commit:

```bash
git add ios/App/App.xcodeproj/project.pbxproj
git add ios/RebirthWatch ios/RebirthWatchComplications
git commit -m "ios: add RebirthWatch + RebirthWatchComplications targets"
```

After this commit, `npm run cap:sync` should print no warnings about
missing watch targets. If it does, re-run step 4 and commit again.

## What's NOT in Day 1

- Real WC snapshot push from `src/app/workout/page.tsx` (Day 2).
- Set logging API write (Day 3).
- Rest timer (Day 6).
- HKLiveWorkoutBuilder (Day 7-8).
- Real complications timelines (Day 9).
