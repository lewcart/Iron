import SwiftUI
import RebirthModels

/// Surface 5 from PLAN-watch.md — session-end flow.
///
/// Shown when all sets in the routine are completed AND the user opts to
/// finish (or auto-prompt fires after 5 min of inactivity). Tapping
/// "Finish & Save" runs `WorkoutSessionManager.endSession()` which writes
/// the HKWorkout to HealthKit with the metadata stamp. Then the view
/// transitions to a brief "Saved" confirmation before dismissing.
struct SessionEndView: View {
    let snapshot: ActiveWorkoutSnapshot
    let elapsedSeconds: Int
    let onFinish: () async -> Void
    let onResume: () -> Void

    @State private var saving: Bool = false
    @State private var done: Bool = false

    private var totalSets: Int { snapshot.exercises.reduce(0) { $0 + $1.sets.count } }
    private var completedSets: Int {
        snapshot.exercises.reduce(0) { $0 + $1.sets.filter(\.isCompleted).count }
    }
    private var elapsedDisplay: String {
        let m = elapsedSeconds / 60
        let s = elapsedSeconds % 60
        return s == 0 ? "\(m)m" : "\(m)m \(s)s"
    }

    var body: some View {
        VStack(spacing: 6) {
            if done {
                Spacer()
                Image(systemName: "checkmark.seal.fill")
                    .font(.largeTitle)
                    .foregroundStyle(.green)
                Text("Saved")
                    .font(.headline)
                Spacer()
            } else {
                Text("Workout complete")
                    .font(.system(size: 13, weight: .semibold))
                Text("\(snapshot.exercises.count) ex · \(completedSets)/\(totalSets) sets · \(elapsedDisplay)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                Spacer(minLength: 4)

                Button(action: { Task { await finish() } }) {
                    Label(saving ? "Saving…" : "Finish & Save", systemImage: "checkmark")
                        .font(.callout)
                        .fontWeight(.semibold)
                        .frame(maxWidth: .infinity)
                        .frame(height: 36)
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                .disabled(saving)

                Button(action: onResume) {
                    Text("Add another set")
                        .font(.caption)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(saving)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
    }

    private func finish() async {
        guard !saving else { return }
        saving = true
        await onFinish()
        done = true
    }
}
