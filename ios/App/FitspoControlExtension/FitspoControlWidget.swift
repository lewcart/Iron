import AppIntents
import SwiftUI
import WidgetKit

// Extension target deployment target is iOS 18.0, so no @available guards needed here.

/// Entry point for the FitspoControlExtension widget bundle.
@main
struct FitspoControlBundle: WidgetBundle {
    var body: some Widget {
        FitspoControlWidget()
    }
}

/// iOS 18 Lock Screen / Control Centre control that triggers a fitspo burst
/// in the Rebirth app with a single tap.
///
/// iOS 18 extensions can't use `openAppWhenRun` on AppIntents, so we open
/// the app via a custom URL scheme (`rebirth://burst`). AppDelegate picks
/// up the URL, sets the shared-UserDefaults flag, and InspoBurstPlugin
/// fires the JS event as usual.
struct FitspoControlWidget: ControlWidget {
    static let kind = "app.rebirth.FitspoControlWidget"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: OpenURLIntent(URL(string: "rebirth://burst")!)) {
                Label("Fitspo Burst", systemImage: "bolt.heart.fill")
            }
        }
        .displayName("Fitspo Burst")
        .description("One-tap burst capture in Rebirth.")
    }
}
