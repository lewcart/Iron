import SwiftUI
import WatchKit

/// Countdown + overtime timer. Mirrors the iOS Live Activity behavior:
/// counts DOWN from totalSeconds (blue), then keeps counting UP past zero
/// (pink/red) so Lou can see how long they've overstayed the planned rest.
/// Tap = pause. Long-press = +30s. Toolbar Skip dismisses.
struct CountdownRing: View {
    let totalSeconds: Int
    let onFinish: () -> Void
    let onCancel: () -> Void

    @State private var elapsedMs: Int = 0           // monotonic since start
    @State private var paused: Bool = false
    @State private var hapticAt30sLeft: Bool = false
    @State private var hapticAtZero: Bool = false
    @State private var addedExtensionMs: Int = 0    // tracks long-press extends
    @State private var lastTickAt: Date = Date()

    private let timer = Timer.publish(every: 0.25, on: .main, in: .common).autoconnect()

    init(totalSeconds: Int, onFinish: @escaping () -> Void, onCancel: @escaping () -> Void) {
        self.totalSeconds = max(1, totalSeconds)
        self.onFinish = onFinish
        self.onCancel = onCancel
    }

    /// Effective total (with extends added). Negative `remainingMs` = overtime.
    private var effectiveTotalMs: Int {
        totalSeconds * 1000 + addedExtensionMs
    }
    private var remainingMs: Int {
        effectiveTotalMs - elapsedMs
    }
    private var inOvertime: Bool { remainingMs <= 0 }

    private var progress: Double {
        if inOvertime { return 1.0 }
        let total = Double(effectiveTotalMs)
        let done = Double(elapsedMs)
        return min(max(done / total, 0), 1)
    }

    private var displayString: String {
        let absMs = abs(remainingMs)
        let s = Int(ceil(Double(absMs) / 1000.0))
        let m = s / 60
        let r = s % 60
        let body = m > 0 ? "\(m):\(String(format: "%02d", r))" : "\(r)s"
        return inOvertime ? "+\(body)" : body
    }

    private var ringColor: Color {
        // Match the iOS Live Activity convention: blue counting down, pink past 0.
        inOvertime ? .pink : .blue
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.gray.opacity(0.2), lineWidth: 6)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(ringColor, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.linear(duration: 0.25), value: progress)
            VStack(spacing: 2) {
                Text(displayString)
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .foregroundStyle(ringColor)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                    .contentTransition(.numericText(countsDown: !inOvertime))
                if paused {
                    Text("paused").font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
        .padding(20)
        .accessibilityLabel(inOvertime
            ? "Overtime, \(displayString) past target"
            : "Rest, \(displayString) remaining")
        .onTapGesture { paused.toggle() }
        .onLongPressGesture { extend30s() }
        .onReceive(timer) { _ in tick() }
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Skip", action: onCancel)
            }
        }
    }

    private func tick() {
        guard !paused else {
            lastTickAt = Date()
            return
        }
        let now = Date()
        let dt = now.timeIntervalSince(lastTickAt)
        lastTickAt = now
        elapsedMs += Int(dt * 1000)

        let secsLeft = Int(ceil(Double(remainingMs) / 1000.0))

        // .click at 30s remaining (only when still counting down)
        if !inOvertime && secsLeft == 30 && !hapticAt30sLeft {
            WKInterfaceDevice.current().play(.click)
            hapticAt30sLeft = true
        }

        // .success at the moment we cross into overtime — strong cue but
        // we DON'T call onFinish (per Lou: keep counting like the iOS Live
        // Activity). User taps Skip to end the timer manually.
        if inOvertime && !hapticAtZero {
            WKInterfaceDevice.current().play(.success)
            hapticAtZero = true
        }
    }

    private func extend30s() {
        addedExtensionMs += 30_000
        // If we're already in overtime, extending pulls us back into countdown.
        if !inOvertime {
            hapticAtZero = false
            hapticAt30sLeft = remainingMs / 1000 < 30 ? true : false
        }
        WKInterfaceDevice.current().play(.start)
    }
}
