#!/usr/bin/env ruby
# Adds RebirthWatch (watchOS App) + RebirthWatchComplications (WidgetKit
# extension) targets to ios/App/App.xcodeproj, links the local RebirthShared
# SPM package, and registers WatchConnectivityPlugin.swift on the iOS App
# target. Idempotent: safe to re-run (skips work that's already done).
#
# Run from repo root: ruby scripts/setup-watch-targets.rb

require 'xcodeproj'

PROJECT_PATH = 'ios/App/App.xcodeproj'
WATCH_TARGET_NAME = 'RebirthWatch'
COMPLICATIONS_TARGET_NAME = 'RebirthWatchComplications'
WATCH_BUNDLE_ID = 'app.rebirth.watchkitapp'
COMPLICATIONS_BUNDLE_ID = 'app.rebirth.watchkitapp.complications'
DEV_TEAM = '43687B2JMB'
WATCHOS_DEPLOYMENT_TARGET = '10.0'
SHARED_PACKAGE_PATH = '../../RebirthShared'    # relative to ios/App/

WATCH_SOURCES = [
  'ios/RebirthWatch/RebirthWatchApp.swift',
  'ios/RebirthWatch/WatchSessionStore.swift',
  'ios/RebirthWatch/ActiveWorkoutGlance.swift',
  'ios/RebirthWatch/RIRPicker.swift',
  'ios/RebirthWatch/WeightDial.swift',
  'ios/RebirthWatch/RepsDial.swift',
  'ios/RebirthWatch/CountdownRing.swift',
  'ios/RebirthWatch/WorkoutSessionManager.swift',
  'ios/RebirthWatch/SessionEndView.swift',
  'ios/RebirthWatch/SetCompletionCoordinator.swift',
  'ios/RebirthWatch/MockSnapshot.swift',
]
WATCH_INFO_PLIST = 'ios/RebirthWatch/Info.plist'
WATCH_ENTITLEMENTS = 'ios/RebirthWatch/RebirthWatch.entitlements'

COMPLICATIONS_SOURCES = [
  'ios/RebirthWatchComplications/RebirthWatchComplications.swift',
]
COMPLICATIONS_INFO_PLIST = 'ios/RebirthWatchComplications/Info.plist'
COMPLICATIONS_ENTITLEMENTS = 'ios/RebirthWatchComplications/RebirthWatchComplications.entitlements'

WATCH_LINKED_PRODUCTS = %w[RebirthAPI RebirthAppGroup RebirthKeychain RebirthModels RebirthOutbox RebirthWatchLog]
COMPLICATIONS_LINKED_PRODUCTS = %w[RebirthModels]
APP_LINKED_PRODUCTS = %w[RebirthAppGroup RebirthKeychain RebirthModels RebirthWatchLog]
APP_PLUGIN_SOURCE = 'ios/App/App/WatchConnectivityPlugin.swift'

project = Xcodeproj::Project.open(PROJECT_PATH)
app_target = project.targets.find { |t| t.name == 'App' }
abort "Couldn't find App target" unless app_target

# ----------------------------------------------------------------
# 1. Local SPM package reference (RebirthShared)
# ----------------------------------------------------------------

existing_pkg = project.root_object.package_references.find do |ref|
  ref.respond_to?(:relative_path) && ref.relative_path == SHARED_PACKAGE_PATH
end

if existing_pkg
  puts "✓ RebirthShared local package already referenced"
  shared_pkg = existing_pkg
else
  shared_pkg = project.new(Xcodeproj::Project::Object::XCLocalSwiftPackageReference)
  shared_pkg.relative_path = SHARED_PACKAGE_PATH
  project.root_object.package_references << shared_pkg
  puts "+ Added RebirthShared local SPM reference"
end

def link_package_products(target, product_names, package_ref)
  existing = target.package_product_dependencies.map(&:product_name)
  product_names.each do |product|
    next if existing.include?(product)
    dep = target.project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
    dep.product_name = product
    dep.package = package_ref
    target.package_product_dependencies << dep

    # Build file with productRef (NOT fileRef — xcodeproj's add_file_reference
    # rejects XCSwiftPackageProductDependency, but the underlying PBXBuildFile
    # accepts a productRef pointing at one).
    build_file = target.project.new(Xcodeproj::Project::Object::PBXBuildFile)
    build_file.product_ref = dep
    target.frameworks_build_phase.files << build_file
    puts "  + Linked #{product} to #{target.name}"
  end
