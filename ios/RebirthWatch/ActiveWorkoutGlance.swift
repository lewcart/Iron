import SwiftUI
import RebirthModels

/// Surface 1 from PLAN-watch.md — the active workout glance.
///
/// Layout (45mm baseline; scales with Dynamic Type):
/// - Top: exercise name (line 1) + "N/M" set chip (top-right)
/// - Middle: hero target weight (72pt) + unit/reps line
/// - Bottom: full-width ✓ pill (60pt height, ≥44pt tap target)
///
/// Crown navigates between exercises (one axis per surface — weight/rep dial
/// uses tap-to-enter modals on later days).
struct ActiveWorkoutGlance: View {
    let snapshot: ActiveWorkoutSnapshot
    let onRequestComplete: (ActiveExercise, WorkoutSet) -> Void
    let onEditWeight: (WorkoutSet, Double) -> Void
    let onEditReps: (WorkoutSet, Int) -> Void
    /// Per-set in-progress edits — looked up so the hero shows the edited
    /// value before confirmation.
    let editsBySet: [String: SetCompletionCoordinator.SetEdits]
    /// Live HR + elapsed time from HKLiveWorkoutBuilder. Nil HR means no
    /// session running yet. Pill is hidden when nil.
    let liveHeartRate: Int?
    let elapsedSeconds: Int

    @State private var visibleExerciseIndex: Int = 0
    @State private var dialMode: DialMode?

    private enum DialMode: Identifiable {
        case weight(WorkoutSet, prevSession: Double?)
        case reps(WorkoutSet)
        var id: String {
            switch self {
            case .weight(let s, _): return "weight-\(s.uuid)"
            case .reps(let s): return "reps-\(s.uuid)"
            }
        }
    }

    private var visibleExercise: ActiveExercise? {
        guard !snapshot.exercises.isEmpty else { return nil }
        let clamped = min(max(visibleExerciseIndex, 0), snapshot.exercises.count - 1)
        return snapshot.exercises[clamped]
    }

    var body: some View {
        Group {
            if let exercise = visibleExercise {
                ExerciseGlanceContent(
                    exercise: exercise,
                    exerciseIndex: visibleExerciseIndex,
                    exerciseCount: snapshot.exercises.count,
                    edits: editsBySet,
                    liveHeartRate: liveHeartRate,
                    elapsedSeconds: elapsedSeconds,
                    onRequestComplete: { set in onRequestComplete(exercise, set) },
                    onTapWeight: { set in
                        let prev = exercise.history?.sets.first?.actualWeight ?? exercise.history?.sets.first?.targetWeight
                        dialMode = .weight(set, prevSession: prev)
                    },
                    onTapReps: { set in
                        dialMode = .reps(set)
                    }
                )
            } else {
                EmptyGlanceContent()
            }
        }
        .focusable()
        .digitalCrownRotation(
            $visibleExerciseIndex.crownDouble,
            from: 0,
            through: Double(max(snapshot.exercises.count - 1, 0)),
            by: 1,
            sensitivity: .low,
            isContinuous: false,
            isHapticFeedbackEnabled: true
        )
        .onAppear {
            visibleExerciseIndex = snapshot.currentExerciseIndex
        }
        .onChange(of: snapshot.workoutUUID) { _, _ in
            // New workout — re-anchor on the server's current index.
            visibleExerciseIndex = snapshot.currentExerciseIndex
        }
        .sheet(item: $dialMode) { mode in
            switch mode {
            case .weight(let set, let prev):
                let initial = editsBySet[set.uuid]?.weight ?? set.targetWeight ?? 0
                WeightDial(
                    initialWeight: initial,
                    prevSessionWeight: prev,
                    onConfirm: { value in
                        onEditWeight(set, value)
                        dialMode = nil
                    },
                    onCancel: { dialMode = nil }
                )
            case .reps(let set):
                let initial = editsBySet[set.uuid]?.reps ?? set.targetReps ?? 0
                RepsDial(
                    initialReps: initial,
                    onConfirm: { value in
                        onEditReps(set, value)
                        dialMode = nil
                    },
                    onCancel: { dialMode = nil }
                )
            }
        }
    }
}

// MARK: - Subviews

private struct ExerciseGlanceContent: View {
    let exercise: ActiveExercise
    let exerciseIndex: Int
    let exerciseCount: Int
    let edits: [String: SetCompletionCoordinator.SetEdits]
    let liveHeartRate: Int?
    let elapsedSeconds: Int
    let onRequestComplete: (WorkoutSet) -> Void
    let onTapWeight: (WorkoutSet) -> Void
    let onTapReps: (WorkoutSet) -> Void

    private var currentSet: WorkoutSet? {
        exercise.sets.first(where: { !$0.isCompleted }) ?? exercise.sets.first
    }

    private var currentSetNumber: Int {
        guard let set = currentSet else { return 0 }
        return (exercise.sets.firstIndex(where: { $0.uuid == set.uuid }) ?? 0) + 1
    }

