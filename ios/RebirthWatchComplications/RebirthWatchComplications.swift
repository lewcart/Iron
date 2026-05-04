import WidgetKit
import SwiftUI

/// WidgetKit bundle for the watch complications. Smart Stack-eligible.
/// Each kind has a distinct glyph + tint. Tap deep-links into the watch app
/// via `widgetURL` so the app launches into the right state on relaunch.
@main
struct RebirthWatchComplicationsBundle: WidgetBundle {
    var body: some Widget {
        StartWorkoutComplication()
        WalkNowComplication()
        DogWalkComplication()
        SessionStatusComplication()
    }
}

// MARK: - URL scheme

enum DeepLink {
    static let scheme = "rebirthwatch"
    static let startWorkout = URL(string: "\(scheme)://start-workout")!
    static let walkNow = URL(string: "\(scheme)://walk-now")!
    static let dogWalk = URL(string: "\(scheme)://dog-walk")!
    static let sessionStatus = URL(string: "\(scheme)://session-status")!
}

// MARK: - Start Workout

struct StartWorkoutComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StartWorkout", provider: StartWorkoutProvider()) { entry in
            ZStack {
                Color.clear
                VStack(spacing: 2) {
                    Image(systemName: "dumbbell.fill")
                        .font(.title3)
                    Text("Workout")
                        .font(.system(size: 9, weight: .semibold))
                        .lineLimit(1)
                }
                .foregroundStyle(.orange)
            }
            .widgetURL(DeepLink.startWorkout)
            .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Start workout")
        .description("Open today's routine on the watch.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryCorner])
    }
}

struct StartWorkoutProvider: TimelineProvider {
    func placeholder(in context: Context) -> RelevanceEntry { .now(label: "Workout") }
    func getSnapshot(in context: Context, completion: @escaping (RelevanceEntry) -> Void) {
        completion(.now(label: "Workout"))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<RelevanceEntry>) -> Void) {
        // Higher relevance during typical training hours: weekdays 16:00–21:00,
        // weekends 09:00–13:00. Defaults to a low score otherwise.
        let now = Date()
        let entry = RelevanceEntry(date: now, label: "Workout", relevance: trainingRelevance(at: now))
        completion(Timeline(entries: [entry], policy: .after(now.addingTimeInterval(3600))))
    }
}

private func trainingRelevance(at date: Date) -> TimelineEntryRelevance? {
    let cal = Calendar.current
    let comps = cal.dateComponents([.weekday, .hour], from: date)
    let weekday = comps.weekday ?? 1   // 1=Sun, 7=Sat
    let hour = comps.hour ?? 0
    let isWeekend = weekday == 1 || weekday == 7
    if isWeekend && (9...12).contains(hour) {
        return TimelineEntryRelevance(score: 0.8)
    }
    if !isWeekend && (16...21).contains(hour) {
        return TimelineEntryRelevance(score: 0.8)
    }
    return TimelineEntryRelevance(score: 0.2)
}

// MARK: - Walk Now

struct WalkNowComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "WalkNow", provider: WalkNowProvider()) { entry in
            ZStack {
                Color.clear
                VStack(spacing: 2) {
                    Image(systemName: "figure.walk")
                        .font(.title3)
                    Text("Walk")
                        .font(.system(size: 9, weight: .semibold))
                        .lineLimit(1)
                }
                .foregroundStyle(.green)
            }
            .widgetURL(DeepLink.walkNow)
            .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Walk now")
        .description("Start a logged walk.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryCorner])
    }
}

struct WalkNowProvider: TimelineProvider {
    func placeholder(in context: Context) -> RelevanceEntry { .now(label: "Walk") }
    func getSnapshot(in context: Context, completion: @escaping (RelevanceEntry) -> Void) {
        completion(.now(label: "Walk"))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<RelevanceEntry>) -> Void) {
        let now = Date()
        let entry = RelevanceEntry(date: now, label: "Walk", relevance: morningRelevance(at: now))
        completion(Timeline(entries: [entry], policy: .after(now.addingTimeInterval(1800))))
    }
}

// Mirrors the depart-home windows in src/lib/geofence.ts:
//   weekday 04:30–06:00, weekend 05:00–08:00.
private func morningRelevance(at date: Date) -> TimelineEntryRelevance? {
    let cal = Calendar.current
    let comps = cal.dateComponents([.weekday, .hour, .minute], from: date)
    let weekday = comps.weekday ?? 1
    let hour = comps.hour ?? 0
    let minute = comps.minute ?? 0
    let totalMin = hour * 60 + minute
    let isWeekend = weekday == 1 || weekday == 7
    let inWindow = isWeekend
        ? (totalMin >= 5*60 && totalMin <= 8*60)
        : (totalMin >= 4*60+30 && totalMin <= 6*60)
    return TimelineEntryRelevance(score: inWindow ? 0.95 : 0.15)
}

// MARK: - Dog Walk

struct DogWalkComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "DogWalk", provider: WalkNowProvider()) { entry in
            ZStack {
                Color.clear
                VStack(spacing: 2) {
                    Image(systemName: "pawprint.fill")
                        .font(.title3)
                    Text("Dog walk")
                        .font(.system(size: 9, weight: .semibold))
                        .lineLimit(1)
                }
                .foregroundStyle(.purple)
            }
            .widgetURL(DeepLink.dogWalk)
            .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Dog walk")
        .description("Start a dog walk (logged as Hiking + dog-walk tag).")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryCorner])
    }
}

// MARK: - Session Status

struct SessionStatusComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SessionStatus", provider: SessionStatusProvider()) { entry in
            ZStack {
                Color.clear
                VStack(spacing: 2) {
                    Image(systemName: "circle.fill")
                        .font(.system(size: 8))
                        .foregroundStyle(.red)
                    Text(entry.label)
                        .font(.system(size: 9, weight: .semibold))
                        .lineLimit(1)
                }
            }
            .widgetURL(DeepLink.sessionStatus)
            .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Session in progress")
        .description("Visible only during an active workout or walk.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular])
    }
}

struct SessionStatusProvider: TimelineProvider {
    func placeholder(in context: Context) -> RelevanceEntry { .now(label: "Active") }
    func getSnapshot(in context: Context, completion: @escaping (RelevanceEntry) -> Void) {
        completion(.now(label: "Active"))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<RelevanceEntry>) -> Void) {
        // Day 11+ wires this to actually inspect HKWorkoutSession state. For
        // now the entry is rendered with low relevance so the Smart Stack
        // doesn't surface an empty status tile.
        let now = Date()
        let entry = RelevanceEntry(
            date: now,
            label: "Active",
            relevance: TimelineEntryRelevance(score: 0.1)
        )
        completion(Timeline(entries: [entry], policy: .after(now.addingTimeInterval(900))))
    }
}

// MARK: - Shared entry type

struct RelevanceEntry: TimelineEntry {
    let date: Date
    let label: String
    let relevance: TimelineEntryRelevance?

    static func now(label: String) -> RelevanceEntry {
        RelevanceEntry(date: Date(), label: label, relevance: nil)
    }
}
