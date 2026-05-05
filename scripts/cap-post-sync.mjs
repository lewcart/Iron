#!/usr/bin/env node
/**
 * Post-`cap sync ios` patches that must survive every sync run.
 *
 * 1. Bump `ios/App/CapApp-SPM/Package.swift` swift-tools-version 5.9 → 6.0 so
 *    `.iOS(.v18)` resolves. Capacitor CLI writes 5.9 regardless of our config.
 *
 * 2. Add our local Swift plugins (RestTimerPlugin, InspoBurstPlugin,
 *    HealthKitPlugin, GeofencePlugin, PersonSegmentationPlugin) to
 *    `ios/App/App/capacitor.config.json` `packageClassList`. Capacitor 8
 *    only auto-registers plugins discovered via SPM dependencies; loose
 *    .swift files in the App target are not discovered. Adding the class
 *    names here makes Capacitor instantiate them at bridge init (before
 *    JS queries the bridge for method signatures), so
 *    `registerPlugin('HealthKit', …)` on the JS side resolves to the
 *    native implementation instead of caching "plugin is not implemented on ios".
 *
 *    NOTE: this script alone is NOT sufficient to register a brand-new
 *    plugin. The Swift file ALSO needs 4 entries in
 *    `ios/App/App.xcodeproj/project.pbxproj` (PBXBuildFile, PBXFileReference,
 *    group child, Sources build phase). Add a new plugin via Xcode
 *    "Add Files to App" once, commit the pbxproj diff, then this script
 *    keeps the packageClassList in sync across future `cap sync` runs.
 */
import { readFileSync, writeFileSync } from 'node:fs';

// --- (1) Swift tools version ---
const swiftPkgPath = 'ios/App/CapApp-SPM/Package.swift';
const swiftPkg = readFileSync(swiftPkgPath, 'utf8');
if (swiftPkg.includes('swift-tools-version: 5.9')) {
  writeFileSync(swiftPkgPath, swiftPkg.replace('swift-tools-version: 5.9', 'swift-tools-version: 6.0'));
  console.log('  patched CapApp-SPM/Package.swift → swift-tools-version 6.0');
}

// --- (2) packageClassList ---
const configPath = 'ios/App/App/capacitor.config.json';
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const LOCAL_PLUGINS = ['RestTimerPlugin', 'InspoBurstPlugin', 'HealthKitPlugin', 'GeofencePlugin', 'PersonSegmentationPlugin', 'WatchConnectivityPlugin'];
config.packageClassList = Array.isArray(config.packageClassList) ? config.packageClassList : [];
let added = 0;
for (const name of LOCAL_PLUGINS) {
  if (!config.packageClassList.includes(name)) {
    config.packageClassList.push(name);
    added += 1;
  }
}
if (added > 0) {
  writeFileSync(configPath, JSON.stringify(config, null, '\t') + '\n');
  console.log(`  patched capacitor.config.json — added ${added} local plugin(s) to packageClassList`);
}

// --- (3) Verify watchOS target survival ---
// Capacitor regenerates project.pbxproj on every sync. The watch app and
// complications targets are added once via Xcode UI; this check fails loudly
// if they get stripped. Sentinel strings come from the target names in the
// pbxproj — verify with `grep "RebirthWatch" ios/App/App.xcodeproj/project.pbxproj`.
const pbxprojPath = 'ios/App/App.xcodeproj/project.pbxproj';
let watchOSWarnings = 0;
try {
  const pbx = readFileSync(pbxprojPath, 'utf8');
  const watchTargetMissing = !pbx.includes('RebirthWatch');
  const complicationsTargetMissing = !pbx.includes('RebirthWatchComplications');
  const sharedPackageMissing = !pbx.includes('RebirthShared');
  if (watchTargetMissing) {
    console.warn('  [warn] cap-post-sync: RebirthWatch target not found in project.pbxproj');
    watchOSWarnings += 1;
  }
  if (complicationsTargetMissing) {
    console.warn('  [warn] cap-post-sync: RebirthWatchComplications target not found in project.pbxproj');
    watchOSWarnings += 1;
  }
  if (sharedPackageMissing) {
    console.warn('  [warn] cap-post-sync: RebirthShared package reference not found in project.pbxproj');
    watchOSWarnings += 1;
  }
  if (watchOSWarnings > 0) {
    console.warn('  [warn] Re-add via Xcode (see docs/watch-day1-xcode-setup.md) and commit the pbxproj diff.');
  }
} catch (err) {
  // pbxproj might not exist yet on first sync of a fresh checkout.
  if (err.code !== 'ENOENT') throw err;
}
