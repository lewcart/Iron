import SwiftUI
import WatchKit
import RebirthModels

/// Snapshot-driven rest timer view (post-/autoplan rework). Reads
/// `RestTimerHint` from the active workout snapshot — phone is the only
/// writer. The watch never owns timer state; it just renders against
/// `endAtMs` (phone-authored absolute epoch millisecond).
/// `TimelineView(.periodic)` re-evaluates each tick. Both surfaces compute
/// remaining locally against the same phone-authored absolute, so clock
/// skew between watch and phone doesn't corrupt the math (each device
/// uses its own `Date()` to compute "remaining"; the answer is the same
/// because the anchor is absolute).
///
/// User actions are remote-control only — Skip / Done and +30s send WC
/// messages to the phone via the closure callbacks. The phone applies the
/// change and pushes a fresh snapshot; this view re-renders from the new
/// hint. (See SetCompletionCoordinator.sendStopRest / sendExtendRest.)
struct RestTimerView: View {
    let hint: RestTimerHint
    /// Skip (countdown) / Done (overtime). Both send `stopRest` to phone.
    let onSkip: () -> Void
    /// +30s — sends `extendRest` to phone.
    let onExtend30: () -> Void

    @State private var firedTenSecondHaptic = false
    @State private var firedThreeSecondHaptic = false
    @State private var firedZeroCrossHaptic = false
    @State private var lastSetUuid: String = ""

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.25)) { ctx in
            let nowMs = Int64(ctx.date.timeIntervalSince1970 * 1000)
            let remainingMs = hint.endAtMs - nowMs
            let inOvertime = remainingMs <= 0 || hint.overtimeStartMs != nil
            let absMs = abs(remainingMs)
            let secs = Int(ceil(Double(absMs) / 1000.0))

            ZStack {
                ringView(remainingMs: remainingMs, inOvertime: inOvertime)
                Text(timeLabel(seconds: secs, inOvertime: inOvertime))
                    .font(.system(size: 44, weight: .semibold, design: .rounded))
                    .foregroundStyle(inOvertime ? Color.pink : Color.blue)
                    .monospacedDigit()
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .contentTransition(.numericText(countsDown: !inOvertime))
            }
            .padding(20)
            .accessibilityLabel(inOvertime
                ? "Overtime, \(secs) seconds past target"
                : "Rest, \(secs) seconds remaining")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(inOvertime ? "Done" : "Skip", action: onSkip)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("+30s", action: onExtend30)
                }
            }
            .onAppear { resetHapticsIfNewSet() }
            .onChange(of: hint.setUuid) { _, _ in resetHapticsIfNewSet() }
            .onChange(of: secs) { _, newSecs in
                handleHaptics(secsRemaining: newSecs, inOvertime: inOvertime, remainingMs: remainingMs)
            }
        }
    }

    @ViewBuilder
    private func ringView(remainingMs: Int64, inOvertime: Bool) -> some View {
        let durationMs = max(1, hint.durationSec * 1000)
        let progress: Double = {
            if inOvertime { return 1.0 }
            let elapsedMs = max(0, durationMs - Int(remainingMs))
            return min(max(Double(elapsedMs) / Double(durationMs), 0), 1)
        }()
        ZStack {
            Circle()
                .stroke(Color.gray.opacity(0.2), lineWidth: 6)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(
                    inOvertime ? Color.pink : Color.blue,
                    style: StrokeStyle(lineWidth: 6, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .animation(.linear(duration: 0.25), value: progress)
        }
    }

    private func timeLabel(seconds s: Int, inOvertime: Bool) -> String {
        let m = s / 60
        let r = s % 60
        let body = m > 0 ? "\(m):\(String(format: "%02d", r))" : "\(r)s"
        return inOvertime ? "+\(body)" : body
    }

    private func resetHapticsIfNewSet() {
        if lastSetUuid != hint.setUuid {
            firedTenSecondHaptic = false
            firedThreeSecondHaptic = false
            firedZeroCrossHaptic = false
            lastSetUuid = hint.setUuid
        }
    }

    /// SE 1st-gen has no AOD, so the screen is dark for most of rest.
    /// Haptics are the primary attention-grab: 10s warning pulls Lou's eye
    /// to the wrist before zero-cross instead of after.
    private func handleHaptics(secsRemaining: Int, inOvertime: Bool, remainingMs: Int64) {
        if !inOvertime {
            if secsRemaining == 10 && !firedTenSecondHaptic {
                WKInterfaceDevice.current().play(.start)
                firedTenSecondHaptic = true
            }
            if secsRemaining <= 3 && secsRemaining > 0 && !firedThreeSecondHaptic {
                WKInterfaceDevice.current().play(.click)
                firedThreeSecondHaptic = true
            }
        }
        if remainingMs <= 0 && !firedZeroCrossHaptic {
            WKInterfaceDevice.current().play(.success)
            firedZeroCrossHaptic = true
        }
    }
}