end

# ----------------------------------------------------------------
# 2. Helper — create or fetch a target
# ----------------------------------------------------------------

def ensure_group(project, group_name, path)
  existing = project.main_group.find_subpath(group_name, false)
  return existing if existing
  group = project.main_group.new_group(group_name, path)
  group
end

def ensure_file_in_group(group, project_relative_path)
  basename = File.basename(project_relative_path)
  existing = group.files.find { |f| f.path == basename }
  return existing if existing
  ref = group.new_file(project_relative_path)
  ref.path = basename
  ref
end

# Watch app group lives at ios/RebirthWatch (relative to project root, i.e. one
# level up from ios/App/). xcodeproj groups paths are relative to the .xcodeproj
# parent.
watch_group = project.main_group.find_subpath('RebirthWatch', true)
watch_group.set_source_tree('SOURCE_ROOT')
watch_group.set_path('../RebirthWatch')

complications_group = project.main_group.find_subpath('RebirthWatchComplications', true)
complications_group.set_source_tree('SOURCE_ROOT')
complications_group.set_path('../RebirthWatchComplications')

# ----------------------------------------------------------------
# 3. Watch app target
# ----------------------------------------------------------------

watch_target = project.targets.find { |t| t.name == WATCH_TARGET_NAME }
if watch_target
  puts "✓ #{WATCH_TARGET_NAME} target already exists"
else
  watch_target = project.new_target(:application, WATCH_TARGET_NAME, :watchos, WATCHOS_DEPLOYMENT_TARGET)
  puts "+ Created #{WATCH_TARGET_NAME} target"
end

# Build settings
watch_target.build_configurations.each do |config|
  config.build_settings.merge!(
    'PRODUCT_BUNDLE_IDENTIFIER' => WATCH_BUNDLE_ID,
    'PRODUCT_NAME' => WATCH_TARGET_NAME,
    'INFOPLIST_FILE' => "../RebirthWatch/Info.plist",
    'CODE_SIGN_ENTITLEMENTS' => "../RebirthWatch/RebirthWatch.entitlements",
    'CODE_SIGN_STYLE' => 'Automatic',
    'DEVELOPMENT_TEAM' => DEV_TEAM,
    'WATCHOS_DEPLOYMENT_TARGET' => WATCHOS_DEPLOYMENT_TARGET,
    'SDKROOT' => 'watchos',
    'TARGETED_DEVICE_FAMILY' => '4',                 # 4 = Apple Watch
    'SUPPORTS_MACCATALYST' => 'NO',
    'SWIFT_VERSION' => '5.0',
    'CURRENT_PROJECT_VERSION' => '1',
    'MARKETING_VERSION' => '1.0',
    'GENERATE_INFOPLIST_FILE' => 'NO',
    'ENABLE_PREVIEWS' => 'YES',
    'SKIP_INSTALL' => 'NO',
    'ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES' => 'YES',
  )
end

# Source files
WATCH_SOURCES.each do |src|
  ref = ensure_file_in_group(watch_group, "../RebirthWatch/#{File.basename(src)}")
  unless watch_target.source_build_phase.files_references.include?(ref)
    watch_target.add_file_references([ref])
    puts "  + Added #{File.basename(src)} to #{WATCH_TARGET_NAME}"
  end
end

# Link RebirthShared products
link_package_products(watch_target, WATCH_LINKED_PRODUCTS, shared_pkg)

# ----------------------------------------------------------------
# 4. Complications widget extension target
# ----------------------------------------------------------------

complications_target = project.targets.find { |t| t.name == COMPLICATIONS_TARGET_NAME }
if complications_target
  puts "✓ #{COMPLICATIONS_TARGET_NAME} target already exists"
