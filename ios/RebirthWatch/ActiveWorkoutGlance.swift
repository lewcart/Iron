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
        VStack(spacing: 4) {
            // Header row — exercise name takes full width; HR pill on right
            // when session active. Set chip moves down to overlay the ✓ pill
            // (saves a column of header real estate on 40mm watches).
            HStack(alignment: .center, spacing: 4) {
                Text(exercise.name)
                    .font(.system(size: 14, weight: .semibold))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityLabel(exercise.name)

                if let hr = liveHeartRate {
                    Text("♥\(hr)")
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                        .foregroundStyle(.red)
                        .accessibilityLabel("Heart rate \(hr)")
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

            // Approve pill — set chip overlays the LEFT side of the pill so
            // the header has more room for the exercise name on small watches.
            if let set = currentSet, !set.isCompleted {
                Button(action: { onRequestComplete(set) }) {
                    ApprovePill(setLabel: "\(currentSetNumber)/\(exercise.sets.count)")
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Mark set \(currentSetNumber) of \(exercise.sets.count) complete")
                .accessibilityHint("Opens RIR picker")
            } else {
                ApprovePill(setLabel: "\(exercise.sets.count)/\(exercise.sets.count)")
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
            // Single-line hero: "80 kg × 8 reps" — separate tappable regions
            // for weight and reps so the dial-in still works per spec.
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Button(action: onTapWeight) {
                    HStack(alignment: .firstTextBaseline, spacing: 2) {
                        Text(formatWeight(displayWeight))
                            .font(.system(size: 36, weight: .bold, design: .rounded))
                            .minimumScaleFactor(0.6)
                            .lineLimit(1)
                            .foregroundStyle(editedWeight != nil ? .green : .primary)
                            .opacity(isAOD ? 0.3 : 1)
                        Text("kg")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.secondary)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Target weight \(formatWeight(displayWeight)) kilograms — tap to adjust")

                Text("×")
                    .font(.system(size: 16))
                    .foregroundStyle(.tertiary)

                Button(action: onTapReps) {
                    Text("\(displayReps.map(String.init) ?? "—")")
                        .font(.system(size: 36, weight: .bold, design: .rounded))
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                        .foregroundStyle(editedReps != nil ? .green : .primary)
                        .opacity(isAOD ? 0.3 : 1)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Target \(displayReps.map(String.init) ?? "no") reps — tap to adjust")
            }
        case .time:
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(formatDuration(set.targetDurationSeconds))
                    .font(.system(size: 36, weight: .bold, design: .rounded))
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
                Text("hold")
                    .font(.system(size: 12))
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
    let setLabel: String
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 30)
                .fill(Color.green.opacity(0.25))
                .frame(maxWidth: .infinity)
                .frame(height: 44)
            HStack {
                Text(setLabel)
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(.green.opacity(0.9))
                    .padding(.leading, 14)
                Spacer()
                Text("✓")
                    .font(.title3)
                    .fontWeight(.bold)
                    .foregroundStyle(.green)
                Spacer()
                // Right-side spacer to keep ✓ visually centered against the
                // left-side set chip.
                Text(setLabel)
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(.clear)
                    .padding(.trailing, 14)
            }
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
