import SwiftUI
import WatchConnectivity
import RebirthAppGroup
import RebirthModels
import RebirthWatchLog

@main
struct RebirthWatchApp: App {
    @StateObject private var session = WatchSessionStore()
    @StateObject private var completion = SetCompletionCoordinator()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .environmentObject(completion)
                .onAppear {
                    RebirthWatchLog.shared.info("RebirthWatch launched")
                    session.activate()
                    Task { await completion.flush() }
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject var session: WatchSessionStore
    @EnvironmentObject var completion: SetCompletionCoordinator

    @State private var pickerContext: PickerContext?
    @State private var restCountdown: Int?    // total seconds for an active rest timer
    @State private var timeModeContext: TimeModeContext?

    var body: some View {
        Group {
            if let snapshot = session.snapshot {
                ActiveWorkoutGlance(
                    snapshot: snapshot,
                    onRequestComplete: { exercise, set in
                        if exercise.trackingMode == .time {
                            timeModeContext = TimeModeContext(exercise: exercise, workoutSet: set)
                        } else {
                            pickerContext = PickerContext(exercise: exercise, workoutSet: set)
                        }
                    },
                    onEditWeight: { set, weight in
                        completion.setEditWeight(setUUID: set.uuid, weight: weight)
                    },
                    onEditReps: { set, reps in
                        completion.setEditReps(setUUID: set.uuid, reps: reps)
                    },
                    editsBySet: completion.edits
                )
                .overlay(alignment: .top) {
                    if completion.isAuthHalted {
                        ReAuthBanner(onDismiss: { completion.clearAuthHalt() })
                    }
                }
                .overlay(alignment: .bottom) {
                    if completion.pendingCount > 0 && !completion.isAuthHalted {
                        FooterPip(text: "syncing · \(completion.pendingCount) pending")
                    }
                }
            } else if session.isActivating {
                SyncingFromPhoneView()
            } else {
                NoSnapshotView()
            }
        }
        .sheet(item: $pickerContext) { ctx in
            RIRPicker(
                exercise: ctx.exercise,
                set: ctx.workoutSet,
                onConfirm: { rir in
                    Task { await completion.completeSet(in: ctx.exercise, set: ctx.workoutSet, rir: rir) }
                    session.loadFromAppGroup()
                    pickerContext = nil
                    // Auto-start rest timer (Tier 2 feature). Use snapshot default;
                    // skip on time-mode (already had its own countdown).
                    if ctx.exercise.trackingMode == .reps,
                       let s = session.snapshot {
                        restCountdown = s.restTimerDefaultSeconds
                    }
                },
                onCancel: {
                    Task { await completion.completeSet(in: ctx.exercise, set: ctx.workoutSet, rir: nil) }
                    session.loadFromAppGroup()
                    pickerContext = nil
                    if ctx.exercise.trackingMode == .reps,
                       let s = session.snapshot {
                        restCountdown = s.restTimerDefaultSeconds
                    }
                }
            )
        }
        .sheet(isPresented: Binding(
            get: { restCountdown != nil },
            set: { if !$0 { restCountdown = nil } })
        ) {
            if let total = restCountdown {
                CountdownRing(
                    totalSeconds: total,
                    onFinish: { restCountdown = nil },
                    onCancel: { restCountdown = nil }
                )
            }
        }
        .sheet(item: $timeModeContext) { ctx in
            CountdownRing(
                totalSeconds: ctx.workoutSet.targetDurationSeconds ?? 60,
                onFinish: {
                    // Hold complete → open RIR picker so the user can rate it.
                    let exercise = ctx.exercise
                    let set = ctx.workoutSet
                    timeModeContext = nil
                    pickerContext = PickerContext(exercise: exercise, workoutSet: set)
                },
                onCancel: { timeModeContext = nil }
            )
        }
    }
}

// MARK: - Coordinator context

struct PickerContext: Identifiable {
    let exercise: ActiveExercise
    let workoutSet: WorkoutSet
    var id: String { workoutSet.uuid }
}

struct TimeModeContext: Identifiable {
    let exercise: ActiveExercise
    let workoutSet: WorkoutSet
    var id: String { "tm-\(workoutSet.uuid)" }
}

// MARK: - Empty + sync states

struct SyncingFromPhoneView: View {
    var body: some View {
        VStack(spacing: 8) {
            ProgressView()
            Text("Syncing from phone…")
                .font(.caption)
        }
    }
}

struct NoSnapshotView: View {
    var body: some View {
        VStack(spacing: 6) {
            Text("Open Rebirth on phone")
                .font(.headline)
                .multilineTextAlignment(.center)
            Text("then start a workout")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding()
    }
}

private struct FooterPip: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 9))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color.gray.opacity(0.15), in: Capsule())
            .padding(.bottom, 2)
    }
}

private struct ReAuthBanner: View {
    let onDismiss: () -> Void
    var body: some View {
        VStack(spacing: 2) {
            Text("Re-auth from phone")
                .font(.system(size: 11, weight: .semibold))
            Text("Tap when fixed")
                .font(.system(size: 9))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 4)
        .background(Color.orange.opacity(0.85))
        .foregroundStyle(.black)
        .accessibilityLabel("Re-authenticate from phone")
        .accessibilityHint("Outbox halted on auth failure; tap to clear once the phone updates the key.")
        .onTapGesture {
            onDismiss()
        }
    }
}
