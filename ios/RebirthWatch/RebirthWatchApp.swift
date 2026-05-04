import SwiftUI
import WatchConnectivity
import RebirthAppGroup
import RebirthModels
import RebirthWatchLog

@main
struct RebirthWatchApp: App {
    @StateObject private var session = WatchSessionStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .onAppear {
                    RebirthWatchLog.shared.info("RebirthWatch launched")
                    session.activate()
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject var session: WatchSessionStore

    var body: some View {
        Group {
            if let snapshot = session.snapshot {
                ActiveWorkoutGlance(snapshot: snapshot)
            } else if session.isActivating {
                SyncingFromPhoneView()
            } else {
                NoSnapshotView()
            }
        }
    }
}

struct ActiveWorkoutGlance: View {
    let snapshot: ActiveWorkoutSnapshot

    var body: some View {
        VStack(spacing: 4) {
            Text("Day 1 skeleton")
                .font(.caption)
            Text(snapshot.exercises.first?.name ?? "no exercises yet")
                .font(.headline)
                .multilineTextAlignment(.center)
        }
        .padding()
    }
}

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
