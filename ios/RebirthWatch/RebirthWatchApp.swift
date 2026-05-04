import SwiftUI
import WatchConnectivity
import RebirthAppGroup
import RebirthModels
import RebirthWatchLog

@main
struct RebirthWatchApp: App {
    @StateObject private var session = WatchSessionStore()
    @StateObject private var completion = SetCompletionCoordinator()
    @StateObject private var workoutSession = WorkoutSessionManager()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .environmentObject(completion)
                .environmentObject(workoutSession)
                .onAppear {
                    RebirthWatchLog.shared.info("RebirthWatch launched")
                    session.activate()
                    Task { await completion.flush() }
                }
                .onChange(of: scenePhase) { _, phase in
                    // Flush on every foreground transition. NWPathMonitor only
                    // fires on connectivity transitions; if the watch sleeps with
                    // network already satisfied and wakes 10min later, no NWPath
                    // event fires. This catches that case.
                    if phase == .active {
                        Task { await completion.flush() }
                    }
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject var session: WatchSessionStore
    @EnvironmentObject var completion: SetCompletionCoordinator
    @EnvironmentObject var workoutSession: WorkoutSessionManager

    @State private var pickerContext: PickerContext?
    @State private var restCountdown: Int?    // total seconds for an active rest timer
    @State private var timeModeContext: TimeModeContext?
    @State private var showSessionEnd: Bool = false
    @State private var lastCompletedAt: Date?
    @State private var undoTarget: WorkoutSet?

    private func allSetsCompleted(in snapshot: ActiveWorkoutSnapshot) -> Bool {
        guard !snapshot.exercises.isEmpty else { return false }
        return snapshot.exercises.allSatisfy { ex in
            !ex.sets.isEmpty && ex.sets.allSatisfy(\.isCompleted)
        }
    }

    var body: some View {
        Group {
            if let snapshot = session.snapshot {
                ActiveWorkoutGlance(
                    snapshot: snapshot,
                    onRequestComplete: { exercise, set in
                        // Auto-start an HKWorkoutSession on first set approval
                        // of this workout. Idempotent for the same UUID.
                        workoutSession.beginSession(rebirthWorkoutUUID: snapshot.workoutUUID)
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
                    editsBySet: completion.edits,
                    liveHeartRate: workoutSession.currentHeartRate,
                    elapsedSeconds: workoutSession.elapsedSeconds
                )
                .overlay(alignment: .top) {
                    VStack(spacing: 2) {
                        if completion.isAuthHalted {
                            ReAuthBanner(onDismiss: { completion.clearAuthHalt() })
                        } else if let target = undoTarget {
                            UndoBanner(onUndo: { undoTarget = nil })
                                .id(target.uuid)
                        }
                        if let delta = completion.lastPBDeltaKg, delta > 0 {
                            PBPill(deltaKg: delta)
                        } else if let hint = snapshot.hrvHint, hint.sigma <= -1 {
                            HRVPill(hint: hint)
                        }
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
                    undoTarget = ctx.workoutSet
                    if ctx.exercise.trackingMode == .reps,
                       let s = session.snapshot {
                        restCountdown = s.restTimerDefaultSeconds
                    }
                },
                onCancel: {
                    Task { await completion.completeSet(in: ctx.exercise, set: ctx.workoutSet, rir: nil) }
                    session.loadFromAppGroup()
                    pickerContext = nil
                    undoTarget = ctx.workoutSet
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
                    let exercise = ctx.exercise
                    let set = ctx.workoutSet
                    timeModeContext = nil
                    pickerContext = PickerContext(exercise: exercise, workoutSet: set)
                },
                onCancel: { timeModeContext = nil }
            )
        }
        .sheet(isPresented: $showSessionEnd) {
            if let snapshot = session.snapshot {
                SessionEndView(
                    snapshot: snapshot,
                    elapsedSeconds: workoutSession.elapsedSeconds,
                    onFinish: {
                        await workoutSession.endSession()
                        await completion.flush()
                    },
                    onResume: { showSessionEnd = false }
                )
            }
        }
        .onChange(of: session.snapshot) { _, new in
            guard let snap = new else { return }
            if allSetsCompleted(in: snap) {
                if let last = lastCompletedAt, Date().timeIntervalSince(last) > 300 {
                    showSessionEnd = true
                } else if lastCompletedAt == nil {
                    lastCompletedAt = Date()
                }
            } else {
                lastCompletedAt = nil
            }
        }
        .onOpenURL { url in
            // Complications launch the app via rebirthwatch:// scheme.
            // Day 10: log + route to the appropriate state. Walk/Dog Walk
            // start triggers wire on Day 11 (walk-while-working glance).
            switch url.absoluteString {
            case "rebirthwatch://session-status":
                if session.snapshot != nil { showSessionEnd = true }
            case "rebirthwatch://start-workout",
                 "rebirthwatch://walk-now",
                 "rebirthwatch://dog-walk":
                // Default landing — root view will show the active workout
                // glance if a snapshot is present, otherwise the empty-state.
                break
            default:
                break
            }
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

private struct PBPill: View {
    let deltaKg: Double
    var body: some View {
        let formatted = deltaKg.truncatingRemainder(dividingBy: 1) == 0
            ? "+\(Int(deltaKg))kg"
            : String(format: "+%.1fkg", deltaKg)
        Text("\(formatted) PB")
            .font(.system(size: 11, weight: .bold, design: .rounded))
            .foregroundStyle(.yellow)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(Color.yellow.opacity(0.15), in: Capsule())
            .accessibilityLabel("Personal best, plus \(formatted)")
    }
}

private struct HRVPill: View {
    let hint: HRVHint
    var body: some View {
        let sigma = hint.sigma
        let sigmaStr = String(format: "%.1f", sigma)
        Text("ⓘ HRV \(Int(hint.currentMs)) · \(sigmaStr)σ vs 30d")
            .font(.system(size: 9))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color.gray.opacity(0.15), in: Capsule())
            .accessibilityLabel("HRV \(Int(hint.currentMs)) milliseconds, \(sigmaStr) standard deviations vs 30 day baseline")
    }
}

private struct UndoBanner: View {
    let onUndo: () -> Void
    @State private var visible = true

    var body: some View {
        if visible {
            HStack(spacing: 4) {
                Text("Marked complete")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                Button("Undo", action: onUndo)
                    .font(.system(size: 10, weight: .semibold))
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color.gray.opacity(0.2), in: Capsule())
            .padding(.top, 2)
            .task {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                visible = false
            }
        }
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