    private var elapsedDisplay: String {
        let m = elapsedSeconds / 60
        let s = elapsedSeconds % 60
        return String(format: "%d:%02d", m, s)
    }

    var body: some View {
        VStack(spacing: 8) {
            // Live HR + elapsed pill (only when a session is running)
            if let hr = liveHeartRate {
                HStack(spacing: 6) {
                    Text("♥ \(hr)")
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                        .foregroundStyle(.red)
                    Text(elapsedDisplay)
                        .font(.system(size: 10, design: .rounded))
                        .foregroundStyle(.secondary)
                }
                .accessibilityLabel("Heart rate \(hr), elapsed \(elapsedDisplay)")
            }

            // Header: name + set chip
            HStack(alignment: .top, spacing: 6) {
                Text(exercise.name)
                    .font(.callout)
                    .fontWeight(.semibold)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityLabel(exercise.name)

                if !exercise.sets.isEmpty {
                    Text("\(currentSetNumber)/\(exercise.sets.count)")
                        .font(.caption2)
                        .fontWeight(.semibold)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(Color.gray.opacity(0.25), in: Capsule())
                        .accessibilityLabel("Set \(currentSetNumber) of \(exercise.sets.count)")
                }
            }

            Spacer(minLength: 0)

            // Hero
            if let set = currentSet {
                let edit = edits[set.uuid]
                HeroTarget(
                    set: set,
                    mode: exercise.trackingMode,
                    editedWeight: edit?.weight,
                    editedReps: edit?.reps,
                    onTapWeight: { onTapWeight(set) },
                    onTapReps: { onTapReps(set) }
                )
            }

            Spacer(minLength: 0)

            // Approve pill — disabled if there's no incomplete set or no current set.
            if let set = currentSet, !set.isCompleted {
                Button(action: { onRequestComplete(set) }) {
                    ApprovePill()
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Mark set complete")
                .accessibilityHint("Opens RIR picker for set \(currentSetNumber)")
            } else {
                ApprovePill()
                    .opacity(0.4)
                    .accessibilityLabel("All sets done")
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
    }
}

private struct HeroTarget: View {
    let set: WorkoutSet
    let mode: TrackingMode
    let editedWeight: Double?
    let editedReps: Int?
    let onTapWeight: () -> Void
    let onTapReps: () -> Void

    @Environment(\.isLuminanceReduced) private var isAOD: Bool

    private var displayWeight: Double? { editedWeight ?? set.targetWeight }
    private var displayReps: Int? { editedReps ?? set.targetReps }

    var body: some View {
        switch mode {
        case .reps:
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Button(action: onTapWeight) {
                    Text(formatWeight(displayWeight))
                        .font(.system(size: 56, weight: .bold, design: .rounded))
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                        .foregroundStyle(editedWeight != nil ? .green : .primary)
                        .opacity(isAOD ? 0.3 : 1)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Target weight \(formatWeight(displayWeight)) kilograms — tap to adjust")
                Text("kg")
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(.secondary)
            }
            Button(action: onTapReps) {
                Text("× \(displayReps.map(String.init) ?? "—") reps")
                    .font(.caption)
                    .foregroundStyle(editedReps != nil ? .green : .secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Target \(displayReps.map(String.init) ?? "no") reps — tap to adjust")
        case .time:
            VStack(spacing: 0) {
                Text(formatDuration(set.targetDurationSeconds))
                    .font(.system(size: 48, weight: .bold, design: .rounded))
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
                Text("hold")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .accessibilityLabel("Hold for \(formatDuration(set.targetDurationSeconds))")
        }
    }

    private func formatWeight(_ kg: Double?) -> String {
        guard let kg else { return "—" }
        if kg.truncatingRemainder(dividingBy: 1) == 0 {
            return "\(Int(kg))"
        }
        return String(format: "%.1f", kg)
    }

    private func formatDuration(_ seconds: Int?) -> String {
        guard let seconds else { return "—" }
        if seconds < 60 { return "\(seconds)s" }
        let m = seconds / 60
        let s = seconds % 60
        if s == 0 { return "\(m)m" }
        return "\(m)m \(s)s"
    }
}

private struct ApprovePill: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 30)
                .fill(Color.green.opacity(0.2))
                .frame(maxWidth: .infinity)
                .frame(height: 44)
            Text("✓")
                .font(.title3)
                .fontWeight(.bold)
                .foregroundStyle(.green)
        }
    }
}

private struct EmptyGlanceContent: View {
    var body: some View {
        VStack(spacing: 6) {
            Text("No exercises")
                .font(.headline)
            Text("Add some on the phone")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - Crown binding helper

private extension Binding where Value == Int {
    var crownDouble: Binding<Double> {
        Binding<Double>(
            get: { Double(wrappedValue) },
            set: { wrappedValue = Int($0.rounded()) }
        )
    }
}
