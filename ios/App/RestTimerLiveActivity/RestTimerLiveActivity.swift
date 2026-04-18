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

// Trans-flag blue, matches the app's primary accent. Red is used when the
// rest period has elapsed and we're counting up in "keep running" mode.
private enum Palette {
    static let accent: Color = Color(.sRGB, red: 91.0 / 255.0, green: 206.0 / 255.0, blue: 250.0 / 255.0, opacity: 1.0)
    static let overtime: Color = Color(.sRGB, red: 239.0 / 255.0, green: 68.0 / 255.0, blue: 68.0 / 255.0, opacity: 1.0)
}

/// The Live Activity widget. One configuration drives both the Lock Screen
/// banner and every Dynamic Island region.
struct RestTimerLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RestTimerAttributes.self) { context in
            // Lock Screen / banner presentation.
            LockScreenView(context: context)
                .activityBackgroundTint(Color.black.opacity(0.6))
                .activitySystemActionForegroundColor(tint(for: context.state))

        } dynamicIsland: { context in
            let state = context.state
            let activeColor = tint(for: state)
            return DynamicIsland {
                // Expanded regions (when the user long-presses the island).
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(state.overtimeStart == nil ? "REST" : "OVERTIME")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(activeColor)
                        Text(context.attributes.exerciseName)
                            .font(.callout.weight(.semibold))
                            .lineLimit(1)
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    timerLabel(state: state)
                        .font(.system(size: 28, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(activeColor)
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
                    .foregroundStyle(activeColor)
            } compactTrailing: {
                timerLabel(state: state)
                    .monospacedDigit()
                    .foregroundStyle(activeColor)
                    .frame(maxWidth: 64)
            } minimal: {
                Image(systemName: "timer")
                    .foregroundStyle(activeColor)
            }
            .widgetURL(URL(string: "rebirth://workout"))
            .keylineTint(activeColor)
        }
    }

    /// Countdown while resting, count-up once overtime begins. Both forms are
    /// self-updating via `Text(timerInterval:)` — the system renders frames
    /// without us pushing updates.
    private func timerLabel(state: RestTimerAttributes.ContentState) -> Text {
        if let start = state.overtimeStart {
            // Count UP from the moment rest expired.
            return Text("+") + Text(timerInterval: start...Date.distantFuture, countsDown: false)
        }
        // Standard countdown to endDate.
        return Text(timerInterval: Date()...state.endDate, countsDown: true)
    }

    private func tint(for state: RestTimerAttributes.ContentState) -> Color {
        state.overtimeStart == nil ? Palette.accent : Palette.overtime
    }
}

/// Lock Screen / banner layout.
private struct LockScreenView: View {
    let context: ActivityViewContext<RestTimerAttributes>

    private var isOvertime: Bool { context.state.overtimeStart != nil }
    private var tint: Color { isOvertime ? Palette.overtime : Palette.accent }

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            // Left — exercise + set number + label
            VStack(alignment: .leading, spacing: 4) {
                Text(isOvertime ? "OVERTIME" : "REST")
                    .font(.caption.weight(.bold))
                    .tracking(1.4)
                    .foregroundStyle(tint)
                Text(context.attributes.exerciseName)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Text("Set \(context.attributes.setNumber) complete")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.7))
            }

            Spacer(minLength: 8)

            // Right — big countdown / count-up.
            VStack(alignment: .trailing, spacing: 2) {
                Group {
                    if let start = context.state.overtimeStart {
                        Text("+") + Text(timerInterval: start...Date.distantFuture, countsDown: false)
                    } else {
                        Text(timerInterval: Date()...context.state.endDate, countsDown: true)
                    }
                }
                .font(.system(size: 40, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(tint)
                .multilineTextAlignment(.trailing)
                Text(isOvertime ? "past rest" : "remaining")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.6))
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
    }
}
