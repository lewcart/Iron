import SwiftUI
import RebirthModels

/// Surface 2 from PLAN-watch.md — RIR (Reps in Reserve) picker.
///
/// Crown 0–5 with detents. 0 = failure, 5 = 5+ left.
/// Default mid-stimulus value = 2.
/// Confirm tap → fires onConfirm(rir).
/// Swipe-down dismiss → fires onCancel — caller logs the set with rir=null.
struct RIRPicker: View {
    let exercise: ActiveExercise
    let set: WorkoutSet
    let onConfirm: (Int) -> Void
    let onCancel: () -> Void

    @State private var rir: Int = 2

    private static let labels: [Int: String] = [
        0: "failure",
        1: "1 in reserve",
        2: "2 in reserve",
        3: "3 in reserve",
        4: "4 in reserve",
        5: "5+ in reserve",
    ]

    var body: some View {
        VStack(spacing: 4) {
            Text("How hard?")
                .font(.caption)
                .foregroundStyle(.secondary)

            Spacer(minLength: 0)

            Text("\(rir)")
                .font(.system(size: 64, weight: .bold, design: .rounded))
                .minimumScaleFactor(0.7)
                .lineLimit(1)
                .accessibilityLabel("Reps in reserve")
                .accessibilityValue(Self.labels[rir] ?? "\(rir)")

            Text(Self.labels[rir] ?? "")
                .font(.caption2)
                .foregroundStyle(.secondary)

            Spacer(minLength: 0)

            Button(action: { onConfirm(rir) }) {
                Text("Confirm")
                    .font(.callout)
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                    .frame(height: 36)
            }
            .buttonStyle(.borderedProminent)
            .tint(.green)
            .accessibilityHint("Logs the set with RIR \(rir)")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .focusable()
        .digitalCrownRotation(
            $rir.crownDouble,
            from: 0,
            through: 5,
            by: 1,
            sensitivity: .low,
            isContinuous: false,
            isHapticFeedbackEnabled: true
        )
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel", action: onCancel)
            }
        }
    }
}

private extension Binding where Value == Int {
    var crownDouble: Binding<Double> {
        Binding<Double>(
            get: { Double(wrappedValue) },
            set: { wrappedValue = Int($0.rounded()) }
        )
    }
}