else
  complications_target = project.new_target(:app_extension, COMPLICATIONS_TARGET_NAME, :watchos, WATCHOS_DEPLOYMENT_TARGET)
  puts "+ Created #{COMPLICATIONS_TARGET_NAME} target"
end

complications_target.build_configurations.each do |config|
  config.build_settings.merge!(
    'PRODUCT_BUNDLE_IDENTIFIER' => COMPLICATIONS_BUNDLE_ID,
    'PRODUCT_NAME' => COMPLICATIONS_TARGET_NAME,
    'INFOPLIST_FILE' => "../RebirthWatchComplications/Info.plist",
    'CODE_SIGN_ENTITLEMENTS' => "../RebirthWatchComplications/RebirthWatchComplications.entitlements",
    'CODE_SIGN_STYLE' => 'Automatic',
    'DEVELOPMENT_TEAM' => DEV_TEAM,
    'WATCHOS_DEPLOYMENT_TARGET' => WATCHOS_DEPLOYMENT_TARGET,
    'SDKROOT' => 'watchos',
    'TARGETED_DEVICE_FAMILY' => '4',
    'SUPPORTS_MACCATALYST' => 'NO',
    'SWIFT_VERSION' => '5.0',
    'CURRENT_PROJECT_VERSION' => '1',
    'MARKETING_VERSION' => '1.0',
    'GENERATE_INFOPLIST_FILE' => 'NO',
    'SKIP_INSTALL' => 'YES',
    'ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES' => 'NO',
  )
end

COMPLICATIONS_SOURCES.each do |src|
  ref = ensure_file_in_group(complications_group, "../RebirthWatchComplications/#{File.basename(src)}")
  unless complications_target.source_build_phase.files_references.include?(ref)
    complications_target.add_file_references([ref])
    puts "  + Added #{File.basename(src)} to #{COMPLICATIONS_TARGET_NAME}"
  end
end

link_package_products(complications_target, COMPLICATIONS_LINKED_PRODUCTS, shared_pkg)

# ----------------------------------------------------------------
# 5. Embed complications appex INTO the watch app
# ----------------------------------------------------------------

embed_phase = watch_target.copy_files_build_phases.find { |p| p.name == 'Embed Foundation Extensions' }
unless embed_phase
  embed_phase = watch_target.new_copy_files_build_phase('Embed Foundation Extensions')
  embed_phase.dst_subfolder_spec = '13'   # Plug-Ins / Extensions
  puts "+ Added Embed Foundation Extensions phase to #{WATCH_TARGET_NAME}"
end

complications_product = complications_target.product_reference
already_embedded = embed_phase.files_references.include?(complications_product)
unless already_embedded
  build_file = embed_phase.add_file_reference(complications_product)
  build_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
  puts "  + Embedded #{COMPLICATIONS_TARGET_NAME}.appex in #{WATCH_TARGET_NAME}"
end

# Make watch app depend on complications target (build order)
unless watch_target.dependencies.any? { |d| d.target == complications_target }
  watch_target.add_dependency(complications_target)
  puts "  + Added build dependency: #{WATCH_TARGET_NAME} -> #{COMPLICATIONS_TARGET_NAME}"
end

# ----------------------------------------------------------------
# 6. WatchConnectivityPlugin.swift on the iOS App target
# ----------------------------------------------------------------

app_group = project.main_group.find_subpath('App', false)
abort "Could not find App group" unless app_group

plugin_basename = File.basename(APP_PLUGIN_SOURCE)
plugin_ref = app_group.files.find { |f| f.path == plugin_basename }
plugin_ref ||= app_group.new_file(plugin_basename)

unless app_target.source_build_phase.files_references.include?(plugin_ref)
  app_target.add_file_references([plugin_ref])
  puts "+ Added WatchConnectivityPlugin.swift to App target"
else
  puts "✓ WatchConnectivityPlugin.swift already on App target"
end

# Link RebirthShared products to the iOS App target so the plugin can import them
link_package_products(app_target, APP_LINKED_PRODUCTS, shared_pkg)

# ----------------------------------------------------------------
# 7. Save
# ----------------------------------------------------------------

project.save
puts "\nproject.pbxproj saved."
puts "Targets now: #{project.targets.map(&:name).join(', ')}"
