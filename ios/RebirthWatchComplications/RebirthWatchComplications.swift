import WidgetKit
import SwiftUI

/// WidgetKit bundle for the watch complications. Smart Stack-eligible.
/// Day 1 ships as a placeholder bundle so the target builds; real timeline
/// providers land on Day 9.
@main
struct RebirthWatchComplicationsBundle: WidgetBundle {
    var body: some Widget {
        StartWorkoutComplication()
        WalkNowComplication()
        DogWalkComplication()
        SessionStatusComplication()
    }
}

// MARK: - Placeholders (real timelines on Day 9)

struct StartWorkoutComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StartWorkout", provider: StaticProvider(label: "Start workout")) { entry in
            ComplicationLabel(text: entry.label)
        }
        .configurationDisplayName("Start workout")
        .description("Open today's routine on the watch.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryCorner])
    }
}

struct WalkNowComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "WalkNow", provider: StaticProvider(label: "Walk now")) { entry in
            ComplicationLabel(text: entry.label)
        }
        .configurationDisplayName("Walk now")
        .description("Start a logged walk.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryCorner])
    }
}

struct DogWalkComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "DogWalk", provider: StaticProvider(label: "Dog walk")) { entry in
            ComplicationLabel(text: entry.label)
        }
        .configurationDisplayName("Dog walk")
        .description("Start a dog walk (Hiking + tag).")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryCorner])
    }
}

struct SessionStatusComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SessionStatus", provider: StaticProvider(label: "—")) { entry in
            ComplicationLabel(text: entry.label)
        }
        .configurationDisplayName("Session in progress")
        .description("Visible only during an active workout or walk.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular])
    }
}

// MARK: - shared

struct StaticEntry: TimelineEntry {
    let date: Date
    let label: String
}

struct StaticProvider: TimelineProvider {
    let label: String

    func placeholder(in context: Context) -> StaticEntry {
        StaticEntry(date: Date(), label: label)
    }

    func getSnapshot(in context: Context, completion: @escaping (StaticEntry) -> Void) {
        completion(StaticEntry(date: Date(), label: label))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<StaticEntry>) -> Void) {
        completion(Timeline(entries: [StaticEntry(date: Date(), label: label)], policy: .never))
    }
}

struct ComplicationLabel: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.caption2)
            .multilineTextAlignment(.center)
    }
}
