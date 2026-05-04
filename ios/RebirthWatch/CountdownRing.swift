import SwiftUI
import WatchKit

/// Generic countdown timer view: ring + remaining time + haptic ticks.
/// Used by the rest timer between sets and by time-mode set holds.
struct CountdownRing: View {
    let totalSeconds: Int
    let onFinish: () -> Void
    let onCancel: () -> Void

    @State private var remainingMs: Int
    @State private var paused: Bool = false
    @State private var hapticAt50: Bool = false
    @State private var hapticAt90: Bool = false
    @State private var hapticAt30sLeft: Bool = false
    @State private var lastTickAt: Date = Date()

    private let timer = Timer.publish(every: 0.25, on: .main, in: .common).autoconnect()

    init(totalSeconds: Int, onFinish: @escaping () -> Void, onCancel: @escaping () -> Void) {
        self.totalSeconds = max(1, totalSeconds)
        self.onFinish = onFinish
        self.onCancel = onCancel
        _remainingMs = State(initialValue: max(1, totalSeconds) * 1000)
    }

    private var progress: Double {
        let total = Double(totalSeconds * 1000)
        let done = total - Double(remainingMs)
        return min(max(done / total, 0), 1)
    }

    private var remainingDisplay: String {
        let s = Int(ceil(Double(remainingMs) / 1000.0))
        if s < 60 { return "\(s)s" }
        let m = s / 60
        let r = s % 60
        return r == 0 ? "\(m)m" : "\(m):\(String(format: "%02d", r))"
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.gray.opacity(0.2), lineWidth: 6)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(Color.green, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.linear(duration: 0.25), value: progress)
            VStack(spacing: 2) {
                Text(remainingDisplay)
                    .font(.system(size: 44, weight: .bold, design: .rounded))
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                if paused {
                    Text("paused").font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
        .padding(20)
        .accessibilityLabel("Timer, \(remainingDisplay) remaining")
        .focusable()
        .digitalCrownRotation(
            .constant(0),
            from: 0, through: 1, by: 1,
            sensitivity: .low,
            isContinuous: false,
            isHapticFeedbackEnabled: false
        )
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
        remainingMs -= Int(dt * 1000)
        if remainingMs <= 0 {
            remainingMs = 0
            WKInterfaceDevice.current().play(.success)
            onFinish()
            return
        }
        let secsLeft = Int(ceil(Double(remainingMs) / 1000.0))
        // 30s remaining tick (rest timer feel — fires once when crossing).
        if secsLeft == 30 && !hapticAt30sLeft {
            WKInterfaceDevice.current().play(.click)
            hapticAt30sLeft = true
        }
        let pct = progress
        if pct >= 0.5 && !hapticAt50 {
            hapticAt50 = true
            WKInterfaceDevice.current().play(.click)
        }
        if pct >= 0.9 && !hapticAt90 {
            hapticAt90 = true
            WKInterfaceDevice.current().play(.click)
        }
    }

    private func extend30s() {
        remainingMs += 30_000
        WKInterfaceDevice.current().play(.start)
    }
}
