// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "RebirthShared",
    platforms: [
        .iOS(.v15),    // matches the App target's IPHONEOS_DEPLOYMENT_TARGET
        .watchOS(.v10),
        .macOS(.v13),  // for `swift build` on dev machine
    ],
    products: [
        .library(name: "RebirthModels", targets: ["RebirthModels"]),
        .library(name: "RebirthAPI", targets: ["RebirthAPI"]),
        .library(name: "RebirthKeychain", targets: ["RebirthKeychain"]),
        .library(name: "RebirthAppGroup", targets: ["RebirthAppGroup"]),
        .library(name: "RebirthOutbox", targets: ["RebirthOutbox"]),
        .library(name: "RebirthWatchLog", targets: ["RebirthWatchLog"]),
    ],
    targets: [
        .target(name: "RebirthModels"),
        .target(
            name: "RebirthAPI",
            dependencies: ["RebirthModels", "RebirthKeychain", "RebirthWatchLog"]
        ),
        .target(name: "RebirthKeychain"),
        .target(
            name: "RebirthAppGroup",
            dependencies: ["RebirthModels"]
        ),
        .target(
            name: "RebirthOutbox",
            dependencies: ["RebirthModels", "RebirthAppGroup", "RebirthWatchLog"]
        ),
        .target(name: "RebirthWatchLog"),

        .testTarget(name: "RebirthModelsTests", dependencies: ["RebirthModels"]),
        .testTarget(name: "RebirthOutboxTests", dependencies: ["RebirthOutbox"]),
    ]
)
