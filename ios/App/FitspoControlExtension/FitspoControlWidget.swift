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
struct FitspoControlWidget: ControlWidget {
    static let kind = "app.rebirth.FitspoControlWidget"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: FitspoBurstIntent()) {
                Label("Fitspo Burst", systemImage: "bolt.heart.fill")
            }
        }
        .displayName("Fitspo Burst")
        .description("One-tap burst capture in Rebirth.")
    }
}
