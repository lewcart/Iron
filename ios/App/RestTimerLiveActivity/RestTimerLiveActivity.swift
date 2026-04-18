import ActivityKit
import SwiftUI
import WidgetKit

// Extension target deployment target is iOS 18.0, so no @available guards needed.

/// Entry point for the RestTimerLiveActivity widget bundle.
@main
struct RestTimerLiveActivityBundle: WidgetBundle {
    var body: some Widget {
        RestTimerLiveActivity()
    }
}

// Trans-flag blue, matches the app's primary accent.
private enum Palette {
    static let accent: Color = Color(.sRGB, red: 91.0 / 255.0, green: 206.0 / 255.0, blue: 250.0 / 255.0, opacity: 1.0)
}

/// The Live Activity widget. One configuration drives both the Lock Screen
/// banner and every Dynamic Island region.
struct RestTimerLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RestTimerAttributes.self) { context in
            // Lock Screen / banner presentation.
            LockScreenView(context: context)
                .activityBackgroundTint(Color.black.opacity(0.6))
                .activitySystemActionForegroundColor(Palette.accent)

        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded regions (when the user long-presses the island).
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("REST")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Palette.accent)
                        Text(context.attributes.exerciseName)
                            .font(.callout.weight(.semibold))
                            .lineLimit(1)
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    countdownLabel(endDate: context.state.endDate)
                        .font(.system(size: 28, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(Palette.accent)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text("Set \(context.attributes.setNumber) complete")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text("Tap to open")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            } compactLeading: {
                Image(systemName: "timer")
                    .foregroundStyle(Palette.accent)
            } compactTrailing: {
                countdownLabel(endDate: context.state.endDate)
                    .monospacedDigit()
                    .foregroundStyle(Palette.accent)
                    .frame(maxWidth: 56)
            } minimal: {
                Image(systemName: "timer")
                    .foregroundStyle(Palette.accent)
            }
            .widgetURL(URL(string: "rebirth://workout"))
            .keylineTint(Palette.accent)
        }
    }

    /// Self-updating countdown — the system refreshes the frame, not us.
    @ViewBuilder
    private func countdownLabel(endDate: Date) -> Text {
        // `timerInterval:countsDown:` renders `mm:ss` style text and stops at
        // endDate automatically. `now` as the start ensures the initial frame
        // reflects "time remaining" immediately.
        Text(timerInterval: Date()...endDate, countsDown: true)
    }
}

/// Lock Screen / banner layout.
private struct LockScreenView: View {
    let context: ActivityViewContext<RestTimerAttributes>

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            // Left — exercise + set number + label
            VStack(alignment: .leading, spacing: 4) {
                Text("REST")
                    .font(.caption.weight(.bold))
                    .tracking(1.4)
                    .foregroundStyle(Palette.accent)
                Text(context.attributes.exerciseName)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Text("Set \(context.attributes.setNumber) complete")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.7))
            }

            Spacer(minLength: 8)

            // Right — big countdown.
            VStack(alignment: .trailing, spacing: 2) {
                Text(timerInterval: Date()...context.state.endDate, countsDown: true)
                    .font(.system(size: 40, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(Palette.accent)
                    .multilineTextAlignment(.trailing)
                Text("remaining")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.6))
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
    }
}
