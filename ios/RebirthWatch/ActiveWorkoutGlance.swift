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

    @State private var visibleExerciseIndex: Int = 0

    private var visibleExercise: ActiveExercise? {
        guard !snapshot.exercises.isEmpty else { return nil }
        let clamped = min(max(visibleExerciseIndex, 0), snapshot.exercises.count - 1)
        return snapshot.exercises[clamped]
    }

    var body: some View {
        Group {
            if let exercise = visibleExercise {
                ExerciseGlanceContent(exercise: exercise, exerciseIndex: visibleExerciseIndex, exerciseCount: snapshot.exercises.count)
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
    }
}

// MARK: - Subviews

private struct ExerciseGlanceContent: View {
    let exercise: ActiveExercise
    let exerciseIndex: Int
    let exerciseCount: Int

    private var currentSet: WorkoutSet? {
        exercise.sets.first(where: { !$0.isCompleted }) ?? exercise.sets.first
    }

    private var currentSetNumber: Int {
        guard let set = currentSet else { return 0 }
        return (exercise.sets.firstIndex(where: { $0.uuid == set.uuid }) ?? 0) + 1
    }

    var body: some View {
        VStack(spacing: 8) {
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
                HeroTarget(set: set, mode: exercise.trackingMode)
            }

            Spacer(minLength: 0)

            // Approve pill
            ApprovePill()
                .accessibilityLabel("Mark set complete")
                .accessibilityHint("Day 2 read-only — RIR picker lands on Day 3.")
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
    }
}

private struct HeroTarget: View {
    let set: WorkoutSet
    let mode: TrackingMode

    var body: some View {
        switch mode {
        case .reps:
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(formatWeight(set.targetWeight))
                    .font(.system(size: 56, weight: .bold, design: .rounded))
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                Text("kg")
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(.secondary)
            }
            Text("× \(set.targetReps.map(String.init) ?? "—") reps")
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Target \(formatWeight(set.targetWeight)) kilograms by \(set.targetReps.map(String.init) ?? "no") reps")
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
