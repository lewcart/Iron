#!/usr/bin/env node
/**
 * Post-`cap sync ios` patches that must survive every sync run.
 *
 * 1. Bump `ios/App/CapApp-SPM/Package.swift` swift-tools-version 5.9 → 6.0 so
 *    `.iOS(.v18)` resolves. Capacitor CLI writes 5.9 regardless of our config.
 *
 * 2. Add our local Swift plugins (RestTimerPlugin, InspoBurstPlugin) to
 *    `ios/App/App/capacitor.config.json` `packageClassList`. Capacitor 8 only
 *    auto-registers plugins discovered via SPM dependencies; loose .swift
 *    files in the App target are not discovered. Adding the class names here
 *    makes Capacitor instantiate them at bridge init (before JS queries the
 *    bridge for method signatures), so `registerPlugin('RestTimer', …)` on
 *    the JS side resolves to the native implementation instead of caching
 *    "plugin is not implemented on ios".
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
const LOCAL_PLUGINS = ['RestTimerPlugin', 'InspoBurstPlugin'];
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
