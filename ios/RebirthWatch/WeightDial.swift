import SwiftUI
import WatchKit
import RebirthModels

/// Crown-driven weight dial in 1.25kg steps.
/// `.click` haptic per step. `.success` haptic when crossing the previous
/// session's recorded weight (a small "you matched / passed last time" cue).
struct WeightDial: View {
    let initialWeight: Double
    let prevSessionWeight: Double?
    let onConfirm: (Double) -> Void
    let onCancel: () -> Void

    @State private var rawSteps: Double = 0      // Crown delta in 1.25kg steps
    @State private var lastCrossedPrev: Bool = false

    private static let step: Double = 1.0
    private static let minWeight: Double = 0
    private static let maxWeight: Double = 500

    private var currentWeight: Double {
        // Round rawSteps to whole units. SwiftUI's digitalCrownRotation with
        // a Double binding can interpolate fractional values between steps;
        // explicit rounding snaps to true 1kg increments.
        let candidate = initialWeight + (rawSteps.rounded() * Self.step)
        return min(max(candidate, Self.minWeight), Self.maxWeight)
    }

    var body: some View {
        VStack(spacing: 4) {
            Text("Weight")
                .font(.caption2)
                .foregroundStyle(.secondary)

            Spacer(minLength: 0)

            Text(formatWeight(currentWeight))
                .font(.system(size: 56, weight: .bold, design: .rounded))
                .minimumScaleFactor(0.6)
                .lineLimit(1)
                .accessibilityLabel("\(formatWeight(currentWeight)) kilograms")

            Text("kg")
                .font(.caption)
                .foregroundStyle(.secondary)

            if let prev = prevSessionWeight, prev != initialWeight {
                Text("last: \(formatWeight(prev))")
                    .font(.system(size: 9))
                    .foregroundStyle(.tertiary)
            }

            Spacer(minLength: 0)

            Button(action: { onConfirm(currentWeight) }) {
                Text("Confirm")
                    .font(.callout)
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                    .frame(height: 36)
            }
            .buttonStyle(.borderedProminent)
            .tint(.green)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .focusable()
        .digitalCrownRotation(
            $rawSteps,
            from: -1000,
            through: 1000,
            by: 1,
            sensitivity: .low,
            isContinuous: false,
            isHapticFeedbackEnabled: false   // we play our own crossings
        )
        .onChange(of: rawSteps) { _, _ in
            WKInterfaceDevice.current().play(.click)
            checkCrossing()
        }
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel", action: onCancel)
            }
        }
    }

    private func checkCrossing() {
        guard let prev = prevSessionWeight else { return }
        let crossed = (initialWeight < prev && currentWeight >= prev)
                   || (initialWeight > prev && currentWeight <= prev)
                   || (currentWeight == prev && initialWeight != prev)
        if crossed && !lastCrossedPrev {
            WKInterfaceDevice.current().play(.success)
            lastCrossedPrev = true
        } else if !crossed {
            lastCrossedPrev = false
        }
    }

    private func formatWeight(_ kg: Double) -> String {
        if kg.truncatingRemainder(dividingBy: 1) == 0 {
            return "\(Int(kg))"
        }
        return String(format: "%.2f", kg).replacingOccurrences(of: "0$", with: "", options: .regularExpression)
    }
}
