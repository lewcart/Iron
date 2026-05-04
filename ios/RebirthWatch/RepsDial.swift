import SwiftUI
import WatchKit
import RebirthModels

/// Crown-driven reps dial in 1-rep steps. `.click` haptic per step.
struct RepsDial: View {
    let initialReps: Int
    let onConfirm: (Int) -> Void
    let onCancel: () -> Void

    @State private var rawSteps: Double = 0

    private static let minReps: Int = 0
    private static let maxReps: Int = 100

    private var currentReps: Int {
        let candidate = initialReps + Int(rawSteps.rounded())
        return min(max(candidate, Self.minReps), Self.maxReps)
    }

    var body: some View {
        VStack(spacing: 4) {
            Text("Reps")
                .font(.caption2)
                .foregroundStyle(.secondary)

            Spacer(minLength: 0)

            Text("\(currentReps)")
                .font(.system(size: 64, weight: .bold, design: .rounded))
                .minimumScaleFactor(0.6)
                .lineLimit(1)
                .accessibilityLabel("\(currentReps) reps")

            Text(currentReps == 1 ? "rep" : "reps")
                .font(.caption)
                .foregroundStyle(.secondary)

            Spacer(minLength: 0)

            Button(action: { onConfirm(currentReps) }) {
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
            from: -200,
            through: 200,
            by: 1,
            sensitivity: .low,
            isContinuous: false,
            isHapticFeedbackEnabled: false
        )
        .onChange(of: rawSteps) { _, _ in
            WKInterfaceDevice.current().play(.click)
        }
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel", action: onCancel)
            }
        }
    }
}
